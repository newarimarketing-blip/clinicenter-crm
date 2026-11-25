"use client";
import { removeWaitlistEntry } from "@/app/team-actions";

export function WaitlistRemove({ id }: { id: string }) {
  return (
    <button type="button" className="text-xs text-bad underline" onClick={() => { if (window.confirm("Tirar este paciente da lista de espera?")) removeWaitlistEntry(id); }}>
      Remover
    </button>
  );
}
