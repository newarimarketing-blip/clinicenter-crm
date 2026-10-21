"use server";
import { revalidatePath } from "next/cache";
import { isDemo, supabaseServer } from "@/lib/supabase-server";
import { sendText } from "@/lib/evolution";
import { runLearning } from "@/lib/learn";
import { CLINIC, type Stage } from "@/lib/clinic-config";

async function requireUser() {
  if (isDemo) return null;
  const db = await supabaseServer();
  const { data } = await db.auth.getUser();
  if (!data.user) throw new Error("não autenticado");
  return { db, user: data.user };
}

/** Equipe responde pelo CRM: envia no WhatsApp, grava e pausa a IA. */
export async function sendHumanMessage(leadId: string, phone: string, formData: FormData) {
  const text = String(formData.get("text") ?? "").trim();
  const ctx = await requireUser();
  if (!ctx || !text) return;
  const waId = await sendText(phone, text, 600);
  await ctx.db.from("messages").insert({ lead_id: leadId, role: "humano", content: text, wa_id: waId ?? null, processed: true });
  await ctx.db.from("leads").update({ ai_paused_until: new Date(Date.now() + CLINIC.humanPauseHours * 3600e3).toISOString() }).eq("id", leadId);
  revalidatePath("/conversas");
}

export async function setAiPaused(leadId: string, paused: boolean) {
  const ctx = await requireUser();
  if (!ctx) return;
  await ctx.db.from("leads").update({ ai_paused_until: paused ? new Date(Date.now() + CLINIC.humanPauseHours * 3600e3).toISOString() : null }).eq("id", leadId);
  revalidatePath("/conversas");
}

export async function setStage(leadId: string, stage: Stage) {
  const ctx = await requireUser();
  if (!ctx) return;
  await ctx.db.from("leads").update({ stage }).eq("id", leadId);
  await ctx.db.from("lead_events").insert({ lead_id: leadId, type: "stage_changed", data: { to: stage, by: "equipe" } });
  revalidatePath("/funil");
}

export async function approveScript(id: string) {
  const ctx = await requireUser();
  if (!ctx) return;
  await ctx.db.from("script_versions").update({ status: "arquivada" }).eq("status", "ativa");
  await ctx.db.from("script_versions").update({ status: "ativa", approved_by: ctx.user.id, approved_at: new Date().toISOString() }).eq("id", id);
  revalidatePath("/script");
}

export async function rejectScript(id: string) {
  const ctx = await requireUser();
  if (!ctx) return;
  await ctx.db.from("script_versions").update({ status: "rejeitada" }).eq("id", id);
  revalidatePath("/script");
}

export async function runLearningNow() {
  const ctx = await requireUser();
  if (!ctx) return;
  await runLearning(7);
  revalidatePath("/script");
}
