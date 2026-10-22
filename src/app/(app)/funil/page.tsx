import Link from "next/link";
import { getAppointments, getLeads } from "@/lib/data";
import { SPECIALTIES, STAGES, STAGE_LABEL } from "@/lib/clinic-config";
import { SpecialtyChip } from "@/components/ui";
import { StageSelect } from "@/components/StageSelect";
import { AttendanceButtons } from "@/components/AttendanceButtons";
import { isPaused, relTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function Funil({ searchParams }: { searchParams: Promise<{ esp?: string }> }) {
  const { esp } = await searchParams;
  const [all, appts] = await Promise.all([getLeads(), getAppointments()]);
  // consulta mais recente já iniciada (ou prestes a) de cada lead, para dar baixa direto no cartão
  const attendable = new Map<string, (typeof appts)[number]>();
  for (const a of appts) {
    if (!["agendado", "compareceu", "faltou"].includes(a.status) || +new Date(a.starts_at) > Date.now() + 2 * 3600e3) continue;
    const cur = attendable.get(a.lead_id);
    if (!cur || +new Date(a.starts_at) > +new Date(cur.starts_at)) attendable.set(a.lead_id, a);
  }
  const leads = esp ? all.filter((l) => (l.specialty ?? "a definir") === esp) : all;
  const filters = [...SPECIALTIES.filter((s) => s !== "outra"), "a definir"];

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Funil</h1>
          <p className="text-sm text-muted">O agente move os leads de etapa sozinho. Você pode ajustar manualmente.</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Link href="/funil" className={`chip border ${!esp ? "border-brand bg-brand-soft text-brand" : "border-line bg-white text-muted"}`}>Todas</Link>
          {filters.map((f) => (
            <Link key={f} href={`/funil?esp=${encodeURIComponent(f)}`} className={`chip border capitalize ${esp === f ? "border-brand bg-brand-soft text-brand" : "border-line bg-white text-muted"}`}>
              {f}
            </Link>
          ))}
        </div>
      </header>

      <div className="flex gap-3 overflow-x-auto pb-3">
        {STAGES.map((s) => {
          const col = leads.filter((l) => l.stage === s);
          return (
            <section key={s} className="w-64 shrink-0">
              <div className="mb-2 flex items-center justify-between px-1">
                <h2 className="text-sm font-semibold">{STAGE_LABEL[s]}</h2>
                <span className="text-xs tabular-nums text-muted">{col.length}</span>
              </div>
              <div className="space-y-2">
                {col.map((l) => (
                  <article key={l.id} className="card p-3">
                    <Link href={`/conversas?lead=${l.id}`} className="block">
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-medium leading-tight">{l.name ?? l.phone}</span>
                        {l.score != null && <span className="text-xs tabular-nums text-muted">{l.score}</span>}
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        <SpecialtyChip s={l.specialty} />
                        {l.insurance && <span className="chip bg-slate-100 text-slate-700">{l.insurance}</span>}
                        {isPaused(l.ai_paused_until) && <span className="chip bg-warn-soft text-warn">humano</span>}
                      </div>
                      {l.intent && <p className="mt-2 line-clamp-2 text-xs text-muted">{l.intent}</p>}
                      {l.lost_reason && <p className="mt-2 text-xs text-bad">Perdido: {l.lost_reason}</p>}
                    </Link>
                    {attendable.get(l.id) && (s === "agendado" || s === "compareceu" || attendable.get(l.id)!.status === "faltou") && (
                      <div className="mt-2"><AttendanceButtons appointmentId={attendable.get(l.id)!.id} status={attendable.get(l.id)!.status} /></div>
                    )}
                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-xs text-muted">há {relTime(l.last_message_at)}</span>
                      <StageSelect leadId={l.id} stage={l.stage} />
                    </div>
                  </article>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
