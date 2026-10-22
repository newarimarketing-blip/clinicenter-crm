import Link from "next/link";
import { getAppointments } from "@/lib/data";
import { AttendanceButtons } from "@/components/AttendanceButtons";
import { SpecialtyChip } from "@/components/ui";
import { fmtDateTime } from "@/lib/time";
import type { AppointmentWithLead } from "@/lib/types";

export const dynamic = "force-dynamic";

function Row({ a, marker }: { a: AppointmentWithLead; marker: boolean }) {
  const who = a.leads?.patient_name ?? a.leads?.name ?? a.leads?.phone ?? "—";
  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <div className="min-w-[180px] flex-1">
        {a.leads ? <Link href={`/conversas?lead=${a.leads.id}`} className="font-medium hover:underline">{who}</Link> : <span className="font-medium">{who}</span>}
        <div className="text-xs text-muted">{a.professional} · {fmtDateTime(a.starts_at)}</div>
      </div>
      <SpecialtyChip s={a.specialty} />
      {a.status === "agendado" && a.confirmed_at && <span className="chip bg-ok-soft text-green-800">Confirmada</span>}
      {a.status === "agendado" && !a.confirmed_at && a.reminder_sent_at && <span className="chip bg-amber-100 text-amber-800">Lembrete enviado</span>}
      {marker && <AttendanceButtons appointmentId={a.id} status={a.status} />}
    </li>
  );
}

export default async function Consultas() {
  const all = (await getAppointments()).filter((a) => a.status !== "cancelado" && a.status !== "remarcado");
  const now = Date.now();
  const pendentes = all.filter((a) => a.status === "agendado" && +new Date(a.starts_at) <= now).sort((a, b) => +new Date(a.starts_at) - +new Date(b.starts_at));
  const proximas = all.filter((a) => a.status === "agendado" && +new Date(a.starts_at) > now).sort((a, b) => +new Date(a.starts_at) - +new Date(b.starts_at));
  const baixadas = all.filter((a) => a.status === "compareceu" || a.status === "faltou").slice(0, 40);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Consultas</h1>
        <p className="max-w-xl text-sm text-muted">Dê baixa em um clique: Compareceu ou Faltou. Isso alimenta a conversão real do Painel e o aprendizado semanal da IA.</p>
      </header>

      <section className="card p-5">
        <h2 className="mb-1 text-sm font-semibold">Aguardando baixa <span className="text-muted">({pendentes.length})</span></h2>
        <ul className="divide-y divide-line">
          {pendentes.length === 0 && <li className="py-3 text-sm text-muted">Nenhuma consulta passada sem baixa.</li>}
          {pendentes.map((a) => <Row key={a.id} a={a} marker />)}
        </ul>
      </section>

      <section className="card p-5">
        <h2 className="mb-1 text-sm font-semibold">Próximas <span className="text-muted">({proximas.length})</span></h2>
        <ul className="divide-y divide-line">
          {proximas.length === 0 && <li className="py-3 text-sm text-muted">Nenhuma consulta futura.</li>}
          {proximas.map((a) => <Row key={a.id} a={a} marker={false} />)}
        </ul>
      </section>

      <section className="card p-5">
        <h2 className="mb-1 text-sm font-semibold">Baixas recentes</h2>
        <ul className="divide-y divide-line">
          {baixadas.length === 0 && <li className="py-3 text-sm text-muted">Ainda não há consultas com baixa.</li>}
          {baixadas.map((a) => <Row key={a.id} a={a} marker />)}
        </ul>
      </section>
    </div>
  );
}
