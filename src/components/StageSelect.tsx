"use client";
import { STAGES, STAGE_LABEL, type Stage } from "@/lib/clinic-config";
import { setStage } from "@/app/actions";

export function StageSelect({ leadId, stage }: { leadId: string; stage: Stage }) {
  return (
    <select
      defaultValue={stage}
      onChange={(e) => setStage(leadId, e.target.value as Stage)}
      className="rounded-md border border-line bg-white px-1.5 py-1 text-xs text-muted"
      aria-label="Mover para etapa"
    >
      {STAGES.map((s) => (
        <option key={s} value={s}>{STAGE_LABEL[s]}</option>
      ))}
    </select>
  );
}
