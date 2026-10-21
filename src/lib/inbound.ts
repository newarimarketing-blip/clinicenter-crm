import { admin } from "./supabase-admin";
import { upsertLead, logEvent, updateLead } from "./leads";
import { getMediaBase64 } from "./evolution";
import { describeImage, transcribe } from "./openai";
import { runAgent } from "./agent";
import { CLINIC } from "./clinic-config";
import { sleep } from "./time";

/* eslint-disable @typescript-eslint/no-explicit-any */

const digits = (jid: string) => jid.split("@")[0].replace(/\D/g, "");

function resolvePhone(d: any): string | null {
  const key = d?.key ?? {};
  let jid: string = key.remoteJid ?? "";
  if (jid.endsWith("@lid")) jid = key.remoteJidAlt ?? d.senderPn ?? "";
  if (!jid.endsWith("@s.whatsapp.net")) return null; // ignora grupos, status e listas
  return digits(jid);
}

async function resolveContent(d: any): Promise<{ text: string; media: string | null }> {
  const m = d.message ?? {};
  const typed = m.conversation ?? m.extendedTextMessage?.text ?? "";
  if (m.audioMessage) {
    const b64 = m.base64 ?? d.message?.base64 ?? (await getMediaBase64(d.key.id));
    return { text: b64 ? `[áudio] ${await transcribe(b64)}` : "[áudio não transcrito]", media: "audio" };
  }
  if (m.imageMessage) {
    const b64 = m.base64 ?? (await getMediaBase64(d.key.id));
    const caption = m.imageMessage.caption ? ` — legenda: ${m.imageMessage.caption}` : "";
    return { text: `[imagem: ${b64 ? await describeImage(b64, m.imageMessage.mimetype) : "não analisada"}]${caption}`, media: "image" };
  }
  return { text: typed, media: null };
}

/** Mensagem enviada pela equipe no celular da clínica: pausa a IA (ou devolve, se for a palavra-chave). */
async function handleOutgoing(d: any, phone: string) {
  const db = admin();
  const waId: string | undefined = d.key?.id;
  await sleep(2000); // dá tempo de o envio da própria IA gravar o wa_id
  if (waId) {
    const { data } = await db.from("messages").select("id").eq("wa_id", waId).maybeSingle();
    if (data) return; // foi a IA
  }
  const text: string = d.message?.conversation ?? d.message?.extendedTextMessage?.text ?? "";
  if (!text) return;
  const lead = await upsertLead(phone, null);
  await db.from("messages").insert({ lead_id: lead.id, role: "humano", content: text, wa_id: waId ?? null, processed: true });
  if (text.trim().toLowerCase() === CLINIC.resumeKeyword) {
    await updateLead(lead, { ai_paused_until: null });
    await logEvent(lead.id, "ai_resumed");
  } else {
    await updateLead(lead, { ai_paused_until: new Date(Date.now() + CLINIC.humanPauseHours * 3600e3).toISOString() });
    await logEvent(lead.id, "human_takeover");
  }
}

export async function processWebhook(body: any) {
  const d = body?.data;
  const phone = resolvePhone(d);
  if (!d || !phone) return;
  if (d.key.fromMe) return handleOutgoing(d, phone);

  const db = admin();
  const lead = await upsertLead(phone, d.pushName);
  const { text, media } = await resolveContent(d);
  if (!text.trim()) return;

  // idempotência: o Evolution pode reenviar o mesmo webhook
  const { data: inserted } = await db
    .from("messages")
    .upsert({ lead_id: lead.id, role: "lead", content: text, media_type: media, wa_id: d.key.id }, { onConflict: "wa_id", ignoreDuplicates: true })
    .select("id");
  const myId = inserted?.[0]?.id;
  if (!myId) return;

  if (lead.ai_paused_until && new Date(lead.ai_paused_until) > new Date()) return; // humano no comando

  // debounce: aguarda mensagens picotadas; só a ÚLTIMA execução responde
  await sleep(Number(process.env.DEBOUNCE_MS ?? 6000));
  const { data: latest } = await db.from("messages").select("id").eq("lead_id", lead.id).eq("role", "lead").order("created_at", { ascending: false }).limit(1);
  if (latest?.[0]?.id !== myId) return;

  // claim atômico: marca como processadas as mensagens pendentes; se outra execução já pegou, sai
  const { data: claimed } = await db.from("messages").update({ processed: true }).eq("lead_id", lead.id).eq("role", "lead").eq("processed", false).select("id");
  if (!claimed?.length) return;

  try {
    await runAgent(lead.id);
  } catch (e) {
    await db.from("messages").update({ processed: false }).in("id", claimed.map((c) => c.id));
    await logEvent(lead.id, "agent_error", { error: String(e) });
    throw e;
  }
}
