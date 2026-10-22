"use client";
import { useTransition } from "react";
import { markAttendance, type Attendance } from "@/app/actions";

/** Compareceu / Faltou em um clique. Clicar no botão já marcado desfaz. */
export function AttendanceButtons({ appointmentId, status }: { appointmentId: string; status: string }) {
  const [pending, start] = useTransition();
  const go = (r: Attendance) => start(() => markAttendance(appointmentId, status === r ? "limpar" : r));
  const base = "rounded-md border px-2 py-1 text-xs font-medium disabled:opacity-50";
  return (
    <div className="flex gap-1.5" aria-busy={pending}>
      <button type="button" disabled={pending} onClick={() => go("compareceu")} className={`${base} ${status === "compareceu" ? "border-green-700 bg-green-700 text-white" : "border-line bg-white text-green-800 hover:bg-ok-soft"}`}>
        Compareceu
      </button>
      <button type="button" disabled={pending} onClick={() => go("faltou")} className={`${base} ${status === "faltou" ? "border-bad bg-bad text-white" : "border-line bg-white text-bad hover:bg-bad-soft"}`}>
        Faltou
      </button>
    </div>
  );
}
