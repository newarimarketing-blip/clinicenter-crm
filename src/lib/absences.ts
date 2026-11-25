// Faltas de profissionais: bloqueiam o dia na agenda e avisam por WhatsApp quem tinha consulta.
import { admin } from "./supabase-admin";
import { cancelById, findProf } from "./agenda";
import { sendText } from "./evolution";
import { logEvent } from "./leads";

export type AbsenceRange = { from: string; to: string };
export type Absence = { id: string; created_at: string; professional_key: string; starts_on: string; ends_on: string; reason: string | null; affected: number; notified: number; created_by: string | null };

const localToday = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const br = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;

/** Períodos de falta (de hoje em diante) de um profissional. Sem a tabela, não bloqueia nada. */
export async function absenceRanges(professionalKey: string): Promise<AbsenceRange[]> {
  const { data, error } = await admin().from("professional_absences").select("starts_on,ends_on").eq("professional_key", professionalKey).gte("ends_on", localToday());
  if (error) return [];
  return (data ?? []).map((r) => ({ from: r.starts_on as string, to: r.ends_on as string }));
}

export async function listAbsences(): Promise<{ rows: Absence[]; missingTable: boolean }> {
  const since = new Date(Date.now() - 3 * 3600e3 - 30 * 86400e3).toISOString().slice(0, 10);
  const { data, error } = await admin().from("professional_absences").select("*").gte("ends_on", since).order("starts_on", { ascending: false }).limit(100);
  return { rows: (data ?? []) as Absence[], missingTable: !!error };
}

type RegisterResult = { affected: number; notified: number; failed: string[]; tableMissing: boolean };

/** Registra a falta, desmarca as consultas do período e avisa cada cliente (com convite para reagendar). */
export async function registerAbsence(opts: { professionalKey: string; from: string; to: string; reason?: string | null; by: string; notify: boolean }): Promise<RegisterResult> {
  const { professionalKey, from, to, by } = opts;
  const reason = opts.reason?.trim() || null;
  const p = await findProf(professionalKey);
  const profName = p?.name ?? professionalKey;
  const db = admin();

  const { data: row, error: insErr } = await db.from("professional_absences").insert({ professional_key: professionalKey, starts_on: from, ends_on: to, reason, created_by: by }).select("id").single();
  const tableMissing = !!insErr;

  const { data: appts } = await db
    .from("appointments")
    .select("id,professional,calendar_hint,starts_at,gcal_event_id,lead_id,leads(phone,name,patient_name)")
    .eq("calendar_hint", professionalKey)
    .eq("status", "agendado")
    .gte("starts_at", `${from}T00:00:00-03:00`)
    .lte("starts_at", `${to}T23:59:59-03:00`)
    .order("starts_at");

  let notified = 0;
  const failed: string[] = [];
  for (const a of (appts ?? []) as unknown as { id: string; professional: string; calendar_hint: string; starts_at: string; gcal_event_id: string | null; lead_id: string; leads: { phone: string; name: string | null; patient_name: string | null } | null }[]) {
    await cancelById(a, "remarcado", false); // a vaga fica livre, mas o dia está bloqueado: não oferece à lista de espera
    const lead = a.leads;
    const who = lead?.patient_name ?? lead?.name ?? "Paciente";
    await logEvent(a.lead_id, "professional_absence", { professional: profName, professional_key: professionalKey, starts_at: a.starts_at, reason, by });
    if (!opts.notify || !lead?.phone) { if (opts.notify) failed.push(`${who} (sem telefone)`); continue; }
    const first = (lead.name ?? lead.patient_name ?? "").trim().split(/\s+/)[0];
    const when = new Date(a.starts_at);
    const day = when.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit", timeZone: "America/Fortaleza" });
    const hm = when.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Fortaleza" });
    const text =
      `${first ? `Oi, ${first}!` : "Oi!"} Aqui é a Marcelia da Clinicenter. Infelizmente ${profName} não poderá atender ${day} às ${hm}${reason ? ` (${reason})` : ""}, e por isso sua consulta foi desmarcada. Peço desculpas pelo transtorno! 💙 ` +
      `Posso te passar outros horários para reagendar? É só me responder aqui que eu já te mostro as opções.`;
    try {
      const waId = await sendText(lead.phone, text, 1500);
      await db.from("messages").insert({ lead_id: a.lead_id, role: "ia", content: text, wa_id: waId ?? null, processed: true });
      notified++;
    } catch {
      failed.push(who);
    }
  }
  if (row?.id) await db.from("professional_absences").update({ affected: appts?.length ?? 0, notified }).eq("id", row.id);
  return { affected: appts?.length ?? 0, notified, failed, tableMissing };
}

export async function removeAbsence(id: string) {
  await admin().from("professional_absences").delete().eq("id", id);
}

/** Avisos de falta recentes que o paciente ainda não resolveu (sem nova consulta com o mesmo profissional). Contexto da IA. */
export async function absenceNotices(leadId: string): Promise<{ professional: string; key: string; starts_at: string }[]> {
  const since = new Date(Date.now() - 10 * 86400e3).toISOString();
  const db = admin();
  const { data } = await db.from("lead_events").select("data,created_at").eq("lead_id", leadId).eq("type", "professional_absence").gte("created_at", since).order("created_at", { ascending: false });
  const out: { professional: string; key: string; starts_at: string }[] = [];
  for (const e of data ?? []) {
    const d = e.data as { professional?: string; professional_key?: string; starts_at?: string };
    if (!d.professional_key || !d.starts_at || +new Date(d.starts_at) < Date.now()) continue;
    const { count } = await db.from("appointments").select("id", { count: "exact", head: true }).eq("lead_id", leadId).eq("calendar_hint", d.professional_key).eq("status", "agendado").gte("starts_at", new Date().toISOString());
    if (!count) out.push({ professional: d.professional ?? d.professional_key, key: d.professional_key, starts_at: d.starts_at });
  }
  return out;
}

