import { getClinicSettings } from "@/lib/clinic-settings";
import { listAbsences } from "@/lib/absences";
import { isDemo } from "@/lib/supabase-server";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { desfazerFalta, registrarFalta } from "@/app/faltas-actions";

export const dynamic = "force-dynamic";
const input = "w-full rounded-lg border border-line bg-white px-3 py-2 text-sm";
const br = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;

export default async function Faltas({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string; aviso?: string; a?: string; n?: string; f?: string }> }) {
  const { ok, erro, aviso, a, n, f } = await searchParams;
  const [cfg, { rows, missingTable }] = await Promise.all([getClinicSettings(), isDemo ? Promise.resolve({ rows: [], missingTable: false }) : listAbsences()]);
  const profs = cfg.professionals;
  const nameOf = (k: string) => cfg.professionals.find((p) => p.key === k)?.name ?? k;
  const today = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);

  return (
    <div className="max-w-4xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Faltas de profissionais</h1>
        <p className="max-w-2xl text-sm text-muted">Quando um profissional não puder atender, registre aqui. O sistema desmarca as consultas do período, bloqueia o dia na agenda e a Marcelia avisa cada cliente por WhatsApp, já oferecendo novos horários.</p>
      </header>

      {ok === "falta" && (
        <p className="rounded-lg bg-ok-soft px-4 py-3 text-sm text-green-800">
          Falta registrada. {Number(a) === 0 ? "Não havia consultas marcadas nesse período." : `${a} ${Number(a) === 1 ? "consulta desmarcada" : "consultas desmarcadas"}; ${n} ${Number(n) === 1 ? "cliente avisado" : "clientes avisados"} por WhatsApp.`}
        </p>
      )}
      {ok === "removida" && <p className="rounded-lg bg-ok-soft px-4 py-3 text-sm text-green-800">Falta removida: os dias voltam a ter vagas.</p>}
      {f && <p className="rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">Não consegui avisar: {f}. Entre em contato com eles manualmente.</p>}
      {aviso && <p className="rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">{aviso}</p>}
      {erro && <p className="rounded-lg bg-bad-soft px-4 py-3 text-sm text-bad">{erro}</p>}
      {missingTable && !isDemo && <p className="rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">A tabela de faltas ainda não existe no Supabase (migração 009). Enquanto isso, o aviso aos clientes funciona, mas o dia não fica bloqueado e o histórico não aparece aqui.</p>}

      <form className="card space-y-3 p-5">
        <h2 className="text-sm font-semibold">Registrar falta</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs text-muted sm:col-span-2">Profissional
            <select name="professional" required className={`${input} mt-1`}>
              {profs.map((p) => <option key={p.key} value={p.key}>{p.name} · {p.specialty}</option>)}
            </select>
          </label>
          <label className="block text-xs text-muted">Primeiro dia da falta<input type="date" name="from" min={today} required className={`${input} mt-1`} /></label>
          <label className="block text-xs text-muted">Último dia (deixe vazio se for só um dia)<input type="date" name="to" min={today} className={`${input} mt-1`} /></label>
          <label className="block text-xs text-muted sm:col-span-2">Motivo (opcional, aparece na mensagem ao cliente)<input name="reason" maxLength={120} placeholder="ex.: compromisso de saúde, imprevisto" className={`${input} mt-1`} /></label>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="notify" defaultChecked /> Avisar os clientes por WhatsApp</label>
        <ConfirmSubmit formAction={registrarFalta} message="Registrar a falta? As consultas desse período serão desmarcadas e os clientes avisados por WhatsApp agora." className="btn btn-primary" disabled={isDemo || profs.length === 0}>Registrar falta e avisar clientes</ConfirmSubmit>
        <p className="text-xs text-muted">A mensagem é enviada na hora para cada cliente que tinha consulta com o profissional no período.</p>
      </form>

      <section className="card p-5">
        <h2 className="mb-2 text-sm font-semibold">Faltas registradas</h2>
        {rows.length === 0 ? <p className="text-sm text-muted">Nenhuma falta registrada.</p> : (
          <ul className="divide-y divide-line text-sm">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                <span className="font-medium">{nameOf(r.professional_key)}</span>
                <span>{r.starts_on === r.ends_on ? br(r.starts_on) : `${br(r.starts_on)} a ${br(r.ends_on)}`}</span>
                {r.reason && <span className="text-muted">· {r.reason}</span>}
                <span className="text-xs text-muted">{r.affected} {r.affected === 1 ? "consulta" : "consultas"} · {r.notified} avisados</span>
                {r.ends_on >= today && (
                  <form className="ml-auto">
                    <input type="hidden" name="id" value={r.id} />
                    <ConfirmSubmit formAction={desfazerFalta} message="Remover esta falta? Os dias voltam a ter vagas (os clientes já avisados não são avisados de novo)." className="text-xs text-bad underline">Remover</ConfirmSubmit>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
