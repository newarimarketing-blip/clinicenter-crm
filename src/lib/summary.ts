import { isDemo } from "./supabase-server";
import { admin } from "./supabase-admin";
import { openai } from "./openai";
import type { Lead, Message } from "./types";

const clip = (t: string, n = 140) => (t.length > n ? `${t.slice(0, n)}…` : t);

/** Resumo sem IA (modo demonstração, sem chave ou erro): últimas falas do paciente. */
function fallbackSummary(msgs: Message[]): string {
  const mine = msgs.filter((m) => m.role === "lead").slice(-3);
  if (!mine.length) return "Ainda não há mensagens do paciente.";
  return `Últimas mensagens do paciente: ${mine.map((m) => `“${clip(m.content)}”`).join(" · ")}`;
}

/**
 * Resumo da conversa em linguagem simples. Fica salvo no lead e só é refeito quando há mensagem
 * nova (summary_at < last_message_at), então abrir o card várias vezes não gera custo repetido.
 */
export async function ensureSummary(lead: Lead, msgs: Message[]): Promise<{ text: string; fresh: boolean }> {
  if (!msgs.length) return { text: "Ainda não há conversa com este contato.", fresh: true };
  const upToDate = lead.summary && lead.summary_at && (!lead.last_message_at || +new Date(lead.summary_at) >= +new Date(lead.last_message_at));
  if (upToDate) return { text: lead.summary!, fresh: true };
  if (isDemo || !process.env.OPENAI_API_KEY) return { text: lead.summary ?? fallbackSummary(msgs), fresh: false };
  try {
    const convo = msgs.slice(-60).map((m) => `${m.role === "lead" ? "Paciente" : m.role === "ia" ? "Marcelia (IA)" : "Equipe"}: ${clip(m.content, 400)}`).join("\n");
    const r = await openai().chat.completions.create({
      model: process.env.LEARN_MODEL || process.env.AGENT_MODEL || "gpt-4.1-mini",
      temperature: 0.2,
      max_tokens: 260,
      messages: [
        {
          role: "system",
          content:
            "Você resume conversas de WhatsApp de uma clínica para a recepção. Em português, 3 a 5 frases curtas, sem listas: quem é o paciente e o que procura, objeções ou dúvidas (preço, convênio, horário), em que ponto está e qual o próximo passo. Não invente nada que não esteja na conversa e não repita dados sensíveis desnecessários.",
        },
        { role: "user", content: convo },
      ],
    });
    const text = r.choices[0]?.message?.content?.trim();
    if (!text) return { text: lead.summary ?? fallbackSummary(msgs), fresh: false };
    await admin().from("leads").update({ summary: text, summary_at: new Date().toISOString() }).eq("id", lead.id); // sem a migração 006 apenas não grava
    return { text, fresh: true };
  } catch {
    return { text: lead.summary ?? fallbackSummary(msgs), fresh: false };
  }
}
