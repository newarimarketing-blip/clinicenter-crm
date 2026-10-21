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
