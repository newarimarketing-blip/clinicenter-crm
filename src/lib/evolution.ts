// Cliente mínimo da Evolution API (WhatsApp).
const base = () => process.env.EVOLUTION_BASE_URL!.replace(/\/$/, "");
const instance = () => process.env.EVOLUTION_INSTANCE || "clinicenter";
const headers = () => ({ "Content-Type": "application/json", apikey: process.env.EVOLUTION_API_KEY! });

/** Envia texto. `delay` faz o WhatsApp mostrar "digitando…" pelo tempo informado. Retorna o id da mensagem. */
export async function sendText(number: string, text: string, delay = 1200): Promise<string | undefined> {
  const r = await fetch(`${base()}/message/sendText/${instance()}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ number, text, delay, linkPreview: false }),
  });
  if (!r.ok) throw new Error(`Evolution sendText ${r.status}: ${await r.text()}`);
  const j = (await r.json()) as { key?: { id?: string } };
  return j.key?.id;
}

export async function getMediaBase64(messageId: string): Promise<string | undefined> {
  const r = await fetch(`${base()}/chat/getBase64FromMediaMessage/${instance()}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ message: { key: { id: messageId } }, convertToMp4: false }),
  });
  if (!r.ok) return undefined;
  const j = (await r.json()) as { base64?: string };
  return j.base64;
}

/** Tempo de "digitando" proporcional ao texto (entre 0,8 s e 3,5 s). */
export const typingDelay = (text: string) => Math.min(3500, Math.max(800, text.length * 25));

/* ---------- Gerenciamento da instância (conectar o WhatsApp pelo portal) ---------- */

export type WaState = "open" | "connecting" | "close" | "absent";
export type WaInfo = { state: WaState; number?: string; name?: string };
export type WaQr = { qr?: string; pairingCode?: string };

export const evolutionConfigured = () => Boolean(process.env.EVOLUTION_BASE_URL && process.env.EVOLUTION_API_KEY);
export const instanceName = instance;

async function call(method: string, path: string, body?: unknown) {
  const r = await fetch(`${base()}${path}`, { method, headers: headers(), body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store" });
  const text = await r.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* resposta não-JSON */ }
  return { ok: r.ok, status: r.status, json: json as Record<string, any> | null, text };
}

/** Estado da instância + número/nome do WhatsApp quando conectado. */
export async function getInstanceInfo(): Promise<WaInfo> {
  const st = await call("GET", `/instance/connectionState/${instance()}`);
  if (st.status === 404) return { state: "absent" };
  if (!st.ok) throw new Error(`Evolution connectionState ${st.status}: ${st.text.slice(0, 200)}`);
  const raw = String(st.json?.instance?.state ?? st.json?.state ?? "close");
  const state: WaState = raw === "open" ? "open" : raw === "connecting" ? "connecting" : "close";
  const info: WaInfo = { state };
  if (state === "open") {
    const f = await call("GET", `/instance/fetchInstances?instanceName=${encodeURIComponent(instance())}`);
    const row = Array.isArray(f.json) ? (f.json as any[])[0] : f.json;
    const inst = row?.instance ?? row;
    const jid = String(inst?.ownerJid ?? inst?.owner ?? "");
    if (jid) info.number = jid.split("@")[0].split(":")[0];
    info.name = inst?.profileName ?? undefined;
  }
  return info;
}

/** Cria a instância se ainda não existir. */
export async function ensureInstance(): Promise<void> {
  const st = await call("GET", `/instance/connectionState/${instance()}`);
  if (st.ok) return;
  if (st.status !== 404) throw new Error(`Evolution ${st.status}: ${st.text.slice(0, 200)}`);
  const c = await call("POST", "/instance/create", { instanceName: instance(), qrcode: true, integration: "WHATSAPP-BAILEYS" });
  if (!c.ok) throw new Error(`Evolution create ${c.status}: ${c.text.slice(0, 200)}`);
}

/** Pede um QR Code novo (ou um código de pareamento, se `number` for informado). */
export async function connectInstance(number?: string): Promise<WaQr> {
  const q = number ? `?number=${encodeURIComponent(number)}` : "";
  const r = await call("GET", `/instance/connect/${instance()}${q}`);
  if (!r.ok) throw new Error(`Evolution connect ${r.status}: ${r.text.slice(0, 200)}`);
  const b64 = r.json?.base64 as string | undefined;
  return {
    qr: b64 ? (b64.startsWith("data:") ? b64 : `data:image/png;base64,${b64}`) : undefined,
    pairingCode: (r.json?.pairingCode as string | undefined) || undefined,
  };
}

export async function logoutInstance(): Promise<void> {
  const r = await call("DELETE", `/instance/logout/${instance()}`);
  if (!r.ok && r.status !== 404 && r.status !== 400) throw new Error(`Evolution logout ${r.status}: ${r.text.slice(0, 200)}`);
}

/** Aponta o webhook da instância para este sistema (evento MESSAGES_UPSERT). */
export async function setWebhook(url: string): Promise<void> {
  const events = ["MESSAGES_UPSERT"];
  let r = await call("POST", `/webhook/set/${instance()}`, { webhook: { enabled: true, url, byEvents: false, base64: false, events } });
  if (!r.ok) r = await call("POST", `/webhook/set/${instance()}`, { enabled: true, url, webhook_by_events: false, webhook_base64: false, events });
  if (!r.ok) throw new Error(`Evolution webhook ${r.status}: ${r.text.slice(0, 200)}`);
}
