import { getClinicSettings, DOW_SHORT, insuranceToText, pricesToText, scheduleToText } from "@/lib/clinic-settings";
import { restoreDefaults, saveInsurance, savePrices, saveProfessional } from "@/app/actions";

export const dynamic = "force-dynamic";

const OK: Record<string, string> = {
  prices: "Preços salvos. A Marcelia já usa os novos valores.",
  insurance: "Convênios salvos.",
  professionals: "Grade salva. Os próximos horários oferecidos já seguem a nova grade.",
  "prices-padrao": "Preços voltaram ao padrão.",
  "insurance-padrao": "Convênios voltaram ao padrão.",
  "professionals-padrao": "Grades voltaram ao padrão.",
};

function Restore({ section, active }: { section: string; active: boolean }) {
  if (!active) return <span className="text-xs text-muted">Usando o padrão do sistema</span>;
  return (
    <form action={restoreDefaults}>
      <input type="hidden" name="section" value={section} />
      <button className="text-xs text-muted underline hover:text-ink">Restaurar padrão</button>
    </form>
  );
}

export default async function Configuracoes({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const { ok, erro } = await searchParams;
  const cfg = await getClinicSettings();
  const input = "w-full rounded-lg border border-line bg-white px-3 py-2 text-sm";

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Configurações</h1>
        <p className="max-w-2xl text-sm text-muted">
          Preços, horários e convênios que a Marcelia usa nas conversas. Vale na hora, sem precisar de novo deploy. A IA do aprendizado nunca altera estes dados.
        </p>
      </header>

      {ok && OK[ok] && <p className="rounded-lg bg-ok-soft px-4 py-3 text-sm text-green-800">{OK[ok]}</p>}
      {erro && <p className="rounded-lg bg-bad-soft px-4 py-3 text-sm text-bad">{erro}</p>}
      {!cfg.ready && (
        <p className="rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">
          A tabela de configurações ainda não foi criada no Supabase (migração 004). Enquanto isso, a Marcelia usa os valores padrão e não é possível salvar alterações.
        </p>
      )}

      <section className="card p-5">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">Preços</h2>
          <Restore section="prices" active={cfg.custom.prices} />
        </div>
        <form action={savePrices} className="space-y-3">
          <textarea name="prices" rows={Math.max(4, cfg.prices.length + 1)} defaultValue={pricesToText(cfg.prices)} className={input} />
          <p className="text-xs text-muted">Uma linha por serviço, como a Marcelia deve falar. Ex.: Pediatria: R$ 220,00</p>
          <button className="btn btn-primary">Salvar preços</button>
        </form>
      </section>

      <section className="card p-5">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">Convênios</h2>
          <Restore section="insurance" active={cfg.custom.insurance} />
        </div>
        <form action={saveInsurance} className="space-y-3">
          <textarea name="insurance" rows={Math.max(4, Object.keys(cfg.insurance).length + 1)} defaultValue={insuranceToText(cfg.insurance)} className={input} />
          <p className="text-xs text-muted">Uma linha por convênio, com as especialidades cobertas: <code>Unimed: Fisioterapia, Nutrição</code></p>
          <button className="btn btn-primary">Salvar convênios</button>
        </form>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">Grades de horários</h2>
          <Restore section="professionals" active={cfg.custom.professionals} />
        </div>
        <p className="max-w-2xl text-xs text-muted">
          Informe as janelas de cada dia no formato <code>15:00-17:00</code> (várias separadas por vírgula; deixe em branco se não atende no dia). A Marcelia divide cada janela em consultas da duração informada e só oferece horários livres na agenda.
        </p>
        <div className="grid gap-4 lg:grid-cols-2">
          {cfg.professionals.map((p) => (
            <form key={p.key} action={saveProfessional} className="card space-y-3 p-5">
              <input type="hidden" name="key" value={p.key} />
              <div className="flex items-center justify-between">
                <span className="chip bg-brand-soft capitalize text-brand">{p.specialty}</span>
              </div>
              <label className="block text-xs text-muted">Nome<input name="name" defaultValue={p.name} className={`${input} mt-1`} /></label>
              <div className="flex items-end gap-4">
                <label className="block text-xs text-muted">Duração (min)<input name="slotMin" type="number" min={10} max={180} defaultValue={p.slotMin} className={`${input} mt-1 w-24`} /></label>
                <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" name="particularOnly" defaultChecked={!!p.particularOnly} /> Somente particular</label>
              </div>
              <div className="grid grid-cols-[3rem_1fr] items-center gap-x-2 gap-y-1.5">
                {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                  <label key={d} className="contents text-sm">
                    <span className="text-muted">{DOW_SHORT[d]}</span>
                    <input name={`dow${d}`} defaultValue={scheduleToText(p.schedule[d])} placeholder="—" className={input} />
                  </label>
                ))}
              </div>
              <button className="btn btn-primary">Salvar grade</button>
            </form>
          ))}
        </div>
      </section>
    </div>
  );
}
