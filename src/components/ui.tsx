import { STAGE_LABEL, type Stage } from "@/lib/clinic-config";

const STAGE_STYLE: Record<Stage, string> = {
  novo: "bg-slate-100 text-slate-700",
  qualificado: "bg-sky-100 text-sky-800",
  horario_oferecido: "bg-amber-100 text-amber-800",
  agendado: "bg-ok-soft text-green-800",
  compareceu: "bg-emerald-200 text-emerald-900",
  perdido: "bg-bad-soft text-bad",
};

export const StageChip = ({ stage }: { stage: Stage }) => <span className={`chip ${STAGE_STYLE[stage]}`}>{STAGE_LABEL[stage]}</span>;

export const SpecialtyChip = ({ s }: { s: string | null }) => (
  <span className="chip bg-brand-soft text-brand capitalize">{s ?? "a definir"}</span>
);

export function Kpi({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 text-3xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

export function Bar({ label, value, max, sub }: { label: string; value: number; max: number; sub?: string }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-sm">
        <span className="capitalize">{label}</span>
        <span className="tabular-nums text-muted">{sub ?? value}</span>
      </div>
      <div className="h-2.5 rounded-full bg-line">
        <div className="h-2.5 rounded-full bg-brand" style={{ width: `${max ? Math.max(3, (value / max) * 100) : 0}%` }} />
      </div>
    </div>
  );
}
