import { admin } from "./supabase-admin";

const OFFSET_MS = 3 * 3600e3; // Fortaleza = UTC-3
const WON = ["agendado", "compareceu"];

export type ReportMetrics = {
  leads: number;
  leadsPrev: number;
  agendamentos: number;
  agendamentosPrev: number;
  conversao: number; // 0..1: leads da semana que chegaram a agendar
  compareceram: number;
  faltaram: number;
  comparecimento: number | null;
  porEspecialidade: { especialidade: string; leads: number; agendamentos: number }[];
  perdidos: Record<string, number>;
  automacao: { lembretes: number; confirmados: number; retomadas: number };
};

/** Segunda-feira 00:00 (Fortaleza) mais recente que `now`, em instante UTC. */
export function lastMondayStart(now = Date.now()): number {
  const l = new Date(now - OFFSET_MS);
  const back = (l.getUTCDay() + 6) % 7; // segunda = 0
  return Date.UTC(l.getUTCFullYear(), l.getUTCMonth(), l.getUTCDate() - back) + OFFSET_MS;
}
export const isMondayLocal = (now = Date.now()) => new Date(now - OFFSET_MS).getUTCDay() === 1;

const dm = (t: number) => new Date(t - OFFSET_MS).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
const pct = (x: number) => `${Math.round(x * 100)}%`;
const delta = (cur: number, prev: number) => (cur === prev ? "igual à semana anterior" : `${cur > prev ? "+" : "-"}${Math.abs(cur - prev)} em relação à semana anterior (${prev})`);

export function buildSummary(startMs: number, endMs: number, m: ReportMetrics): string {
  const lines: string[] = [];
  lines.push(`Semana de ${dm(startMs)} a ${dm(endMs - 1)}.`);
  if (m.leads === 0) lines.push("Nenhum lead novo chegou nesta semana.");
  else lines.push(`Chegaram ${m.leads} leads novos (${delta(m.leads, m.leadsPrev)}). ${m.agendamentos} consultas foram agendadas (${delta(m.agendamentos, m.agendamentosPrev)}), e ${pct(m.conversao)} dos leads da semana chegaram a agendar.`);
  if (m.compareceram + m.faltaram > 0) lines.push(`Das consultas da semana com baixa, ${m.compareceram} compareceram e ${m.faltaram} faltaram (comparecimento de ${pct(m.comparecimento ?? 0)}).`);
  else lines.push("Ainda não há baixa de comparecimento nas consultas da semana (use a página Consultas para registrar).");
  const top = m.porEspecialidade[0];
  if (top && top.leads > 0) lines.push(`Especialidade em destaque: ${top.especialidade}, com ${top.leads} leads e ${top.agendamentos} agendamentos.`);
  const lost = Object.entries(m.perdidos).sort((a, b) => b[1] - a[1])[0];
  if (lost) lines.push(`Principal motivo de perda: ${lost[0]} (${lost[1]} ${lost[1] === 1 ? "lead" : "leads"}).`);
  const a = m.automacao;
  if (a.lembretes || a.retomadas) lines.push(`A Marcelia enviou ${a.lembretes} lembretes de consulta (${a.confirmados} confirmados) e ${a.retomadas} mensagens de retomada.`);
  return lines.join("\n");
}

type L = { id: string; specialty: string | null; stage: string; lost_reason: string | null };
type A = { specialty: string; lead_id: string };

async function countEvents(type: string, from: string, to: string) {
  const { count } = await admin().from("lead_events").select("id", { count: "exact", head: true }).eq("type", type).gte("created_at", from).lt("created_at", to);
  return count ?? 0;
}

/** Gera (ou regera) o relatório da última semana fechada. Idempotente por semana. */
export async function generateWeeklyReport(now = Date.now()): Promise<{ status: "ok"; periodStart: string; leads: number }> {
  const db = admin();
  const endMs = lastMondayStart(now);
  const startMs = endMs - 7 * 86400e3;
  const prevStart = startMs - 7 * 86400e3;
  const iso = (t: number) => new Date(t).toISOString();

  const [{ data: leadsData, error }, { data: apData }, { data: prevLeads }, { data: prevAp }, { data: done }] = await Promise.all([
    db.from("leads").select("id, specialty, stage, lost_reason").gte("created_at", iso(startMs)).lt("created_at", iso(endMs)),
    db.from("appointments").select("specialty, lead_id").gte("created_at", iso(startMs)).lt("created_at", iso(endMs)),
    db.from("leads").select("id").gte("created_at", iso(prevStart)).lt("created_at", iso(startMs)),
    db.from("appointments").select("id").gte("created_at", iso(prevStart)).lt("created_at", iso(startMs)),
    db.from("appointments").select("status").in("status", ["compareceu", "faltou"]).gte("starts_at", iso(startMs)).lt("starts_at", iso(endMs)),
  ]);
  if (error) throw new Error(`relatório: ${error.message}`);
  const leads = (leadsData ?? []) as L[];
  const appts = (apData ?? []) as A[];

  const spec: Record<string, { leads: number; agendamentos: number }> = {};
  const key = (s: string | null) => s ?? "a definir";
  for (const l of leads) (spec[key(l.specialty)] ??= { leads: 0, agendamentos: 0 }).leads++;
  for (const a of appts) (spec[key(a.specialty)] ??= { leads: 0, agendamentos: 0 }).agendamentos++;
  const perdidos: Record<string, number> = {};
  for (const l of leads) if (l.stage === "perdido") perdidos[l.lost_reason ?? "sem motivo registrado"] = (perdidos[l.lost_reason ?? "sem motivo registrado"] ?? 0) + 1;

  const compareceram = (done ?? []).filter((d) => d.status === "compareceu").length;
  const faltaram = (done ?? []).filter((d) => d.status === "faltou").length;
  const [lembretes, confirmados, retomadas] = await Promise.all([
    countEvents("reminder_sent", iso(startMs), iso(endMs)),
    countEvents("appointment_confirmed", iso(startMs), iso(endMs)),
    countEvents("followup_sent", iso(startMs), iso(endMs)),
  ]);

  const metrics: ReportMetrics = {
    leads: leads.length,
    leadsPrev: prevLeads?.length ?? 0,
    agendamentos: appts.length,
    agendamentosPrev: prevAp?.length ?? 0,
    conversao: leads.length ? leads.filter((l) => WON.includes(l.stage)).length / leads.length : 0,
    compareceram,
    faltaram,
    comparecimento: compareceram + faltaram ? compareceram / (compareceram + faltaram) : null,
    porEspecialidade: Object.entries(spec).map(([especialidade, v]) => ({ especialidade, ...v })).sort((a, b) => b.leads - a.leads || b.agendamentos - a.agendamentos),
    perdidos,
    automacao: { lembretes, confirmados, retomadas },
  };
  const { error: upErr } = await db
    .from("weekly_reports")
    .upsert({ period_start: iso(startMs), period_end: iso(endMs), metrics, summary: buildSummary(startMs, endMs, metrics) }, { onConflict: "period_start" });
  if (upErr) throw new Error(`relatório: ${upErr.message}`); // ex.: migração 005 ainda não aplicada
  return { status: "ok", periodStart: iso(startMs), leads: leads.length };
}
