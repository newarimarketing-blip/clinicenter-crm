import { admin } from "./supabase-admin";
import { openai } from "./openai";
import { activeScript } from "./agent";
import { DEFAULT_SCRIPT } from "./default-script";
import type { Lead, Message } from "./types";

const WON = ["agendado", "compareceu"];
const MIN_LEADS = 15;

type Transcript = { lead: Lead; text: string };

async function transcripts(leads: Lead[], max: number): Promise<Transcript[]> {
  const out: Transcript[] = [];
  for (const lead of leads.slice(0, max)) {
    const { data } = await admin().from("messages").select("role,content").eq("lead_id", lead.id).order("created_at").limit(60);
    const text = ((data ?? []) as Pick<Message, "role" | "content">[])
      .map((m) => `${m.role === "lead" ? "PACIENTE" : "MARCELIA"}: ${m.content}`)
      .join("\n")
      .slice(0, 1800);
    out.push({ lead, text });
  }
  return out;
}

/** Análise semanal: mede o funil, compara conversas que converteram e que se perderam, e PROPÕE uma nova versão do script. */
export async function runLearning(days = 7): Promise<{ status: "ok" | "skipped"; reason?: string; versionId?: string }> {
  const db = admin();
  const end = new Date();
  const start = new Date(end.getTime() - days * 86400e3);
  const { data } = await db.from("leads").select("*").gte("created_at", start.toISOString());
  const leads = (data ?? []) as Lead[];
  if (leads.length < MIN_LEADS) return { status: "skipped", reason: `apenas ${leads.length} leads no período (mínimo ${MIN_LEADS})` };

  const bySpecialty: Record<string, { leads: number; agendados: number }> = {};
  for (const l of leads) {
    const k = l.specialty ?? "indefinida";
    bySpecialty[k] ??= { leads: 0, agendados: 0 };
    bySpecialty[k].leads++;
    if (WON.includes(l.stage)) bySpecialty[k].agendados++;
  }
  const byStage: Record<string, number> = {};
  for (const l of leads) byStage[l.stage] = (byStage[l.stage] ?? 0) + 1;
  const lostReasons: Record<string, number> = {};
  for (const l of leads) if (l.lost_reason) lostReasons[l.lost_reason] = (lostReasons[l.lost_reason] ?? 0) + 1;
  const won = leads.filter((l) => WON.includes(l.stage));
  // conversão REAL (dada pela recepção em Consultas): compareceu x faltou, entre as consultas do período
  const { data: ap } = await db.from("appointments").select("status, specialty, lead_id").gte("starts_at", start.toISOString()).lte("starts_at", end.toISOString());
  const appts = (ap ?? []) as { status: string; specialty: string; lead_id: string }[];
  const attendedN = appts.filter((a) => a.status === "compareceu").length;
  const noShowN = appts.filter((a) => a.status === "faltou").length;
  const noShowIds = new Set(appts.filter((a) => a.status === "faltou").map((a) => a.lead_id));
  const attendedIds = new Set(appts.filter((a) => a.status === "compareceu").map((a) => a.lead_id));
  const metrics = {
    total: leads.length, conversao: +(won.length / leads.length).toFixed(3), bySpecialty, byStage, lostReasons,
    compareceram: attendedN, faltaram: noShowN, comparecimento: attendedN + noShowN ? +(attendedN / (attendedN + noShowN)).toFixed(3) : null,
  };

  // perdidos = marcados como perdido ou parados sem agendar (>48h sem resposta do paciente)
  const cutoff = Date.now() - 48 * 3600e3;
  const lost = leads.filter((l) => !WON.includes(l.stage) && !noShowIds.has(l.id) && (l.stage === "perdido" || (l.last_inbound_at && +new Date(l.last_inbound_at) < cutoff)));
  // conversas que realmente levaram o paciente à clínica vêm primeiro; as de quem faltou entram à parte
  won.sort((a, b) => Number(attendedIds.has(b.id)) - Number(attendedIds.has(a.id)));
  const noShowLeads = leads.filter((l) => noShowIds.has(l.id));
  const [wonT, lostT, noShowT] = await Promise.all([transcripts(won, 15), transcripts(lost, 15), transcripts(noShowLeads, 6)]);

  const current = await activeScript();
  const sys = `Você é um consultor de vendas de clínicas de saúde. Analisa conversas de WhatsApp de uma atendente virtual (Marcelia) e melhora o SCRIPT dela.
Regras invioláveis ao reescrever:
- Não altere preços, horários, endereço nem convênios (eles vêm de outra fonte, não do script).
- Não introduza escassez falsa, promessas de cura, diagnóstico, orientação clínica nem pressão indevida.
- Mantenha as seções do script, a persona e o uso das ferramentas (consultar_horarios, agendar_consulta, atualizar_lead, etc.).
- Mude pouco e com evidência: no máximo 5 alterações, cada uma ligada a um padrão visto nas conversas.
Responda SOMENTE JSON: {"findings":[{"type":"funcionou"|"perdeu","pattern":"...","evidence":"quantas conversas / exemplo curto"}],"changes":["alteração em linguagem simples"],"rationale":"resumo em 2 frases","proposed_prompt":"script completo reescrito"}`;
  const user = `MÉTRICAS DA SEMANA:\n${JSON.stringify(metrics)}\n\nSCRIPT ATUAL:\n${current.prompt}\n\nCONVERSAS QUE AGENDARAM:\n${wonT.map((t) => `--- (${t.lead.specialty ?? "?"})\n${t.text}`).join("\n")}\n\nCONVERSAS DE QUEM AGENDOU MAS FALTOU (aprenda o que reduz faltas: confirmação, lembrete, clareza do horário/endereço):\n${noShowT.map((t) => `--- (${t.lead.specialty ?? "?"})\n${t.text}`).join("\n")}\n\nCONVERSAS PERDIDAS/PARADAS:\n${lostT.map((t) => `--- (${t.lead.specialty ?? "?"}, motivo: ${t.lead.lost_reason ?? "não informado"})\n${t.text}`).join("\n")}`;

  const res = await openai().chat.completions.create({
    model: process.env.LEARN_MODEL || "gpt-4.1",
    response_format: { type: "json_object" },
    temperature: 0.3,
    messages: [{ role: "system", content: sys }, { role: "user", content: user }],
  });
  const out = JSON.parse(res.choices[0].message.content ?? "{}") as {
    findings: { type: "funcionou" | "perdeu"; pattern: string; evidence: string }[];
    changes: string[];
    rationale: string;
    proposed_prompt: string;
  };
  const base = current.prompt || DEFAULT_SCRIPT;
  if (!out.proposed_prompt || out.proposed_prompt.length < base.length * 0.6 || out.proposed_prompt.length > base.length * 1.5) {
    return { status: "skipped", reason: "proposta fora do tamanho esperado; descartada por segurança" };
  }

  const { data: ver, error } = await db
    .from("script_versions")
    .insert({ status: "proposta", prompt: out.proposed_prompt, rationale: out.rationale, changes: out.changes, parent_id: current.id })
    .select("id")
    .single();
  if (error) throw error;
  await db.from("script_insights").insert({ period_start: start.toISOString(), period_end: end.toISOString(), metrics, findings: out.findings, script_version_id: ver.id });
  return { status: "ok", versionId: ver.id };
}
