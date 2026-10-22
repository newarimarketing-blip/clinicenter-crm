import Link from "next/link";
import { getAppointments, getMessages } from "@/lib/data";
import { isDemo, supabaseServer } from "@/lib/supabase-server";
import { ensureSummary } from "@/lib/summary";
import { saveLeadNotes } from "@/app/actions";
import { StageChip, SpecialtyChip } from "@/components/ui";
import { StageSelect } from "@/components/StageSelect";
import { fmtDateTime } from "@/lib/time";
import { isPaused, phoneFmt, relTime } from "@/lib/format";
import type { Lead } from "@/lib/types";

type Ev = { type: string; created_at: string; data: Record<string, unknown> };

const EVENT_LABEL: Record<string, (d: Record<string, unknown>) => string | null> = {
  lead_created: () => "Primeiro contato",
  stage_changed: (d) => `Etapa: ${String(d.to ?? "")}`,
  appointment_created: () => "Consulta agendada",
  appointment_cancelled: () => "Consulta cancelada",
  appointment_rescheduled: () => "Consulta remarcada",
  appointment_confirmed: () => "Presença confirmada pelo paciente",
  reminder_sent: () => "Lembrete de consulta enviado",
  followup_sent: (d) => `Retomada automática nº ${String(d.n ?? "")} enviada`,
  handoff: (d) => `Passou para a equipe${d.motivo ? `: ${String(d.motivo)}` : ""}`,
  attendance_marked: (d) => (d.result === "compareceu" ? "Compareceu" : d.result === "faltou" ? "Faltou" : "Baixa desfeita"),
};

const day = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Fortaleza" });

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg bg-bg px-3 py-2">
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      <div className="text-[11px] leading-tight text-muted">{label}</div>
    </div>
  );
}

/** Painel lateral do card do funil: resumo, tentativas de contato, descrição do paciente, consultas e notas. */
export async function LeadPanel({ lead, closeHref }: { lead: Lead; closeHref: string }) {
  const [msgs, appts, events] = await Promise.all([
    getMessages(lead.id),
    getAppointments().then((a) => a.filter((x) => x.lead_id === lead.id).sort((x, y) => +new Date(y.starts_at) - +new Date(x.starts_at))),
    (async (): Promise<Ev[]> => {
      if (isDemo) return [];
      const db = await supabaseServer();
      const { data } = await db.from("lead_events").select("type, created_at, data").eq("lead_id", lead.id).order("created_at", { ascending: false }).limit(60);
      return (data ?? []) as Ev[];
    })(),
  ]);
  const summary = await ensureSummary(lead, msgs);

  const fromLead = msgs.filter((m) => m.role === "lead").length;
  const fromIa = msgs.filter((m) => m.role === "ia").length;
  const fromTeam = msgs.filter((m) => m.role === "humano").length;
  const followups = events.filter((e) => e.type === "followup_sent").length;
  const reminders = events.filter((e) => e.type === "reminder_sent").length;
  const daysIn = Math.max(0, Math.floor((Date.now() - +new Date(lead.created_at)) / 86400e3));
  const next = appts.find((a) => a.status === "agendado" && +new Date(a.starts_at) > Date.now());
  const timeline = events.map((e) => ({ at: e.created_at, text: EVENT_LABEL[e.type]?.(e.data ?? {}) ?? null })).filter((e) => e.text).slice(0, 12);
  const wa = `https://wa.me/${lead.phone}`;

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <Link href={closeHref} aria-label="Fechar" className="absolute inset-0 bg-black/30" />
      <aside className="relative h-full w-full max-w-md space-y-5 overflow-y-auto bg-white p-5 shadow-xl">
        <header className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold leading-tight">{lead.patient_name ?? lead.name ?? phoneFmt(lead.phone)}</h2>
            <p className="text-sm text-muted">{lead.patient_name && lead.name ? `Contato: ${lead.name} · ` : ""}{phoneFmt(lead.phone)}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <StageChip stage={lead.stage} />
              <SpecialtyChip s={lead.specialty} />
              {lead.insurance && <span className="chip bg-slate-100 text-slate-700">{lead.insurance}</span>}
              {lead.score != null && <span className="chip bg-slate-100 text-slate-700">score {lead.score}</span>}
              {isPaused(lead.ai_paused_until) && <span className="chip bg-warn-soft text-warn">humano</span>}
            </div>
          </div>
          <Link href={closeHref} className="btn !px-3 !py-1.5">Fechar</Link>
        </header>

        <div className="flex flex-wrap gap-2">
          <Link href={`/conversas?lead=${lead.id}`} className="btn btn-primary">Abrir conversa</Link>
          <a href={wa} target="_blank" rel="noreferrer" className="btn">WhatsApp</a>
          <StageSelect leadId={lead.id} stage={lead.stage} />
        </div>

        <section>
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Resumo da conversa</h3>
          <p className="text-sm leading-relaxed">{summary.text}</p>
          {!summary.fresh && <p className="mt-1 text-xs text-muted">Resumo simples (a IA não conseguiu atualizar agora).</p>}
        </section>

        <section>
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Contatos e tentativas</h3>
          <div className="grid grid-cols-3 gap-2">
            <Stat label="mensagens do paciente" value={fromLead} />
            <Stat label="respostas da IA" value={fromIa} />
            <Stat label="respostas da equipe" value={fromTeam} />
            <Stat label="retomadas automáticas" value={followups || (lead.followup_count ?? 0)} />
            <Stat label="lembretes de consulta" value={reminders} />
            <Stat label="dias no funil" value={daysIn} />
          </div>
          <p className="mt-2 text-xs text-muted">
            Primeiro contato em {day(lead.created_at)} · última mensagem do paciente há {relTime(lead.last_inbound_at)}
            {lead.last_followup_at ? ` · última retomada há ${relTime(lead.last_followup_at)}` : ""}
          </p>
        </section>

        <section>
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Descrição do paciente</h3>
          <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1.5 text-sm">
            <dt className="text-muted">Procura</dt><dd>{lead.intent ?? "—"}</dd>
            <dt className="text-muted">Paciente</dt><dd>{lead.patient_name ?? lead.name ?? "—"}</dd>
            <dt className="text-muted">Especialidade</dt><dd className="capitalize">{lead.specialty ?? "a definir"}</dd>
            <dt className="text-muted">Convênio</dt><dd>{lead.insurance ?? "—"}</dd>
            <dt className="text-muted">Origem</dt><dd>{lead.source ?? "—"}</dd>
            {lead.email && (<><dt className="text-muted">E-mail</dt><dd className="break-all">{lead.email}</dd></>)}
            {lead.lost_reason && (<><dt className="text-bad">Motivo da perda</dt><dd className="text-bad">{lead.lost_reason}</dd></>)}
          </dl>
        </section>

        <section>
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Consultas</h3>
          {appts.length === 0 && <p className="text-sm text-muted">Nenhuma consulta.</p>}
          <ul className="space-y-1.5 text-sm">
            {appts.slice(0, 6).map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-bg px-3 py-2">
                <span>{a.professional} · {fmtDateTime(a.starts_at)}</span>
                <span className={`chip ${a.id === next?.id ? "bg-ok-soft text-green-800" : "bg-slate-100 text-slate-700"}`}>
                  {a.id === next?.id ? (a.confirmed_at ? "próxima · confirmada" : "próxima") : a.status}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {timeline.length > 0 && (
          <section>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Linha do tempo</h3>
            <ul className="space-y-1 text-sm">
              {timeline.map((t, i) => (
                <li key={i} className="flex gap-2"><span className="w-12 shrink-0 text-xs tabular-nums text-muted">{day(t.at)}</span><span>{t.text}</span></li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Notas internas</h3>
          <form action={saveLeadNotes.bind(null, lead.id)} className="space-y-2">
            <textarea name="notes" rows={3} defaultValue={lead.notes ?? ""} placeholder="Observações da equipe (o paciente não vê)" className="w-full rounded-lg border border-line px-3 py-2 text-sm" />
            <button className="btn">Salvar nota</button>
          </form>
        </section>
      </aside>
    </div>
  );
}
