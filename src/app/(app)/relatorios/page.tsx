import Link from "next/link";
import { getWeeklyReports } from "@/lib/data";
import { generateReportNow } from "@/app/actions";
import { Bar, Kpi } from "@/components/ui";

export const dynamic = "force-dynamic";

const dm = (iso: string, plus = 0) => new Date(+new Date(iso) + plus).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Fortaleza" });
const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);

export default async function Relatorios({ searchParams }: { searchParams: Promise<{ id?: string; erro?: string }> }) {
  const { id, erro } = await searchParams;
  const { reports, missingTable } = await getWeeklyReports();
  const r = reports.find((x) => x.id === id) ?? reports[0];
  const m = r?.metrics;
  const maxSpec = Math.max(1, ...(m?.porEspecialidade ?? []).map((s) => s.leads));

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Relatório semanal</h1>
          <p className="max-w-xl text-sm text-muted">Gerado automaticamente toda segunda-feira, de segunda a domingo da semana anterior. Pronto para apresentar ao cliente.</p>
        </div>
        <form action={generateReportNow}>
          <button className="btn">Gerar agora (última semana)</button>
        </form>
      </header>

      {erro && <p className="rounded-lg bg-bad-soft px-4 py-3 text-sm text-bad">{erro}</p>}
      {missingTable && <p className="rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">A tabela de relatórios ainda não foi criada no Supabase (migração 005).</p>}

      {!r && !missingTable && <p className="card p-5 text-sm text-muted">Nenhum relatório ainda. O primeiro sai na próxima segunda-feira, ou clique em “Gerar agora”.</p>}

      {r && m && (
        <>
          <p className="text-sm font-medium">
            Semana de {dm(r.period_start)} a {dm(r.period_end, -1)}
          </p>
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Leads" value={m.leads} hint={`semana anterior: ${m.leadsPrev}`} />
            <Kpi label="Agendamentos" value={m.agendamentos} hint={`semana anterior: ${m.agendamentosPrev}`} />
            <Kpi label="Conversão" value={pct(m.conversao)} hint="leads da semana que agendaram" />
            <Kpi label="Comparecimento" value={pct(m.comparecimento)} hint={`${m.compareceram} compareceram · ${m.faltaram} faltaram`} />
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <div className="card p-5">
              <h2 className="mb-4 text-sm font-semibold">Especialidades em destaque</h2>
              <div className="space-y-4">
                {m.porEspecialidade.length === 0 && <p className="text-sm text-muted">Sem leads na semana.</p>}
                {m.porEspecialidade.map((s) => (
                  <Bar key={s.especialidade} label={s.especialidade} value={s.leads} max={maxSpec} sub={`${s.leads} leads · ${s.agendamentos} agendamentos`} />
                ))}
              </div>
            </div>
            <div className="card p-5">
              <h2 className="mb-3 text-sm font-semibold">Resumo</h2>
              <div className="space-y-2 text-sm leading-relaxed">
                {r.summary.split("\n").map((line, i) => (
                  <p key={i}>{line}</p>
                ))}
              </div>
            </div>
          </section>
        </>
      )}

      {reports.length > 1 && (
        <section className="card p-5">
          <h2 className="mb-2 text-sm font-semibold">Relatórios anteriores</h2>
          <ul className="flex flex-wrap gap-2">
            {reports.map((x) => (
              <li key={x.id}>
                <Link href={`/relatorios?id=${x.id}`} className={`chip border ${x.id === r?.id ? "border-brand bg-brand-soft text-brand" : "border-line bg-white text-muted"}`}>
                  {dm(x.period_start)} – {dm(x.period_end, -1)}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
