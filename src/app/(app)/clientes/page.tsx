import Link from "next/link";
import { getLeads } from "@/lib/data";
import { getClinicSettings } from "@/lib/clinic-settings";
import { StageChip, SpecialtyChip } from "@/components/ui";
import { initials, phoneFmt, relTime } from "@/lib/format";
import { createClient } from "@/app/clientes-actions";

export const dynamic = "force-dynamic";
const input = "w-full rounded-lg border border-line bg-white px-3 py-2 text-sm";
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export default async function Clientes({ searchParams }: { searchParams: Promise<{ q?: string; erro?: string }> }) {
  const { q, erro } = await searchParams;
  const [all, cfg] = await Promise.all([getLeads(), getClinicSettings()]);
  const term = norm(q ?? "").trim();
  const digits = (q ?? "").replace(/\D/g, "");
  const list = term
    ? all.filter((l) => norm(`${l.name ?? ""} ${l.patient_name ?? ""} ${l.email ?? ""} ${l.insurance ?? ""}`).includes(term) || (digits.length >= 3 && l.phone.includes(digits)))
    : all;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Clientes</h1>
          <p className="text-sm text-muted">Cadastro de cada cliente com dados, consultas e histórico. Quem conversa com a Marcelia entra aqui sozinho.</p>
        </div>
        <form className="flex gap-2">
          <input name="q" defaultValue={q ?? ""} placeholder="Buscar por nome, WhatsApp, e-mail…" className={`${input} w-64`} />
          <button className="btn">Buscar</button>
        </form>
      </header>

      {erro && <p className="rounded-lg bg-bad-soft px-4 py-3 text-sm text-bad">{erro}</p>}

      <details className="card p-5">
        <summary className="cursor-pointer text-sm font-medium text-brand">+ Novo cliente</summary>
        <form action={createClient} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="block text-xs text-muted">Nome<input name="name" required className={`${input} mt-1`} /></label>
          <label className="block text-xs text-muted">WhatsApp (com DDD)<input name="phone" required inputMode="tel" placeholder="88 99999-0000" className={`${input} mt-1`} /></label>
          <label className="block text-xs text-muted">Nome do paciente (se diferente)<input name="patient_name" className={`${input} mt-1`} /></label>
          <label className="block text-xs text-muted">E-mail<input name="email" type="email" className={`${input} mt-1`} /></label>
          <label className="block text-xs text-muted">Convênio<input name="insurance" placeholder="particular, Unimed…" className={`${input} mt-1`} /></label>
          <label className="block text-xs text-muted">Especialidade
            <select name="specialty" className={`${input} mt-1 capitalize`}>
              <option value="">A definir</option>
              {cfg.specialties.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="block text-xs text-muted sm:col-span-2 lg:col-span-3">Observações<textarea name="notes" rows={2} className={`${input} mt-1`} /></label>
          <div><button className="btn btn-primary">Cadastrar cliente</button></div>
        </form>
      </details>

      <div className="card overflow-hidden">
        <div className="border-b border-line px-4 py-2 text-xs text-muted">{list.length} {list.length === 1 ? "cliente" : "clientes"}{term ? " encontrados" : ""}</div>
        <ul className="divide-y divide-line">
          {list.length === 0 && <li className="px-4 py-6 text-sm text-muted">Nenhum cliente encontrado.</li>}
          {list.map((l) => (
            <li key={l.id}>
              <Link href={`/clientes/${l.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-black/[0.03]">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-semibold text-white">{initials(l.name ?? l.patient_name)}</div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{l.name ?? l.patient_name ?? "Sem nome"} {l.patient_name && l.name && l.patient_name !== l.name && <span className="font-normal text-muted">· paciente: {l.patient_name}</span>}</div>
                  <div className="text-xs text-muted">{phoneFmt(l.phone)}{l.email ? ` · ${l.email}` : ""}</div>
                </div>
                <div className="hidden flex-wrap items-center justify-end gap-1.5 sm:flex">
                  <SpecialtyChip s={l.specialty} />
                  {l.insurance && <span className="chip bg-slate-100 text-slate-700">{l.insurance}</span>}
                  <StageChip stage={l.stage} />
                </div>
                <span className="w-16 shrink-0 text-right text-xs text-muted">{l.last_message_at ? `há ${relTime(l.last_message_at)}` : "—"}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
