import { admin } from "./supabase-admin";
import { openai } from "./openai";
import { sendText, typingDelay } from "./evolution";
import { logEvent } from "./leads";
import { CLINIC } from "./clinic-config";
import type { Lead, Message } from "./types";

/**
 * Retomada de lead que sumiu ("Aguardando retorno" no Painel).
 * Regras (todas verificadas aqui, nunca pelo modelo):
 *  - no máximo DUAS tentativas por silêncio; o contador volta a zero quando o paciente responde;
 *  - 1ª depois de ~6 h do último contato do paciente; 2ª no dia seguinte (>= 18 h depois da 1ª);
 *  - só etapas qualificado / horario_oferecido; nunca com a IA pausada (humano no comando);
 *  - só se a última mensagem da conversa foi da IA (o paciente é quem ficou de responder);
 *  - só entre 8h e 20h em Fortaleza e nunca aos domingos;
 *  - leads parados há muito tempo não são acordados (1ª: até 36 h de silêncio; 2ª: até 72 h).
 */
export const FOLLOWUP = { firstAfterH: 6, firstMaxH: 36, secondAfterFirstH: 18, secondMaxH: 72, openHour: 8, closeHour: 20, max: 2 };

const OFFSET_MS = 3 * 3600e3;

export function inSendWindow(now = Date.now()): boolean {
  const d = new Date(now - OFFSET_MS);
  const h = d.getUTCHours();
  return d.getUTCDay() !== 0 && h >= FOLLOWUP.openHour && h < FOLLOWUP.closeHour;
}

const AREA: Record<string, string> = { pediatria: "a consulta de pediatria", psiquiatria: "a consulta de psiquiatria", fisioterapia: "a fisioterapia" };

export function fallbackText(n: 1 | 2, lead: Pick<Lead, "name" | "specialty">): string {
  const first = (lead.name ?? "").trim().split(/\s+/)[0];
  const hi = first ? `Oi, ${first}!` : "Oi!";
  const area = (lead.specialty && AREA[lead.specialty]) || "o atendimento";
  return n === 1
    ? `${hi} Passando para saber se ficou alguma dúvida sobre ${area}. Se quiser, já te mostro os horários disponíveis.`
    : `${hi} Para não deixar nossa conversa em aberto: se ainda precisar d${area.startsWith("a ") ? "a" : "o"} ${area.replace(/^(a|o) /, "")}, é só me chamar aqui que eu te ajudo a encontrar um horário. Fico à disposição!`;
}

/** Texto curto e humano, ancorado na conversa. Se o modelo falhar ou escapar das regras, usa o modelo fixo. */
export async function buildFollowupText(n: 1 | 2, lead: Lead, history: Pick<Message, "role" | "content">[]): Promise<string> {
  const fb = fallbackText(n, lead);
  if (!process.env.OPENAI_API_KEY) return fb;
  try {
    const convo = history.map((m) => `${m.role === "lead" ? "PACIENTE" : "MARCELIA"}: ${m.content}`).join("\n").slice(-1800);
    const res = await openai().chat.completions.create({
      model: process.env.AGENT_MODEL || "gpt-4.1-mini",
      temperature: 0.6,
      max_tokens: 120,
      messages: [
        {
          role: "system",
          content:
            `Você é a Marcelia, recepcionista virtual da ${CLINIC.name}. O paciente parou de responder. Escreva UMA mensagem de WhatsApp de retomada, em português do Brasil, com 1 ou 2 frases curtas e tom humano e gentil.\n` +
            `Regras: retome o assunto real da conversa; ${n === 1 ? "faça uma pergunta leve ou ofereça ajuda" : "esta é a ÚLTIMA tentativa: deixe a porta aberta e diga que ele pode chamar quando quiser, sem pedir resposta"}; ` +
            `NÃO cite preços, datas, horários ou números; NÃO pressione nem use escassez; NÃO dê orientação clínica; no máximo 1 emoji. Responda só com o texto da mensagem.`,
        },
        { role: "user", content: `Paciente: ${lead.name ?? "?"} | Especialidade: ${lead.specialty ?? "?"}\n\nCONVERSA:\n${convo}` },
      ],
    });
    const t = res.choices[0]?.message?.content?.trim().replace(/^["“]|["”]$/g, "") ?? "";
    if (!t || t.length > 320 || /\d/.test(t)) return fb;
    return t;
  } catch {
    return fb;
  }
}

export async function sendFollowups(now = Date.now()): Promise<{ checked: number; sent: number; skipped?: string }> {
  if (!inSendWindow(now)) return { checked: 0, sent: 0, skipped: "fora do horário de envio (8h–20h, seg–sáb, Fortaleza)" };
  const db = admin();
  const { data, error } = await db
    .from("leads")
    .select("*")
    .in("stage", ["qualificado", "horario_oferecido"])
    .lt("followup_count", FOLLOWUP.max)
    .lte("last_inbound_at", new Date(now - FOLLOWUP.firstAfterH * 3600e3).toISOString())
    .gte("last_inbound_at", new Date(now - FOLLOWUP.secondMaxH * 3600e3).toISOString())
    .order("last_inbound_at")
    .limit(60);
  if (error) throw new Error(`retomada: ${error.message}`); // ex.: migração 003 ainda não aplicada
  let sent = 0;
  const leads = (data ?? []) as Lead[];
  for (const lead of leads) {
    const count = lead.followup_count ?? 0;
    if (lead.ai_paused_until && +new Date(lead.ai_paused_until) > now) continue; // humano no comando
    const inboundAge = now - +new Date(lead.last_inbound_at!);
    if (count === 0 && inboundAge > FOLLOWUP.firstMaxH * 3600e3) continue;
    if (count === 1 && (!lead.last_followup_at || now - +new Date(lead.last_followup_at) < FOLLOWUP.secondAfterFirstH * 3600e3)) continue;

    const { data: hist } = await db.from("messages").select("role,content,created_at").eq("lead_id", lead.id).order("created_at", { ascending: false }).limit(10);
    const history = ((hist ?? []) as Pick<Message, "role" | "content">[]).reverse();
    if (history[history.length - 1]?.role !== "ia") continue; // o paciente ainda espera resposta, ou um humano falou por último

    // claim atômico: se outra execução já avançou o contador, não envia de novo
    const n = (count + 1) as 1 | 2;
    const { data: claimed } = await db.from("leads").update({ followup_count: n, last_followup_at: new Date(now).toISOString() }).eq("id", lead.id).eq("followup_count", count).select("id");
    if (!claimed?.length) continue;

    try {
      const text = await buildFollowupText(n, lead, history);
      const waId = await sendText(lead.phone, text, typingDelay(text));
      await db.from("messages").insert({ lead_id: lead.id, role: "ia", content: text, wa_id: waId ?? null, processed: true });
      await logEvent(lead.id, "followup_sent", { n });
      sent++;
    } catch (e) {
      await db.from("leads").update({ followup_count: count, last_followup_at: lead.last_followup_at }).eq("id", lead.id);
      await logEvent(lead.id, "followup_error", { n, error: String(e).slice(0, 300) });
    }
  }
  return { checked: leads.length, sent };
}
