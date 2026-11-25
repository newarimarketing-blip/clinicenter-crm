// Lista de espera: guarda o pedido de horário sem vaga e avisa o 1º da fila quando uma vaga abre.
import { admin } from "./supabase-admin";
import { freeSlots, periodOf, resolveSlot, type Slot } from "./agenda";
import { getClinicSettings } from "./clinic-settings";
import { sendText } from "./evolution";
import { inSendWindow } from "./followups";
import { fmtDateTime } from "./time";

export type Periodo = "manha" | "tarde" | "noite";
export type WaitEntry = {
  id: string; created_at: string; lead_id: string; professional_key: string;
  periodo: Periodo | null; dia_semana: string | null; status: string;
  offered_starts_at: string | null; offered_at: string | null; declined: string[]; note: string | null;
};

export const OFFER_TTL_H = 2; // sem resposta em 2 h: a vaga passa para o próximo da fila
const TABLE_MSG = /waitlist|relation|schema cache/i;
const DOW = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"];
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Hora e dia da semana no relógio de Fortaleza (UTC-3). */
function localParts(iso: string) {
  const d = new Date(+new Date(iso) - 3 * 3600e3);
  return { dow: DOW[d.getUTCDay()], hour: d.getUTCHours() };
}

const matches = (e: Pick<WaitEntry, "periodo" | "dia_semana" | "declined">, startsAt: string) => {
  const { dow, hour } = localParts(startsAt);
  if (e.periodo && e.periodo !== periodOf(hour)) return false;
  if (e.dia_semana && norm(e.dia_semana) !== dow) return false;
  return !(e.declined ?? []).some((d) => +new Date(d) === +new Date(startsAt));
};

/** Registra (ou atualiza) o pedido do paciente na fila daquele profissional. */
export async function joinWaitlist(leadId: string, professionalKey: string, periodo?: Periodo | null, diaSemana?: string | null, note?: string) {
  const db = admin();
  const { data: cur, error } = await db.from("waitlist").select("id").eq("lead_id", leadId).eq("professional_key", professionalKey).in("status", ["aguardando", "oferecido"]).maybeSingle();
  if (error) throw new Error(TABLE_MSG.test(error.message) ? "tabela waitlist ausente: rode a migração 008" : error.message);
  const row = { periodo: periodo ?? null, dia_semana: diaSemana ? norm(diaSemana) : null, note: note ?? null };
  if (cur) {
    await db.from("waitlist").update(row).eq("id", cur.id);
    return cur.id as string;
  }
  const { data, error: e2 } = await db.from("waitlist").insert({ lead_id: leadId, professional_key: professionalKey, ...row }).select("id").single();
  if (e2) throw e2;
  return data.id as string;
}

/** Oferta pendente (esperando resposta) do paciente, para o contexto do agente. */
export async function pendingOffer(leadId: string): Promise<(WaitEntry & { startTime: string }) | null> {
  const { data, error } = await admin().from("waitlist").select("*").eq("lead_id", leadId).eq("status", "oferecido").order("offered_at", { ascending: false }).limit(1);
  if (error || !data?.length) return null;
  const e = data[0] as WaitEntry;
  return e.offered_starts_at ? { ...e, startTime: e.offered_starts_at } : null;
}

export async function waitingCount(leadId: string): Promise<WaitEntry[]> {
  const { data, error } = await admin().from("waitlist").select("*").eq("lead_id", leadId).eq("status", "aguardando");
  return error ? [] : ((data ?? []) as WaitEntry[]);
}

/** Encerra os pedidos do paciente com o profissional (ex.: ele conseguiu agendar). */
export async function closeWaitlist(leadId: string, professionalKey: string, status: "agendado" | "cancelado" = "agendado") {
  await admin().from("waitlist").update({ status, offered_starts_at: null }).eq("lead_id", leadId).eq("professional_key", professionalKey).in("status", ["aguardando", "oferecido"]);
}

/** O paciente não quis a vaga oferecida: volta para a fila (ou sai dela) e a vaga segue para o próximo. */
export async function declineOffer(leadId: string, leaveList: boolean) {
  const db = admin();
  const { data } = await db.from("waitlist").select("*").eq("lead_id", leadId).eq("status", "oferecido");
  for (const e of (data ?? []) as WaitEntry[]) {
    const declined = e.offered_starts_at ? [...(e.declined ?? []), e.offered_starts_at] : e.declined ?? [];
    await db.from("waitlist").update({ status: leaveList ? "cancelado" : "aguardando", declined, offered_starts_at: null, offered_at: null }).eq("id", e.id);
    if (e.offered_starts_at) await offerFreedSlot(e.professional_key, e.offered_starts_at).catch(() => {});
  }
}

async function sendOffer(entry: WaitEntry, startsAt: string, profName: string): Promise<boolean> {
  const db = admin();
  const { data: lead } = await db.from("leads").select("id,phone,name,patient_name").eq("id", entry.lead_id).single();
  if (!lead) return false;
  const first = (lead.patient_name ?? lead.name ?? "").trim().split(/\s+/)[0];
  const text = `${first ? `Oi, ${first}!` : "Oi!"} Aqui é a Marcelia da Clinicenter. Abriu uma vaga com ${profName} em ${fmtDateTime(startsAt)}, e você estava na nossa lista de espera. Quer ficar com esse horário? É só me responder que eu já agendo pra você.`;
  const waId = await sendText(lead.phone, text, 1500);
  await db.from("messages").insert({ lead_id: lead.id, role: "ia", content: text, wa_id: waId ?? null, processed: true });
  await db.from("lead_events").insert({ lead_id: lead.id, type: "waitlist_offer", data: { professional: profName, starts_at: startsAt } });
  await db.from("waitlist").update({ status: "oferecido", offered_starts_at: startsAt, offered_at: new Date().toISOString() }).eq("id", entry.id);
  return true;
}

/**
 * Uma vaga abriu: confere se está mesmo livre e oferece ao 1º da fila compatível
 * (profissional, período e dia desejados). Fora do horário de envio, fica para a rotina diária.
 */
export async function offerFreedSlot(professionalKey: string, startsAt: string): Promise<{ offered: boolean; reason?: string }> {
  const cfg = await getClinicSettings();
  const p = cfg.professionals.find((x) => x.key === professionalKey);
  if (!p) return { offered: false, reason: "profissional inativo" };
  const slot = await resolveSlot(p, startsAt);
  if (!slot) return { offered: false, reason: "horário não está livre" };
  const db = admin();
  const { data, error } = await db.from("waitlist").select("*").eq("professional_key", professionalKey).in("status", ["aguardando", "oferecido"]).order("created_at");
  if (error) return { offered: false, reason: "sem tabela" };
  const entries = (data ?? []) as WaitEntry[];
  if (entries.some((e) => e.status === "oferecido" && e.offered_starts_at && +new Date(e.offered_starts_at) === +new Date(slot.startTime))) return { offered: false, reason: "já oferecida" };
  if (!inSendWindow()) return { offered: false, reason: "fora do horário de envio" };
  for (const e of entries.filter((x) => x.status === "aguardando")) {
    if (!matches(e, slot.startTime)) continue;
    // não oferece a quem já tem consulta ativa com o mesmo profissional
    const { count } = await db.from("appointments").select("id", { count: "exact", head: true }).eq("lead_id", e.lead_id).eq("calendar_hint", professionalKey).eq("status", "agendado").gte("starts_at", new Date().toISOString());
    if (count) continue;
    if (await sendOffer(e, slot.startTime, p.name)) return { offered: true };
  }
  return { offered: false, reason: "ninguém compatível na fila" };
}

/**
 * Rotina diária: ofertas sem resposta há mais de OFFER_TTL_H voltam para a fila e a vaga segue para o próximo;
 * depois varre as agendas e oferece vagas livres a quem está esperando.
 */
export async function runWaitlist(now = Date.now()): Promise<{ expired: number; offered: number }> {
  const db = admin();
  let expired = 0, offered = 0;
  const { data: stale, error } = await db.from("waitlist").select("*").eq("status", "oferecido").lt("offered_at", new Date(now - OFFER_TTL_H * 3600e3).toISOString());
  if (error) return { expired, offered };
  for (const e of (stale ?? []) as WaitEntry[]) {
    const declined = e.offered_starts_at ? [...(e.declined ?? []), e.offered_starts_at] : e.declined ?? [];
    await db.from("waitlist").update({ status: "aguardando", declined, offered_starts_at: null, offered_at: null }).eq("id", e.id);
    expired++;
  }
  if (!inSendWindow(now)) return { expired, offered };
  const { data: waiting } = await db.from("waitlist").select("*").eq("status", "aguardando").order("created_at");
  const cfg = await getClinicSettings();
  const claimed = new Set<string>(); // vagas já oferecidas nesta rodada
  for (const e of (waiting ?? []) as WaitEntry[]) {
    const p = cfg.professionals.find((x) => x.key === e.professional_key);
    if (!p) continue;
    const { count } = await db.from("appointments").select("id", { count: "exact", head: true }).eq("lead_id", e.lead_id).eq("calendar_hint", p.key).eq("status", "agendado").gte("starts_at", new Date(now).toISOString());
    if (count) continue;
    const slots: Slot[] = await freeSlots(p, { janelaDias: 21, periodo: e.periodo ?? undefined, dia_semana: e.dia_semana ?? undefined }, 60);
    const pick = slots.find((s) => matches(e, s.startTime) && !claimed.has(`${p.key}|${s.startTime}`));
    if (!pick) continue;
    // não oferece a mesma vaga a duas pessoas ao mesmo tempo
    const { data: open } = await db.from("waitlist").select("id").eq("professional_key", p.key).eq("status", "oferecido").eq("offered_starts_at", new Date(pick.startTime).toISOString()).limit(1);
    if (open?.length) continue;
    if (await sendOffer(e, pick.startTime, p.name)) { claimed.add(`${p.key}|${pick.startTime}`); offered++; }
  }
  return { expired, offered };
}
