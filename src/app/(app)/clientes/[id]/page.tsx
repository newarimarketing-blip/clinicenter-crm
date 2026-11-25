import Link from "next/link";
import { notFound } from "next/navigation";
import { getLeads, getMessages } from "@/lib/data";
import { getClinicSettings } from "@/lib/clinic-settings";
import { isDemo, supabaseServer } from "@/lib/supabase-server";
import { DEMO_APPOINTMENTS } from "@/lib/demo";
import { StageChip, SpecialtyChip } from "@/components/ui";
import { initials, phoneFmt, relTime } from "@/lib/format";
import { updateClient } from "@/app/clientes-actions";
import type { Appointment } from "@/lib/types";

export const dynamic = "force-dynamic";
const input = "w-full rounded-lg border border-line bg-white px-3 py-2 text-sm";
const when = (iso: string) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Fortaleza" });

const EVENT: Record<string, string> = {
  lead_created: "Cadastro criado",
  stage_changed: "Mudou de etapa",
  appointment_created: "Consulta agendada",
  appointment_confirmed: "Consulta confirmada",
  appointment_cancelled: "Consulta cancelada",
  attendance_marked: "Presença registrada",
  human_takeover: "Equipe assumiu a conversa",
  waitlist_joined: "Entrou na lista de espera",
  waitlist_offer: "Vaga oferecida da lista de espera",
  client_updated: "Cadastro editado",
};
const STATUS: Record<string, string> = { agendado: "Agendada", cancelado: "Cancelada", remarcado: "Remarcada", compareceu: "Compareceu", faltou: "Faltou" };

export default async function Cliente({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; erro?: string; aviso?: string }> }) {
  const { id } = await params;
  const { ok, erro, aviso } = await searchParams;
  const [leads, cfg, messages] = await Promise.all([getLeads(), getClinicSettings(), getMessages(id)]);
  const lead = leads.find((l) => l.id === id);
  if (!lead) notFound();

  let appts: Appointment[] = [];
  let events: { id: number; created_at: string; type: string; data: Record<string, unknown> }[] = [];
  let waits: { id: string; professional_key: string; status: string; periodo: string | null; dia_semana: string | null }[] = [];
  if (isDemo) appts = DEMO_APPOINTMENTS.filter((a) => a.lead_id === id);
  else {
    const db = await supabaseServer();
    const [a, e, w] = await Promise.all([
      db.from("appointments").select("*").eq("lead_id", id).order("starts_at", { ascending: false }),
      db.from("lead_events").select("id,created_at,type,data").eq("lead_id", id).order("created_at", { ascending: false }).limit(60),
      db.from("waitlist").select("id,professional_key,status,periodo,dia_semana").eq("lead_id", id).in("status", ["aguardando", "oferecido"]),
    ]);
    appts = (a.data ?? []) as Appointment[];
    events = (e.data ?? []) as typeof events;
    waits = (w.data ?? []) as typeof waits;
  }
  const done = appts.filter((a) => a.status === "compareceu").length;
  const missed = appts.filter((a) => a.status === "faltou").length;
  const upcoming = appts.filter((a) => a.status === "agendado" && +new Date(a.starts_at) > Date.now()).sort((a, b) => +new Date(a.starts_at) - +new Date(b.starts_at));
  const nameOf = (k: string) => cfg.professionals.find((p) => p.key === k)?.name ?? k;
  const lastMsgs = messages.slice(-8);

  return (
    <div className="space-y-5">
      <Link href="/clientes" className="text-sm text-muted hover:text-brand">← Clientes</Link>
      <header className="flex flex-wrap items-center gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand text-lg font-semibold text-white">{initials(lead.name ?? lead.patient_name)}</div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{lead.name ?? lead.patient_name ?? "Sem nome"}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-muted">
            <span>{phoneFmt(lead.phone)}</span>
            <StageChip stage={lead.stage} />
            <SpecialtyChip s={lead.specialty} />
            {lead.insurance && <span className="chip bg-slate-100 text-slate-700">{lead.insurance}</span>}
          </div>
        </div>
        <div className="flex gap-2">
          <Link href={`/conversas?lead=${lead.id}`} className="btn">Abrir conversa</Link>
          <a href={`https://wa.me/${lead.phone}`} target="_blank" rel="noreferrer" className="btn">WhatsApp</a>
        </div>
      </header>

      {ok && <p className="rounded-lg bg-ok-soft px-4 py-3 text-sm text-green-800">{ok === "criado" ? "Cliente cadastrado." : "Cadastro atualizado."}</p>}
      {aviso && <p className="rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">{aviso}</p>}
      {erro && <p className="rounded-lg bg-bad-soft px-4 py-3 text-sm text-bad">{erro}</p>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[["Consultas", appts.length], ["Compareceu", done], ["Faltou", missed], ["Cliente desde", new Date(lead.created_at).toLocaleDateString("pt-BR", { month: "short", year: "numeric", timeZone: "America/Fortaleza" })]].map(([l, v]) => (
          <div key={String(l)} className="card px-4 py-3"><div className="text-xs text-muted">{l}</div><div className="mt-0.5 text-lg font-semibold capitalize">{v}</div></div>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        <form action={updateClient.bind(null, lead.id)} className="card space-y-3 p-5 lg:col-span-2">
          <h2 className="text-sm font-semibold">Cadastro</h2>
          <label className="block text-xs text-muted">Nome<input name="name" required defaultValue={lead.name ?? ""} className={`${input} mt-1`} /></label>
          <label className="block text-xs text-muted">Nome do paciente (se diferente)<input name="patient_name" defaultValue={lead.patient_name ?? ""} className={`${input} mt-1`} /></label>
          <div className="text-xs text-muted">WhatsApp<div className={`${input} mt-1 bg-bg`}>{phoneFmt(lead.phone)}</div></div>
          <label className="block text-xs text-muted">E-mail<input name="email" type="email" defaultValue={lead.email ?? ""} className={`${input} mt-1`} /></label>
          <label className="block text-xs text-muted">Convênio<input name="insurance" defaultValue={lead.insurance ?? ""} placeholder="particular, Unimed…" className={`${input} mt-1`} /></label>
          <label className="block text-xs text-muted">Especialidade
            <select name="specialty" defaultValue={lead.specialty ?? ""} className={`${input} mt-1 capitalize`}>
              <option value="">A definir</option>
              {[...new Set([...cfg.specialties, ...(lead.specialty ? [lead.specialty] : [])])].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="block text-xs text-muted">Observações da equipe<textarea name="notes" rows={4} defaultValue={lead.notes ?? ""} className={`${input} mt-1`} /></label>
          <button className="btn btn-primary">Salvar cadastro</button>
          {lead.summary && <p className="border-t border-line pt-3 text-xs text-muted"><span className="font-semibold">Resumo da IA: </span>{lead.summary}</p>}
        </form>

        <div className="space-y-5 lg:col-span-3">
          <section className="card p-5">
            <h2 className="mb-2 text-sm font-semibold">Consultas</h2>
            {waits.length > 0 && <p className="mb-2 rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn">Na lista de espera: {waits.map((w) => `${nameOf(w.professional_key)}${w.dia_semana ? ` (${w.dia_semana})` : ""}${w.periodo ? ` (${w.periodo})` : ""}`).join(", ")}</p>}
            {appts.length === 0 ? <p className="text-sm text-muted">Nenhuma consulta registrada.</p> : (
              <ul className="divide-y divide-line text-sm">
                {appts.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span>{when(a.starts_at)} · <span className="text-muted">{a.professional}</span></span>
                    <span className={`chip ${a.status === "compareceu" ? "bg-emerald-200 text-emerald-900" : a.status === "agendado" ? "bg-ok-soft text-green-800" : a.status === "faltou" ? "bg-bad-soft text-bad" : "bg-slate-100 text-slate-700"}`}>{STATUS[a.status] ?? a.status}{a.status === "agendado" && upcoming[0]?.id === a.id ? " · próxima" : ""}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card p-5">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Últimas mensagens</h2>
              <Link href={`/conversas?lead=${lead.id}`} className="text-xs text-brand underline">Ver conversa completa</Link>
            </div>
            {lastMsgs.length === 0 ? <p className="text-sm text-muted">Sem mensagens.</p> : (
              <ul className="space-y-1.5 text-sm">
                {lastMsgs.map((m) => (
                  <li key={m.id} className="flex gap-2">
                    <span className={`chip h-fit shrink-0 ${m.role === "lead" ? "bg-slate-100 text-slate-700" : m.role === "ia" ? "bg-brand-soft text-brand" : "bg-warn-soft text-warn"}`}>{m.role === "lead" ? "Cliente" : m.role === "ia" ? "Marcelia" : "Equipe"}</span>
                    <span className="line-clamp-2 min-w-0 flex-1">{m.content}</span>
                    <span className="shrink-0 text-xs text-muted">{relTime(m.created_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card p-5">
            <h2 className="mb-2 text-sm font-semibold">Histórico</h2>
            {events.length === 0 ? <p className="text-sm text-muted">Sem eventos registrados.</p> : (
              <ul className="space-y-1.5 text-sm">
                {events.map((e) => (
                  <li key={e.id} className="flex justify-between gap-3">
                    <span>{EVENT[e.type] ?? e.type}{e.type === "stage_changed" && e.data?.to ? <span className="text-muted"> → {String(e.data.to)}</span> : null}</span>
                    <span className="shrink-0 text-xs text-muted">{when(e.created_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
