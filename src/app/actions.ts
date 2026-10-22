"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isDemo, supabaseServer } from "@/lib/supabase-server";
import { sendText } from "@/lib/evolution";
import { runLearning } from "@/lib/learn";
import { generateWeeklyReport } from "@/lib/report";
import { admin } from "@/lib/supabase-admin";
import { getClinicSettings, invalidateClinicSettings, parseInsurance, parseWindows, slugKey } from "@/lib/clinic-settings";
import { createProfessionalCalendar } from "@/lib/agenda";
import { currentMe } from "@/lib/roles";
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

/** Só gestor altera configurações (a recepção apenas visualiza). */
async function gestorOnly() {
  const ctx = await requireUser();
  if (!ctx) return back("erro=" + encodeURIComponent("Modo demonstração: nada é salvo."));
  const me = await currentMe();
  if (me.role !== "gestor") return back("erro=" + encodeURIComponent("Somente o gestor pode alterar as configurações."));
  return ctx;
}

async function persistSetting(key: "prices" | "insurance" | "professionals", value: unknown) {
  const ctx = await gestorOnly();
  const { error } = await ctx.db.from("clinic_settings").upsert({ key, value, updated_at: new Date().toISOString(), updated_by: ctx.user.id });
  if (error) {
    const msg = /clinic_settings|relation|schema cache/i.test(error.message) ? "A tabela clinic_settings ainda não existe: rode a migração 004 no Supabase." : error.message;
    return back("erro=" + encodeURIComponent(msg));
  }
  invalidateClinicSettings();
  revalidatePath("/configuracoes");
  return back(`ok=${key}`);
}

export async function saveInsurance(formData: FormData) {
  const r = parseInsurance(String(formData.get("insurance") ?? ""));
  if (!r.ok) return back("erro=" + encodeURIComponent(r.error));
  return persistSetting("insurance", r.value);
}

/** Volta uma seção aos valores padrão do sistema (apaga só a personalização). */
export async function restoreDefaults(formData: FormData) {
  const key = String(formData.get("section") ?? "");
  if (!["prices", "insurance", "professionals"].includes(key)) return;
  const ctx = await gestorOnly();
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

/* ---------- Profissionais, serviços e equipe (somente gestor) ---------- */

const err = (m: string) => back("erro=" + encodeURIComponent(m));
const TABLE_MSG = "As tabelas novas ainda não existem: rode a migração 006 no Supabase.";

function readSchedule(formData: FormData, who: string): Record<string, [string, string][]> {
  const schedule: Record<string, [string, string][]> = {};
  for (let d = 0; d < 7; d++) {
    const w = parseWindows(String(formData.get(`dow${d}`) ?? ""));
    if (!w.ok) return err(`${who}: ${w.error}`);
    if (w.value.length) schedule[String(d)] = w.value;
  }
  return schedule;
}

const normSpecialty = (v: FormDataEntryValue | null) => String(v ?? "").trim().toLowerCase();

function shareEmails(): string[] {
  return (process.env.CALENDAR_SHARE_EMAILS || "clinicenter.mkt@gmail.com,newarimarketing@gmail.com").split(",").map((e) => e.trim()).filter(Boolean);
}

/** Cadastra um especialista (e, se marcado, cria a agenda dele no Google Calendar da clínica). */
export async function createProfessional(formData: FormData) {
  await gestorOnly();
  const cfg = await getClinicSettings();
  if (!cfg.tables.professionals) return err(TABLE_MSG);
  const name = String(formData.get("name") ?? "").trim();
  const specialty = normSpecialty(formData.get("specialty"));
  const slotMin = Number(formData.get("slotMin"));
  if (name.length < 2 || name.length > 80) return err("Informe o nome do especialista.");
  if (specialty.length < 3 || specialty.length > 40) return err("Informe a especialidade (3 a 40 letras).");
  if (!Number.isInteger(slotMin) || slotMin < 10 || slotMin > 180) return err("A duração da consulta deve ficar entre 10 e 180 minutos.");
  const schedule = readSchedule(formData, name);

  const taken = new Set(cfg.professionalsAll.map((p) => p.key));
  const base = slugKey(name);
  let key = base;
  for (let i = 2; taken.has(key); i++) key = `${base}${i}`;

  let calendar_id: string | null = null;
  let aviso = "";
  if (formData.get("criarAgenda") === "on") {
    try {
      const cal = await createProfessionalCalendar(name, shareEmails());
      calendar_id = cal.id;
      aviso = cal.warning ?? "";
    } catch (e) {
      return err(`Não consegui criar a agenda no Google Calendar (${String(e).slice(0, 160)}). Nada foi cadastrado; tente de novo ou desmarque "Criar agenda".`);
    }
  }
  const { error } = await admin().from("professionals").insert({ key, name, specialty, slot_min: slotMin, particular_only: formData.get("particularOnly") === "on", schedule, calendar_id });
  if (error) return err(error.message);
  invalidateClinicSettings();
  revalidatePath("/configuracoes");
  revalidatePath("/agenda");
  return back(`ok=prof-novo${aviso ? "&aviso=" + encodeURIComponent(aviso) : ""}`);
}

/** Edita nome, especialidade, duração, grade e situação (ativo) de um especialista. */
export async function updateProfessional(formData: FormData) {
  await gestorOnly();
  const key = String(formData.get("key") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const specialty = normSpecialty(formData.get("specialty"));
  const slotMin = Number(formData.get("slotMin"));
  if (name.length < 2 || name.length > 80) return err("Informe o nome do especialista.");
  if (specialty.length < 3 || specialty.length > 40) return err("Informe a especialidade (3 a 40 letras).");
  if (!Number.isInteger(slotMin) || slotMin < 10 || slotMin > 180) return err("A duração da consulta deve ficar entre 10 e 180 minutos.");
  const schedule = readSchedule(formData, name);
  const { error } = await admin().from("professionals").update({ name, specialty, slot_min: slotMin, particular_only: formData.get("particularOnly") === "on", schedule, active: formData.get("active") === "on" }).eq("key", key);
  if (error) return err(/relation|schema cache/i.test(error.message) ? TABLE_MSG : error.message);
  invalidateClinicSettings();
  revalidatePath("/configuracoes");
  revalidatePath("/agenda");
  return back("ok=professionals");
}

/** Cria a agenda do Google para um profissional que ainda não tem uma. */
export async function createCalendarFor(formData: FormData) {
  await gestorOnly();
  const key = String(formData.get("key") ?? "");
  const p = (await getClinicSettings()).professionalsAll.find((x) => x.key === key);
  if (!p) return err("Profissional desconhecido.");
  try {
    const cal = await createProfessionalCalendar(p.name, shareEmails());
    const { error } = await admin().from("professionals").update({ calendar_id: cal.id }).eq("key", key);
    if (error) return err(error.message);
    invalidateClinicSettings();
    revalidatePath("/configuracoes");
    return back(`ok=agenda-criada${cal.warning ? "&aviso=" + encodeURIComponent(cal.warning) : ""}`);
  } catch (e) {
    return err(`Não consegui criar a agenda: ${String(e).slice(0, 160)}`);
  }
}

/** Cadastra ou edita um serviço (nome, valor, especialidade, profissional). */
export async function saveService(formData: FormData) {
  await gestorOnly();
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const price = String(formData.get("price") ?? "").trim();
  const specialty = normSpecialty(formData.get("specialty")) || null;
  const professional_key = String(formData.get("professional_key") ?? "") || null;
  const note = String(formData.get("note") ?? "").trim() || null;
  if (name.length < 2 || name.length > 80) return err("Informe o nome do serviço.");
  if (!price || price.length > 60) return err("Informe o valor (ex.: R$ 220,00).");
  const row = { name, price, specialty, professional_key, note, particular_only: formData.get("particularOnly") === "on", active: id ? formData.get("active") === "on" : true };
  const q = id ? admin().from("services").update(row).eq("id", id) : admin().from("services").insert({ ...row, sort: Date.now() % 1000000 });
  const { error } = await q;
  if (error) return err(/relation|schema cache/i.test(error.message) ? TABLE_MSG : error.message);
  invalidateClinicSettings();
  revalidatePath("/configuracoes");
  return back(`ok=${id ? "servico" : "servico-novo"}`);
}

export async function deleteService(formData: FormData) {
  await gestorOnly();
  const { error } = await admin().from("services").delete().eq("id", String(formData.get("id") ?? ""));
  if (error) return err(error.message);
  invalidateClinicSettings();
  revalidatePath("/configuracoes");
  return back("ok=servico-removido");
}

/** Define o papel (gestor/recepção) de um e-mail. O usuário precisa existir no Supabase Auth para conseguir entrar. */
export async function setRole(formData: FormData) {
  await gestorOnly();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = String(formData.get("role") ?? "");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return err("E-mail inválido.");
  if (role !== "gestor" && role !== "recepcao") return err("Papel inválido.");
  const me = await currentMe();
  if (email === me.email && role !== "gestor") return err("Você não pode tirar o seu próprio acesso de gestor.");
  const { error } = await admin().from("user_roles").upsert({ email, role });
  if (error) return err(/relation|schema cache/i.test(error.message) ? TABLE_MSG : error.message);
  revalidatePath("/configuracoes");
  return back("ok=papel");
}

/** Notas internas da equipe na ficha do lead (qualquer usuário logado). */
export async function saveLeadNotes(leadId: string, formData: FormData) {
  const ctx = await requireUser();
  if (!ctx) return;
  const notes = String(formData.get("notes") ?? "").slice(0, 4000);
  await ctx.db.from("leads").update({ notes: notes || null }).eq("id", leadId);
  revalidatePath("/funil");
}
