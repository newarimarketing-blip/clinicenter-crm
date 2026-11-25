"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { bookAppointment, slotsForDay, type SlotOption } from "@/app/team-actions";

type Prof = { key: string; name: string; specialty: string };
const field = "w-full rounded-lg border border-line bg-white px-3 py-2 text-sm";

/** Botão "Agendar consulta" + janela para marcar direto pelo portal (cria o paciente se ainda não existir). */
export function ScheduleDialog({ profs, defaultProf }: { profs: Prof[]; defaultProf?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [insurance, setInsurance] = useState("");
  const [prof, setProf] = useState(defaultProf && profs.some((p) => p.key === defaultProf) ? defaultProf : profs[0]?.key ?? "");
  const [date, setDate] = useState("");
  const [slots, setSlots] = useState<SlotOption[] | null>(null);
  const [time, setTime] = useState("");
  const [weeks, setWeeks] = useState(1);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [pending, start] = useTransition();

  useEffect(() => {
    setTime(""); setSlots(null);
    if (!open || !prof || !date) return;
    let live = true;
    setLoading(true);
    slotsForDay(prof, date).then((r) => {
      if (!live) return;
      setSlots(r.slots); setLoading(false);
      if (r.error) setMsg({ ok: false, text: r.error });
    });
    return () => { live = false; };
  }, [open, prof, date]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    start(async () => {
      const r = await bookAppointment({ name, phone, profKey: prof, date, time, insurance, weeks });
      if (!r.ok) return setMsg({ ok: false, text: r.error ?? "Não foi possível agendar." });
      const base = (r.created ?? 1) > 1 ? `${r.created} consultas semanais agendadas` : "Consulta agendada";
      const skip = r.skipped?.length ? ` Puladas: ${r.skipped.join(", ")}.` : "";
      setMsg({ ok: true, text: `${base}${r.newClient ? " e novo cliente cadastrado" : ""}!${skip}` });
      router.refresh();
      setTimeout(() => { setOpen(false); setWeeks(1); setMsg(null); setName(""); setPhone(""); setInsurance(""); setDate(""); setTime(""); }, r.skipped?.length ? 4500 : 1400);
    });
  }

  const today = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn btn-primary">+ Agendar consulta</button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !pending && setOpen(false)}>
          <form onSubmit={submit} onClick={(e) => e.stopPropagation()} className="card max-h-[92vh] w-full max-w-lg space-y-3 overflow-y-auto p-5 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">Agendar consulta</h2>
              <button type="button" onClick={() => setOpen(false)} className="text-muted hover:text-ink" aria-label="Fechar">✕</button>
            </div>
            <label className="block text-xs text-muted">Nome do paciente
              <input value={name} onChange={(e) => setName(e.target.value)} required className={`${field} mt-1`} />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs text-muted">WhatsApp (com DDD)
                <input value={phone} onChange={(e) => setPhone(e.target.value)} required inputMode="tel" placeholder="88 99999-0000" className={`${field} mt-1`} />
              </label>
              <label className="block text-xs text-muted">Convênio (opcional)
                <input value={insurance} onChange={(e) => setInsurance(e.target.value)} placeholder="particular, Unimed…" className={`${field} mt-1`} />
              </label>
            </div>
            <label className="block text-xs text-muted">Especialista
              <select value={prof} onChange={(e) => setProf(e.target.value)} className={`${field} mt-1`}>
                {profs.map((p) => <option key={p.key} value={p.key}>{p.name} · {p.specialty}</option>)}
              </select>
            </label>
            <label className="block text-xs text-muted">Data
              <input type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} required className={`${field} mt-1`} />
            </label>
            <label className="block text-xs text-muted">Horário
        <input type="time" step={300} value={time} onChange={(e) => setTime(e.target.value)} required className={`${field} mt-1`} />
      </label>
      <label className="block text-xs text-muted">Repetição
        <select value={weeks} onChange={(e) => setWeeks(Number(e.target.value))} className={`${field} mt-1`}>
          <option value={1}>Consulta única</option>
          {[4, 8, 12, 16, 24, 52].map((n) => <option key={n} value={n}>Toda semana, no mesmo dia e horário — {n} consultas</option>)}
        </select>
      </label>
      {date && (
        <div>
          <div className="mb-1 text-xs text-muted">Horários livres (toque para preencher)</div>
          {loading && <p className="text-sm text-muted">Buscando horários…</p>}
          {!loading && slots && slots.length === 0 && <p className="text-sm text-muted">Sem horários livres nesse dia. Escolha outra data (confira os dias de atendimento do especialista).</p>}
          <div className="flex flex-wrap gap-1.5">
            {slots?.map((s) => {
              const hm = s.label.replace(/ \(.*\)$/, "").slice(0, 5);
              return <button key={s.startTime} type="button" onClick={() => setTime(hm)} className={`chip border ${time === hm ? "border-brand bg-brand text-white" : "border-line bg-white"}`}>{hm}</button>;
            })}
          </div>
          {slots && slots.length > 0 && time && !slots.some((s) => s.label.replace(/ \(.*\)$/, "").slice(0, 5) === time) && <p className="mt-2 text-xs text-warn">Esse horário não está livre: escolha um dos horários acima.</p>}
        </div>
      )}
      {msg && <p className={`rounded-lg px-3 py-2 text-sm ${msg.ok ? "bg-ok-soft text-green-800" : "bg-bad-soft text-bad"}`}>{msg.text}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" className="btn" onClick={() => setOpen(false)} disabled={pending}>Cancelar</button>
              <button className="btn btn-primary" disabled={pending || !date || !time || !name || !phone}>{pending ? "Agendando…" : weeks > 1 ? `Agendar ${weeks} consultas` : "Confirmar agendamento"}</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
