import { getScripts } from "@/lib/data";
import { approveScript, rejectScript, runLearningNow } from "@/app/actions";

export const dynamic = "force-dynamic";

const fmt = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", timeZone: "America/Fortaleza" });

export default async function Script() {
  const { versions, insights } = await getScripts();
  const active = versions.find((v) => v.status === "ativa");
  const proposals = versions.filter((v) => v.status === "proposta");
  const latest = insights[0];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Script da IA</h1>
          <p className="max-w-xl text-sm text-muted">
            Toda segunda a IA analisa as conversas da semana, compara o que converteu com o que perdeu lead e propõe ajustes. Nada entra no ar sem a sua aprovação. Preços, horários e endereço nunca são alterados pela IA.
          </p>
        </div>
        <form action={runLearningNow}>
          <button className="btn">Rodar análise agora</button>
        </form>
      </header>

      {proposals.map((p) => (
        <section key={p.id} className="card border-brand/40 p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <span className="chip bg-warn-soft text-warn">Proposta v{p.version}</span>
              <span className="ml-2 text-xs text-muted">gerada em {fmt(p.created_at)}</span>
            </div>
            <div className="flex gap-2">
              <form action={rejectScript.bind(null, p.id)}><button className="btn">Rejeitar</button></form>
              <form action={approveScript.bind(null, p.id)}><button className="btn btn-primary">Aprovar e ativar</button></form>
            </div>
          </div>
          {p.rationale && <p className="mb-3 text-sm">{p.rationale}</p>}
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">O que muda</h3>
          <ul className="list-disc space-y-1.5 pl-5 text-sm">
            {p.changes.map((c, i) => <li key={i}>{c}</li>)}
          </ul>
          <details className="mt-4">
            <summary className="cursor-pointer text-sm text-brand">Ver script completo proposto</summary>
            <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-bg p-3 text-xs leading-relaxed">{p.prompt}</pre>
          </details>
        </section>
      ))}

      {latest && (
        <section className="card p-5">
          <h2 className="mb-3 text-sm font-semibold">O que a IA aprendeu na última análise</h2>
          <ul className="space-y-2.5">
            {latest.findings.map((f, i) => (
              <li key={i} className="flex gap-3 text-sm">
                <span className={`chip h-fit shrink-0 ${f.type === "funcionou" ? "bg-ok-soft text-green-800" : "bg-bad-soft text-bad"}`}>{f.type === "funcionou" ? "Funcionou" : "Perdeu lead"}</span>
                <span>{f.pattern} <span className="text-muted">— {f.evidence}</span></span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card p-5">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Script em uso {active && <span className="font-normal text-muted">· v{active.version}</span>}</h2>
        </div>
        <details>
          <summary className="cursor-pointer text-sm text-brand">Ver texto</summary>
          <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-bg p-3 text-xs leading-relaxed">{active?.prompt ?? "Usando o script padrão do código."}</pre>
        </details>
        <h3 className="mb-1.5 mt-5 text-xs font-semibold uppercase tracking-wide text-muted">Histórico</h3>
        <ul className="divide-y divide-line text-sm">
          {versions.map((v) => (
            <li key={v.id} className="flex justify-between py-2">
              <span>v{v.version}</span>
              <span className="capitalize text-muted">{v.status} · {fmt(v.created_at)}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
