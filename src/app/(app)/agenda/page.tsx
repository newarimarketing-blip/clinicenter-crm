import Link from "next/link";
import { getClinicSettings } from "@/lib/clinic-settings";
import { calendarId, googleEvents } from "@/lib/agenda";
import { isDemo, supabaseServer } from "@/lib/supabase-server";
import { DEMO_APPOINTMENTS } from "@/lib/demo";
import { timeHM } from "@/lib/format";
import type { AppointmentWithLead } from "@/lib/types";

export const dynamic = "force-dynamic";

const OFFSET = 3 * 3600e3; // Fortaleza = UTC-3
const DAY = 86400e3;
const DOW = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const PALETTE = [
  "bg-teal-100 text-teal-900 border-teal-300",
  "bg-sky-100 text-sky-900 border-sky-300",
  "bg-violet-100 text-violet-900 border-violet-300",
  "bg-amber-100 text-amber-900 border-amber-300",
  "bg-rose-100 text-rose-900 border-rose-300",
  "bg-lime-100 text-lime-900 border-lime-300",
  "bg-orange-100 text-orange-900 border-orange-300",
  "bg-indigo-100 text-indigo-900 border-indigo-300",
];

type Item = { id: string; start: number; end: number; prof: string; title: string; status: string; confirmed: boolean; leadId?: string; source: "sistema" | "google" };

const pad = (n: number) => String(n).padStart(2, "0");

export default async function Agenda({ searchParams }: { searchParams: Promise<{ prof?: string; sem?: string }> }) {
  const { prof: profParam, sem } = await searchParams;
  const offset = Math.max(-26, Math.min(52, Number(sem) || 0));
  const cfg = await getClinicSettings();
  const profs = cfg.professionalsAll;
  const selected = profs.find((p) => p.key === profParam);

  // semana (segunda a domingo) no relógio de Fortaleza
  const local = new Date(Date.now() - OFFSET);
  const todayStart = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) + OFFSET;
  const dow = local.getUTCDay();
  const weekStart = todayStart - ((dow + 6) % 7) * DAY + offset * 7 * DAY;
  const weekEnd = weekStart + 7 * DAY;
  const days = Array.from({ length: 7 }, (_, i) => weekStart + i * DAY);
  const label = (ms: number) => { const d = new Date(ms - OFFSET); return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}`; };

  // consultas do sistema
  let appts: AppointmentWithLead[] = [];
  if (isDemo) {
    appts = DEMO_APPOINTMENTS.filter((a) => +new Date(a.starts_at) >= weekStart && +new Date(a.starts_at) < weekEnd);
  } else {
    const db = await supabaseServer();
    const { data } = await db
      .from("appointments")
      .select("*, leads(id,name,patient_name,phone,specialty)")
      .gte("starts_at", new Date(weekStart).toISOString())
      .lt("starts_at", new Date(weekEnd).toISOString())
      .order("starts_at");
    appts = (data ?? []) as unknown as AppointmentWithLead[];
  }
  const items: Item[] = appts
    .filter((a) => a.status !== "cancelado" && a.status !== "remarcado" && (!selected || a.calendar_hint === selected.key))
    .map((a) => ({
      id: a.id, start: +new Date(a.starts_at), end: +new Date(a.ends_at), prof: a.calendar_hint,
      title: a.leads?.patient_name ?? a.leads?.name ?? a.leads?.phone ?? "Paciente",
      status: a.status, confirmed: !!a.confirmed_at, leadId: a.leads?.id, source: "sistema" as const,
    }));

  // agenda real do Google (inclui o que a equipe marcou à mão); evita duplicar o que o sistema já criou
  const known = new Set(appts.map((a) => a.gcal_event_id).filter(Boolean));
  if (!isDemo) {
    const targets = selected ? [selected] : profs.filter((p) => p.active || calendarId(p));
    const lists = await Promise.all(targets.map(async (p) => ({ p, ev: await googleEvents(p, new Date(weekStart), new Date(weekEnd)) })));
    for (const { p, ev } of lists)
      for (const e of ev)
        if (!known.has(e.id)) items.push({ id: `g-${e.id}`, start: +new Date(e.start), end: +new Date(e.end), prof: p.key, title: e.title, status: "google", confirmed: false, source: "google" });
  }
  items.sort((a, b) => a.start - b.start);

  const color = (key: string) => PALETTE[Math.max(0, profs.findIndex((p) => p.key === key)) % PALETTE.length];
  const nameOf = (key: string) => profs.find((p) => p.key === key)?.name ?? key;
  const q = (o: { prof?: string; sem?: number }) => {
    const sp = new URLSearchParams();
    const pk = "prof" in o ? o.prof : selected?.key;
    const sm = "sem" in o ? o.sem : offset;
    if (pk) sp.set("prof", pk);
    if (sm) sp.set("sem", String(sm));
    const s = sp.toString();
    return `/agenda${s ? `?${s}` : ""}`;
  };
  const gcal = selected && calendarId(selected) ? `https://calendar.google.com/calendar/u/0/r?cid=${Buffer.from(calendarId(selected)!).toString("base64").replace(/=+$/, "")}` : null;
  const counts = profs.map((p) => ({ p, n: items.filter((i) => i.prof === p.key).length })).filter((c) => c.n > 0);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Agenda</h1>
          <p className="text-sm text-muted">Consultas marcadas pela Marcelia e pela equipe no Google Calendar, {selected ? `de ${selected.name}` : "de todos os profissionais"}.</p>
        </div>
        <div className="flex items-center gap-1.5">
          <Link href={q({ sem: offset - 1 })} className="btn !px-3">←</Link>
          <Link href={q({ sem: 0 })} className="btn">Hoje</Link>
          <Link href={q({ sem: offset + 1 })} className="btn !px-3">→</Link>
          <span className="ml-2 text-sm tabular-nums text-muted">{label(weekStart)} – {label(weekEnd - DAY)}</span>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-1.5">
        <Link href={q({ prof: undefined })} className={`chip border ${!selected ? "border-brand bg-brand-soft text-brand" : "border-line bg-white text-muted"}`}>Geral</Link>
        {profs.map((p) => (
          <Link key={p.key} href={q({ prof: p.key })} className={`chip border ${selected?.key === p.key ? color(p.key) : "border-line bg-white text-muted"} ${p.active ? "" : "opacity-60"}`}>
            {p.name}
          </Link>
        ))}
        {gcal && <a href={gcal} target="_blank" rel="noreferrer" className="ml-auto text-xs text-brand underline">Abrir no Google Calendar</a>}
      </div>

      {!selected && counts.length > 0 && (
        <p className="text-xs text-muted">Na semana: {items.length} compromisso(s) — {counts.map((c) => `${c.p.name} ${c.n}`).join(" · ")}</p>
      )}

      <div className="grid gap-3 md:grid-cols-7">
        {days.map((d) => {
          const dayItems = items.filter((i) => i.start >= d && i.start < d + DAY);
          const windows = selected?.schedule[new Date(d - OFFSET).getUTCDay()];
          const isToday = d === todayStart;
          return (
            <section key={d} className={`card min-h-28 p-2.5 ${isToday ? "border-brand ring-1 ring-brand" : ""}`}>
              <h2 className={`mb-1.5 text-xs font-semibold ${isToday ? "text-brand" : ""}`}>{DOW[new Date(d - OFFSET).getUTCDay()]} {label(d)}</h2>
              {windows && windows.length > 0 && <p className="mb-1.5 text-[11px] text-muted">Atende {windows.map(([a, b]) => `${a}–${b}`).join(", ")}</p>}
              <ul className="space-y-1.5">
                {dayItems.length === 0 && <li className="text-xs text-muted">—</li>}
                {dayItems.map((i) => {
                  const inner = (
                    <>
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-medium tabular-nums">{timeHM(new Date(i.start).toISOString())}</span>
                        {i.status === "compareceu" && <span className="text-[10px]">compareceu</span>}
                        {i.status === "faltou" && <span className="text-[10px]">faltou</span>}
                        {i.status === "agendado" && i.confirmed && <span className="text-[10px]">confirmada</span>}
                        {i.source === "google" && <span className="text-[10px]">google</span>}
                      </div>
                      <div className="truncate">{i.title}</div>
                      {!selected && <div className="truncate text-[10px] opacity-80">{nameOf(i.prof)}</div>}
                    </>
                  );
                  const cls = `block rounded-md border px-2 py-1 text-xs ${color(i.prof)}`;
                  return <li key={i.id}>{i.leadId ? <Link href={`/funil?lead=${i.leadId}`} className={cls}>{inner}</Link> : <div className={cls}>{inner}</div>}</li>;
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
