import Link from "next/link";
import { getLeads } from "@/lib/data";
import { STAGES, STAGE_LABEL } from "@/lib/clinic-config";
import { Bar, Kpi, SpecialtyChip, StageChip } from "@/components/ui";
import { isPaused, relTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function Painel() {
  const all = await getLeads();
  const since = Date.now() - 30 * 86400e3;
  const leads = all.filter((l) => +new Date(l.created_at) >= since);
  const won = leads.filter((l) => l.stage === "agendado" || l.stage === "compareceu");
  const conv = leads.length ? Math.round((won.length / leads.length) * 100) : 0;
  const paused = leads.filter((l) => isPaused(l.ai_paused_until));
  const stale = leads.filter((l) => ["qualificado", "horario_oferecido"].includes(l.stage) && l.last_inbound_at && Date.now() - +new Date(l.last_inbound_at) > 6 * 3600e3);

  const specs = Object.entries(
    leads.reduce<Record<string, { n: number; w: number }>>((a, l) => {
      const k = l.specialty ?? "a definir";
      a[k] ??= { n: 0, w: 0 };
      a[k].n++;
      if (l.stage === "agendado" || l.stage === "compareceu") a[k].w++;
      return a;
    }, {}),
  ).sort((a, b) => b[1].n - a[1].n);
  const maxSpec = Math.max(1, ...specs.map(([, v]) => v.n));
  const byStage = STAGES.map((s) => ({ s, n: leads.filter((l) => l.stage === s).length }));
  const maxStage = Math.max(1, ...byStage.map((b) => b.n));
  const attention = leads.filter((l) => (l.stage !== "agendado" && l.stage !== "compareceu" && l.stage !== "perdido" && (l.score ?? 0) >= 60) || isPaused(l.ai_paused_until)).slice(0, 6);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Painel</h1>
        <p className="text-sm text-muted">Quem chegou, para qual especialidade e em que ponto do funil está.</p>
      </header>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Leads" value={leads.length} hint="últimos 30 dias" />
        <Kpi label="Agendados" value={won.length} hint={`${conv}% de conversão`} />
        <Kpi label="Aguardando retorno" value={stale.length} hint="sem resposta há +6 h" />
        <Kpi label="IA pausada" value={paused.length} hint="humano no comando" />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <h2 className="mb-4 text-sm font-semibold">Leads por especialidade</h2>
          <div className="space-y-4">
            {specs.map(([k, v]) => (
              <Bar key={k} label={k} value={v.n} max={maxSpec} sub={`${v.n} leads · ${v.w} agendados`} />
            ))}
          </div>
        </div>
        <div className="card p-5">
          <h2 className="mb-4 text-sm font-semibold">Funil</h2>
          <div className="space-y-4">
            {byStage.map((b) => (
              <Bar key={b.s} label={STAGE_LABEL[b.s]} value={b.n} max={maxStage} />
            ))}
          </div>
        </div>
      </section>

      <section className="card p-5">
        <h2 className="mb-3 text-sm font-semibold">Precisam de atenção</h2>
        <ul className="divide-y divide-line">
          {attention.length === 0 && <li className="py-3 text-sm text-muted">Nada pendente.</li>}
          {attention.map((l) => (
            <li key={l.id}>
              <Link href={`/conversas?lead=${l.id}`} className="flex flex-wrap items-center gap-3 py-3 hover:bg-black/[0.02]">
                <span className="w-40 font-medium">{l.name ?? l.phone}</span>
                <SpecialtyChip s={l.specialty} />
                <StageChip stage={l.stage} />
                {isPaused(l.ai_paused_until) && <span className="chip bg-warn-soft text-warn">IA pausada</span>}
                <span className="min-w-0 flex-1 truncate text-sm text-muted">{l.intent}</span>
                <span className="text-xs text-muted">há {relTime(l.last_message_at)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
