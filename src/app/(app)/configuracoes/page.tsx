import { getClinicSettings, DOW_SHORT, insuranceToText, scheduleToText, type ProfessionalRow } from "@/lib/clinic-settings";
import { currentMe, listRoles } from "@/lib/roles";
import { calendarId } from "@/lib/agenda";
import { createCalendarFor, createProfessional, deleteService, restoreDefaults, saveInsurance, saveService, setRole, updateProfessional } from "@/app/actions";

export const dynamic = "force-dynamic";

const OK: Record<string, string> = {
  insurance: "Convênios salvos.",
  professionals: "Especialista salvo. Os próximos horários oferecidos já seguem a nova grade.",
  "prof-novo": "Especialista cadastrado. A Marcelia já pode oferecer horários dele.",
  "agenda-criada": "Agenda criada no Google Calendar e compartilhada com a equipe.",
  servico: "Serviço salvo. A Marcelia já usa o novo valor.",
  "servico-novo": "Serviço cadastrado.",
  "servico-removido": "Serviço removido.",
  papel: "Acesso atualizado.",
  "insurance-padrao": "Convênios voltaram ao padrão.",
  "prices-padrao": "Preços voltaram ao padrão.",
  "professionals-padrao": "Grades voltaram ao padrão.",
};

const input = "w-full rounded-lg border border-line bg-white px-3 py-2 text-sm disabled:bg-slate-50";

function ScheduleFields({ p, disabled }: { p?: ProfessionalRow; disabled?: boolean }) {
  return (
    <div className="grid grid-cols-[3rem_1fr] items-center gap-x-2 gap-y-1.5">
      {[1, 2, 3, 4, 5, 6, 0].map((d) => (
        <label key={d} className="contents text-sm">
          <span className="text-muted">{DOW_SHORT[d]}</span>
          <input name={`dow${d}`} disabled={disabled} defaultValue={scheduleToText(p?.schedule[d])} placeholder="15:00-17:00" className={input} />
        </label>
      ))}
    </div>
  );
}

export default async function Configuracoes({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string; aviso?: string }> }) {
  const { ok, erro, aviso } = await searchParams;
  const [cfg, me, roles] = await Promise.all([getClinicSettings(), currentMe(), listRoles()]);
  const edit = me.role === "gestor";
  const tablesOk = cfg.tables.professionals && cfg.tables.services;
  const lock = !edit || !tablesOk;

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Configurações</h1>
        <p className="max-w-2xl text-sm text-muted">
          Especialistas, serviços, valores e convênios que a Marcelia usa nas conversas. Vale na hora, sem novo deploy. A IA do aprendizado nunca altera estes dados.
        </p>
      </header>

      {ok && OK[ok] && <p className="rounded-lg bg-ok-soft px-4 py-3 text-sm text-green-800">{OK[ok]}</p>}
      {aviso && <p className="rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">{aviso}</p>}
      {erro && <p className="rounded-lg bg-bad-soft px-4 py-3 text-sm text-bad">{erro}</p>}
      {!edit && <p className="rounded-lg bg-slate-100 px-4 py-3 text-sm text-slate-700">Você está com acesso de recepção: pode consultar tudo aqui, mas só o gestor altera.</p>}
      {edit && !tablesOk && (
        <p className="rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">
          As tabelas de especialistas e serviços ainda não existem no Supabase (migração 006). Enquanto isso, valem os dados padrão e não é possível cadastrar.
        </p>
      )}

      {/* ---------- Especialistas ---------- */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Especialistas e agendas</h2>
        <p className="max-w-2xl text-xs text-muted">
          Janelas por dia no formato <code>15:00-17:00</code> (várias separadas por vírgula; vazio = não atende). A Marcelia divide cada janela em consultas da duração informada e só oferece horários livres na agenda do Google.
        </p>

        {edit && (
          <details className="card p-5" open={!!erro && !ok}>
            <summary className="cursor-pointer text-sm font-medium text-brand">+ Cadastrar novo especialista</summary>
            <form action={createProfessional} className="mt-4 space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-xs text-muted">Nome<input name="name" required placeholder="Dra. Maria Souza" disabled={lock} className={`${input} mt-1`} /></label>
                <label className="block text-xs text-muted">Especialidade
                  <input name="specialty" required list="specs" placeholder="nutrição" disabled={lock} className={`${input} mt-1`} />
                  <datalist id="specs">{cfg.specialties.map((s) => <option key={s} value={s} />)}</datalist>
                </label>
              </div>
              <div className="flex flex-wrap items-end gap-4">
                <label className="block text-xs text-muted">Duração (min)<input name="slotMin" type="number" min={10} max={180} defaultValue={30} disabled={lock} className={`${input} mt-1 w-24`} /></label>
                <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" name="particularOnly" disabled={lock} /> Somente particular</label>
                <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" name="criarAgenda" defaultChecked disabled={lock} /> Criar agenda no Google Calendar</label>
              </div>
              <ScheduleFields disabled={lock} />
              <p className="text-xs text-muted">A agenda nova é criada na conta do sistema e compartilhada (como proprietária) com clinicenter.mkt@gmail.com e newarimarketing@gmail.com. O Google envia um convite por e-mail para aceitar.</p>
              <button className="btn btn-primary" disabled={lock}>Cadastrar especialista</button>
            </form>
          </details>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          {cfg.professionalsAll.map((p) => {
            const hasCal = !!calendarId(p);
            return (
              <form key={p.key} action={updateProfessional} className={`card space-y-3 p-5 ${p.active ? "" : "opacity-70"}`}>
                <input type="hidden" name="key" value={p.key} />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="chip bg-brand-soft capitalize text-brand">{p.specialty}</span>
                  <span className={`chip ${hasCal ? "bg-ok-soft text-green-800" : "bg-warn-soft text-warn"}`}>{hasCal ? "Agenda Google ligada" : "Sem agenda Google"}</span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-xs text-muted">Nome<input name="name" defaultValue={p.name} disabled={lock} className={`${input} mt-1`} /></label>
                  <label className="block text-xs text-muted">Especialidade<input name="specialty" list="specs" defaultValue={p.specialty} disabled={lock} className={`${input} mt-1`} /></label>
                </div>
                <div className="flex flex-wrap items-end gap-4">
                  <label className="block text-xs text-muted">Duração (min)<input name="slotMin" type="number" min={10} max={180} defaultValue={p.slotMin} disabled={lock} className={`${input} mt-1 w-24`} /></label>
                  <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" name="particularOnly" defaultChecked={!!p.particularOnly} disabled={lock} /> Somente particular</label>
                  <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" name="active" defaultChecked={p.active} disabled={lock} /> Ativo (Marcelia oferece horários)</label>
                </div>
                <ScheduleFields p={p} disabled={lock} />
                {edit && (
                  <div className="flex flex-wrap gap-2">
                    <button className="btn btn-primary" disabled={lock}>Salvar</button>
                    {!hasCal && <button formAction={createCalendarFor} className="btn" disabled={lock}>Criar agenda no Google</button>}
                  </div>
                )}
              </form>
            );
          })}
        </div>
      </section>

      {/* ---------- Serviços ---------- */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Serviços e valores</h2>
        <p className="max-w-2xl text-xs text-muted">Cada linha vira um valor que a Marcelia pode informar. Ela nunca inventa preço fora desta lista.</p>

        {edit && (
          <details className="card p-5">
            <summary className="cursor-pointer text-sm font-medium text-brand">+ Cadastrar novo serviço</summary>
            <form action={saveService} className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="block text-xs text-muted">Serviço<input name="name" required placeholder="Consulta de nutrição" disabled={lock} className={`${input} mt-1`} /></label>
              <label className="block text-xs text-muted">Valor<input name="price" required placeholder="R$ 180,00" disabled={lock} className={`${input} mt-1`} /></label>
              <label className="block text-xs text-muted">Especialidade<input name="specialty" list="specs" disabled={lock} className={`${input} mt-1`} /></label>
              <label className="block text-xs text-muted">Profissional (opcional)
                <select name="professional_key" disabled={lock} className={`${input} mt-1`}>
                  <option value="">Qualquer</option>
                  {cfg.professionalsAll.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
                </select>
              </label>
              <label className="block text-xs text-muted sm:col-span-2">Observação (opcional)<input name="note" placeholder="Unimed: R$ 150,00 mediante carteirinha" disabled={lock} className={`${input} mt-1`} /></label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="particularOnly" disabled={lock} /> Somente particular</label>
              <div className="sm:col-span-2"><button className="btn btn-primary" disabled={lock}>Cadastrar serviço</button></div>
            </form>
          </details>
        )}

        <div className="space-y-2">
          {cfg.services.length === 0 && <p className="card p-4 text-sm text-muted">Nenhum serviço cadastrado ainda.</p>}
          {cfg.services.map((s) => (
            <form key={s.id} action={saveService} className={`card grid gap-2 p-4 sm:grid-cols-[1.4fr_1fr_1fr_1.2fr_auto] sm:items-end ${s.active ? "" : "opacity-60"}`}>
              <input type="hidden" name="id" value={s.id} />
              <label className="block text-xs text-muted">Serviço<input name="name" defaultValue={s.name} disabled={lock} className={`${input} mt-1`} /></label>
              <label className="block text-xs text-muted">Valor<input name="price" defaultValue={s.price} disabled={lock} className={`${input} mt-1`} /></label>
              <label className="block text-xs text-muted">Especialidade<input name="specialty" list="specs" defaultValue={s.specialty ?? ""} disabled={lock} className={`${input} mt-1`} /></label>
              <label className="block text-xs text-muted">Observação<input name="note" defaultValue={s.note ?? ""} disabled={lock} className={`${input} mt-1`} /></label>
              <div className="flex flex-wrap items-center gap-3 text-sm sm:col-span-5">
                <label className="flex items-center gap-1.5"><input type="checkbox" name="particularOnly" defaultChecked={s.particular_only} disabled={lock} /> Somente particular</label>
                <label className="flex items-center gap-1.5"><input type="checkbox" name="active" defaultChecked={s.active} disabled={lock} /> Ativo</label>
                <select name="professional_key" defaultValue={s.professional_key ?? ""} disabled={lock} className="rounded-lg border border-line bg-white px-2 py-1.5 text-sm">
                  <option value="">Qualquer profissional</option>
                  {cfg.professionalsAll.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
                </select>
                {edit && (
                  <>
                    <button className="btn btn-primary" disabled={lock}>Salvar</button>
                    <button formAction={deleteService} className="text-xs text-bad underline" disabled={lock}>Remover</button>
                  </>
                )}
              </div>
            </form>
          ))}
        </div>
      </section>

      {/* ---------- Convênios ---------- */}
      <section className="card p-5">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">Convênios</h2>
          {cfg.custom.insurance && edit ? (
            <form action={restoreDefaults}>
              <input type="hidden" name="section" value="insurance" />
              <button className="text-xs text-muted underline hover:text-ink">Restaurar padrão</button>
            </form>
          ) : (
            <span className="text-xs text-muted">{cfg.custom.insurance ? "Personalizado" : "Usando o padrão do sistema"}</span>
          )}
        </div>
        <form action={saveInsurance} className="space-y-3">
          <textarea name="insurance" rows={Math.max(4, Object.keys(cfg.insurance).length + 1)} defaultValue={insuranceToText(cfg.insurance)} disabled={!edit || !cfg.ready} className={input} />
          <p className="text-xs text-muted">Uma linha por convênio, com as especialidades cobertas: <code>Unimed: Fisioterapia, Nutrição</code></p>
          {edit && <button className="btn btn-primary" disabled={!cfg.ready}>Salvar convênios</button>}
        </form>
      </section>

      {/* ---------- Equipe ---------- */}
      {edit && (
        <section className="card p-5">
          <h2 className="mb-1 text-sm font-semibold">Equipe e permissões</h2>
          <p className="mb-3 max-w-2xl text-xs text-muted">
            Gestor cadastra e edita; recepção só visualiza. Para uma pessoa nova entrar, crie o usuário dela em Supabase › Authentication › Users e depois defina o papel aqui. E-mail sem papel entra como recepção.
          </p>
          <ul className="mb-4 divide-y divide-line text-sm">
            {roles.length === 0 && <li className="py-2 text-muted">Nenhum papel cadastrado (migração 006 pendente).</li>}
            {roles.map((r) => (
              <li key={r.email} className="flex items-center justify-between gap-3 py-2">
                <span>{r.email}</span>
                <span className={`chip ${r.role === "gestor" ? "bg-brand-soft text-brand" : "bg-slate-100 text-slate-700"}`}>{r.role === "gestor" ? "Gestor" : "Recepção"}</span>
              </li>
            ))}
          </ul>
          <form action={setRole} className="flex flex-wrap items-end gap-2">
            <label className="block text-xs text-muted">E-mail<input name="email" type="email" required placeholder="pessoa@exemplo.com" className={`${input} mt-1 w-64`} /></label>
            <label className="block text-xs text-muted">Papel
              <select name="role" className={`${input} mt-1`}>
                <option value="recepcao">Recepção (só visualiza)</option>
                <option value="gestor">Gestor (edita tudo)</option>
              </select>
            </label>
            <button className="btn btn-primary">Definir acesso</button>
          </form>
        </section>
      )}
    </div>
  );
}
