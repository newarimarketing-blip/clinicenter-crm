"use server";
import { revalidatePath } from "next/cache";
import { backTo } from "@/lib/aba";
import { isDemo, supabaseServer } from "@/lib/supabase-server";
import { admin } from "@/lib/supabase-admin";
import { currentMe } from "@/lib/roles";
import { getClinicSettings } from "@/lib/clinic-settings";
import { activeAppointment, createAppointment, freeSlots, resolveSlot } from "@/lib/agenda";
import { logEvent, updateLead, upsertLead } from "@/lib/leads";
import { closeWaitlist } from "@/lib/waitlist";

/* ---------- Equipe: criar usuário com senha, editar permissão/senha, excluir ---------- */

const back = (q: string): Promise<never> => backTo("/configuracoes", q);
const fail = (m: string) => back("erro=" + encodeURIComponent(m));
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

async function gestor() {
  if (isDemo) return fail("Modo demonstração: nada é salvo.");
  const me = await currentMe();
  if (!me.email || me.role !== "gestor") return fail("Somente o gestor pode gerenciar a equipe.");
  return me;
}

async function findUserId(email: string): Promise<string | null> {
  const { data } = await admin().auth.admin.listUsers({ page: 1, perPage: 200 });
  return data?.users.find((u) => u.email?.toLowerCase() === email)?.id ?? null;
}

const readRole = (v: FormDataEntryValue | null) => (String(v) === "gestor" ? "gestor" : "recepcao");

/** Cria o usuário já com e-mail confirmado e senha definida pelo gestor. */
export async function createTeamUser(formData: FormData) {
  await gestor();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!EMAIL.test(email)) return fail("E-mail inválido.");
  if (password.length < 8) return fail("A senha precisa ter pelo menos 8 caracteres.");
  const { error } = await admin().auth.admin.createUser({ email, password, email_confirm: true });
  if (error) return fail(/already|registered|exists/i.test(error.message) ? "Já existe um usuário com esse e-mail. Use Editar para trocar a senha ou o papel." : error.message);
  const { error: e2 } = await admin().from("user_roles").upsert({ email, role: readRole(formData.get("role")) });
  if (e2) return fail("Usuário criado, mas o papel não foi salvo: " + e2.message);
  revalidatePath("/configuracoes");
  return back("ok=usuario-criado");
}

/** Troca o papel e/ou a senha de um usuário. */
export async function updateTeamUser(formData: FormData) {
  const me = await gestor();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = readRole(formData.get("role"));
  const password = String(formData.get("password") ?? "");
  if (!EMAIL.test(email)) return fail("E-mail inválido.");
  if (email === me.email && role !== "gestor") return fail("Você não pode tirar o seu próprio acesso de gestor.");
  if (password && password.length < 8) return fail("A nova senha precisa ter pelo menos 8 caracteres.");
  if (password) {
    const id = await findUserId(email);
    if (!id) return fail("Esse e-mail ainda não tem usuário no login: crie o usuário primeiro.");
    const { error } = await admin().auth.admin.updateUserById(id, { password });
    if (error) return fail(error.message);
  }
  const { error } = await admin().from("user_roles").upsert({ email, role });
  if (error) return fail(error.message);
  revalidatePath("/configuracoes");
  return back(password ? "ok=usuario-senha" : "ok=papel");
}

/** Exclui o usuário (login e papel). */
export async function deleteTeamUser(formData: FormData) {
  const me = await gestor();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (email === me.email) return fail("Você não pode excluir o seu próprio usuário.");
  const id = await findUserId(email);
  if (id) {
    const { error } = await admin().auth.admin.deleteUser(id);
    if (error) return fail(error.message);
  }
  await admin().from("user_roles").delete().eq("email", email);
  revalidatePath("/configuracoes");
  return back("ok=usuario-removido");
}

/* ---------- Agenda: agendar consulta pelo portal ---------- */

async function loggedIn() {
  if (isDemo) return null;
  const db = await supabaseServer();
  const { data } = await db.auth.getUser();
  return data.user ?? null;
}

export type SlotOption = { startTime: string; label: string };

/** Horários livres de um especialista em uma data (YYYY-MM-DD), conforme a grade e a agenda do Google. */
export async function slotsForDay(profKey: string, date: string): Promise<{ slots: SlotOption[]; error?: string }> {
  if (!(await loggedIn())) return { slots: [], error: isDemo ? "Modo demonstração: nada é salvo." : "Sessão expirada. Entre de novo." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { slots: [], error: "Data inválida." };
  const p = (await getClinicSettings()).professionals.find((x) => x.key === profKey);
  if (!p) return { slots: [], error: "Especialista não encontrado." };
  const slots = await freeSlots(p, { date }, 100);
  return { slots: slots.map((s) => ({ startTime: s.startTime, label: s.label.replace(/^.*às /, "") })) };
}

const normPhone = (v: string) => {
  const d = v.replace(/\D/g, "");
  return d.length === 10 || d.length === 11 ? `55${d}` : d;
};

const hmLocal = (iso: string) => new Date(+new Date(iso) - 3 * 3600e3).toISOString().slice(11, 16); // relógio de Fortaleza (UTC-3)

/** Cria a consulta (banco + Google Calendar). Exige data e hora; se o cliente ainda não existe, cadastra. */
export async function bookAppointment(input: { name: string; phone: string; profKey: string; date: string; time: string; insurance?: string }): Promise<{ ok: boolean; error?: string; newClient?: boolean; leadId?: string }> {
  const user = await loggedIn();
  if (!user) return { ok: false, error: isDemo ? "Modo demonstração: nada é salvo." : "Sessão expirada. Entre de novo." };
  const name = input.name.trim();
  const phone = normPhone(input.phone);
  if (name.length < 2) return { ok: false, error: "Informe o nome do paciente." };
  if (phone.length < 12 || phone.length > 13) return { ok: false, error: "Informe o WhatsApp com DDD (ex.: 88 99999-0000)." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date ?? "")) return { ok: false, error: "Informe a data da consulta." };
  if (!/^\d{2}:\d{2}$/.test(input.time ?? "")) return { ok: false, error: "Informe o horário da consulta." };
  const p = (await getClinicSettings()).professionals.find((x) => x.key === input.profKey);
  if (!p) return { ok: false, error: "Escolha o especialista." };
  try {
    const free = await freeSlots(p, { date: input.date }, 100);
    const slot = free.find((s) => hmLocal(s.startTime) === input.time);
    if (!slot) {
      const opts = free.map((s) => hmLocal(s.startTime)).slice(0, 8).join(", ");
      return { ok: false, error: `${input.time} não está livre nesse dia.${opts ? ` Horários livres: ${opts}.` : " Não há horários livres nessa data."}` };
    }
    const { data: existingLead } = await admin().from("leads").select("id").eq("phone", phone).maybeSingle();
    const lead = await upsertLead(phone, name);
    const existing = await activeAppointment(lead.id, p.key);
    if (existing) return { ok: false, error: `Esse paciente já tem consulta com ${existing.professional} marcada para ${new Date(existing.starts_at).toLocaleString("pt-BR", { timeZone: "America/Fortaleza", dateStyle: "short", timeStyle: "short" })}.` };
    const appt = await createAppointment({ leadId: lead.id, patient: name, phone, p, slot, by: user.email ?? "equipe" });
    await updateLead(lead, { patient_name: name, specialty: p.specialty, stage: "agendado", score: 100, ...(input.insurance?.trim() ? { insurance: input.insurance.trim() } : {}) });
    await logEvent(lead.id, "appointment_created", { id: appt.id, starts_at: slot.startTime, professional: p.name, by: user.email ?? "equipe", new_client: !existingLead });
    await closeWaitlist(lead.id, p.key, "agendado").catch(() => {});
    revalidatePath("/agenda");
    revalidatePath("/funil");
    revalidatePath("/consultas");
    revalidatePath("/clientes");
    return { ok: true, newClient: !existingLead, leadId: lead.id };
  } catch (e) {
    return { ok: false, error: "Não foi possível agendar: " + String(e instanceof Error ? e.message : e).slice(0, 160) };
  }
}

/** Tira um paciente da lista de espera. */
export async function removeWaitlistEntry(id: string) {
  if (!(await loggedIn())) return;
  await admin().from("waitlist").update({ status: "cancelado", offered_starts_at: null }).eq("id", id);
  revalidatePath("/agenda");
}
