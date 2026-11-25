"use client";
import { useState, useTransition } from "react";
import { setStage } from "@/app/actions";
import type { Stage } from "@/lib/clinic-config";

/** Coluna que recebe cartões arrastados. */
export function KanbanColumn({ stage, children }: { stage: Stage; children: React.ReactNode }) {
  const [over, setOver] = useState(false);
  const [pending, start] = useTransition();
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (!over) setOver(true); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false); }}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const id = e.dataTransfer.getData("text/lead-id");
        const from = e.dataTransfer.getData("text/lead-stage");
        if (!id || from === stage) return;
        start(async () => { await setStage(id, stage); });
      }}
      className={`min-h-24 space-y-2 rounded-xl p-1 transition ${over ? "bg-brand-soft ring-2 ring-accent" : ""} ${pending ? "opacity-60" : ""}`}
    >
      {children}
      {pending && <p className="px-1 text-xs text-muted">Movendo…</p>}
    </div>
  );
}

/** Cartão que pode ser arrastado entre colunas. */
export function DraggableCard({ leadId, stage, children }: { leadId: string; stage: Stage; children: React.ReactNode }) {
  const [dragging, setDragging] = useState(false);
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/lead-id", leadId);
        e.dataTransfer.setData("text/lead-stage", stage);
        e.dataTransfer.effectAllowed = "move";
        setDragging(true);
      }}
      onDragEnd={() => setDragging(false)}
      className={`cursor-grab active:cursor-grabbing ${dragging ? "opacity-40" : ""}`}
    >
      {children}
    </div>
  );
}
