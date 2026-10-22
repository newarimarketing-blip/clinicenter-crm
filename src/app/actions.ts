"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isDemo, supabaseServer } from "@/lib/supabase-server";
import { sendText } from "@/lib/evolution";
import { runLearning } from "@/lib/learn";
import { generateWeeklyReport } from "@/lib/report";
import { admin } from "@/lib/supabase-admin";
import { getClinicSettings, invalidateClinicSettings, parseInsurance, parseWindows, pricesSchema } from "@/lib/clinic-settings";
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

export type Attendance = "compareceu" | "faltou" | "limpar";

/**
 * Um clique: compareceu / faltou (ou "limpar" para desfazer).
 * - compareceu: consulta = compareceu e lead = etapa "Compareceu".
 * - faltou: consulta = faltou e lead = "Perdido" com motivo "faltou" (não conta como conversão real).
 * - limpar: volta a consulta e o lead para "Agendado".
 */
export async function markAttendance(appointmentId: string, result: Attendance) {
  const ctx = await requireUser();
  if (!ctx) return;
  const { data: appt } = await ctx.db.from("appointments").select("id, lead_id").eq("id", appointmentId).maybeSingle();
  if (!appt) return;
  const status = result === "limpar" ? "agendado" : result;
  await ctx.db.from("appointments").update({ status }).eq("id", appointmentId);
  const stage: Stage = result === "compareceu" ? "compareceu" : result === "faltou" ? "perdido" : "agendado";
  await ctx.db.from("leads").update({ stage, lost_reason: result === "faltou" ? "faltou" : null }).eq("id", appt.lead_id);
  await admin().from("lead_events").insert({ lead_id: appt.lead_id, type: "attendance_marked", data: { result, appointment_id: appointmentId, by: ctx.user.email ?? "equipe" } });
  revalidatePath("/consultas");
  revalidatePath("/funil");
  revalidatePath("/");
}

/* ---------- Configurações da clínica (preços, convênios, grades) ---------- */

const back = (q: string): never => redirect(`/configuracoes?${q}`);

async function persistSetting(key: "prices" | "insurance" | "professionals", value: unknown) {
  const ctx = await requireUser();
  if (!ctx) return back("erro=" + encodeURIComponent("Modo demonstração: nada é salvo."));
  const { error } = await ctx.db.from("clinic_settings").upsert({ key, value, updated_at: new Date().toISOString(), updated_by: ctx.user.id });
  if (error) {
    const msg = /clinic_settings|relation|schema cache/i.test(error.message) ? "A tabela clinic_settings ainda não existe: rode a migração 004 no Supabase." : error.message;
    return back("erro=" + encodeURIComponent(msg));
  }
  invalidateClinicSettings();
  revalidatePath("/configuracoes");
  return back(`ok=${key}`);
}

export async function savePrices(formData: FormData) {
  const lines = String(formData.get("prices") ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  const r = pricesSchema.safeParse(lines);
  if (!r.success) return back("erro=" + encodeURIComponent("Informe de 1 a 30 linhas de preço (até 240 caracteres cada)."));
  return persistSetting("prices", r.data);
}

export async function saveInsurance(formData: FormData) {
  const r = parseInsurance(String(formData.get("insurance") ?? ""));
  if (!r.ok) return back("erro=" + encodeURIComponent(r.error));
  return persistSetting("insurance", r.value);
}

/** Salva a grade de UM profissional (os demais são mantidos como estão hoje). */
export async function saveProfessional(formData: FormData) {
  const key = String(formData.get("key") ?? "");
  const cfg = await getClinicSettings();
  const cur = cfg.professionals.find((p) => p.key === key);
  if (!cur) return back("erro=" + encodeURIComponent("Profissional desconhecido."));
  const name = String(formData.get("name") ?? "").trim();
  const slotMin = Number(formData.get("slotMin"));
  if (name.length < 2 || name.length > 80) return back("erro=" + encodeURIComponent("Informe o nome do profissional."));
  if (!Number.isInteger(slotMin) || slotMin < 10 || slotMin > 180) return back("erro=" + encodeURIComponent("A duração da consulta deve ficar entre 10 e 180 minutos."));
  const schedule: Record<string, [string, string][]> = {};
  for (let d = 0; d < 7; d++) {
    const w = parseWindows(String(formData.get(`dow${d}`) ?? ""));
    if (!w.ok) return back("erro=" + encodeURIComponent(`${cur.name}: ${w.error}`));
    if (w.value.length) schedule[String(d)] = w.value;
  }
  const all = cfg.professionals.map((p) =>
    p.key === key
      ? { key, name, slotMin, particularOnly: formData.get("particularOnly") === "on", schedule }
      : { key: p.key, name: p.name, slotMin: p.slotMin, particularOnly: p.particularOnly, schedule: Object.fromEntries(Object.entries(p.schedule).map(([d, w]) => [d, w])) },
  );
  return persistSetting("professionals", all);
}

/** Volta uma seção aos valores padrão do sistema (apaga só a personalização). */
export async function restoreDefaults(formData: FormData) {
  const key = String(formData.get("section") ?? "");
  if (!["prices", "insurance", "professionals"].includes(key)) return;
  const ctx = await requireUser();
  if (!ctx) return;
  await ctx.db.from("clinic_settings").delete().eq("key", key);
  invalidateClinicSettings();
  revalidatePath("/configuracoes");
  return back(`ok=${key}-padrao`);
}

/** Gera agora o relatório da última semana fechada (o cron faz isso sozinho toda segunda). */
export async function generateReportNow() {
  const ctx = await requireUser();
  if (!ctx) return;
  try {
    await generateWeeklyReport();
  } catch (e) {
    return redirect("/relatorios?erro=" + encodeURIComponent(/weekly_reports|relation|schema cache/i.test(String(e)) ? "A tabela weekly_reports ainda não existe: rode a migração 005 no Supabase." : String(e).slice(0, 200)));
  }
  revalidatePath("/relatorios");
  redirect("/relatorios");
}
