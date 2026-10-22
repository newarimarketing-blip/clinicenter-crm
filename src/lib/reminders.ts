import { admin } from "./supabase-admin";
import { sendText, typingDelay } from "./evolution";
import { CLINIC } from "./clinic-config";
import { logEvent } from "./leads";

const OFFSET_MS = 3 * 3600e3; // Fortaleza = UTC-3
const MIN_LEAD_MS = 3 * 3600e3; // não lembra consulta que começa em menos de 3 h
const DOW = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const pad = (n: number) => String(n).padStart(2, "0");

/** Data/hora no relógio de Fortaleza a partir de um instante. */
function local(iso: string | number) {
  const d = new Date(+new Date(iso) - OFFSET_MS);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), dow: d.getUTCDay(), h: d.getUTCHours(), min: d.getUTCMinutes() };
}
const dayNumber = (l: { y: number; m: number; d: number }) => Math.floor(Date.UTC(l.y, l.m, l.d) / 86400e3);

export const hourLabel = (h: number, min: number) => (min === 0 ? `${h}h` : `${h}h${pad(min)}`);

/** "amanhã", "hoje" ou "segunda-feira (27/10)" em relação a `now`. */
export function dayWord(startsAt: string, now = Date.now()): string {
  const s = local(startsAt);
  const diff = dayNumber(s) - dayNumber(local(now));
  if (diff === 0) return "hoje";
  if (diff === 1) return "amanhã";
  return `${DOW[s.dow]} (${pad(s.d)}/${pad(s.m + 1)})`;
}

export function reminderText(opts: { firstName: string | null; professional: string; startsAt: string; now?: number }): string {
  const s = local(opts.startsAt);
  const hi = opts.firstName ? `Oi, ${opts.firstName}! ` : "Oi! ";
  return (
    `${hi}Aqui é a Marcelia, da ${CLINIC.name}.\n` +
    `Passando para lembrar que sua consulta com ${opts.professional} é ${dayWord(opts.startsAt, opts.now)}, às ${hourLabel(s.h, s.min)}, na ${CLINIC.address}.\n` +
    `Você confirma sua presença? Se não puder ir, é só me avisar que eu procuro um novo horário para você.`
  );
}

type Row = {
  id: string;
  lead_id: string;
  professional: string;
  starts_at: string;
  leads: { phone: string; name: string | null; patient_name: string | null } | null;
};

/** Envia o lembrete das consultas que acontecem até o fim de amanhã (relógio de Fortaleza) e ainda não foram lembradas. */
export async function sendAppointmentReminders(now = Date.now()): Promise<{ checked: number; sent: number; failed: number }> {
  const db = admin();
  const l = local(now);
  const tomorrowEnd = Date.UTC(l.y, l.m, l.d + 2, 0, 0) + OFFSET_MS; // fim do dia de amanhã
  const { data, error } = await db
    .from("appointments")
    .select("id, lead_id, professional, starts_at, leads(phone, name, patient_name)")
    .eq("status", "agendado")
    .is("reminder_sent_at", null)
    .gte("starts_at", new Date(now + MIN_LEAD_MS).toISOString())
    .lt("starts_at", new Date(tomorrowEnd).toISOString())
    .order("starts_at")
    .limit(100);
  if (error) throw new Error(`lembretes: ${error.message}`); // ex.: migração 002 ainda não aplicada
  const rows = (data ?? []) as unknown as Row[];
  let sent = 0;
  let failed = 0;
  for (const a of rows) {
    if (!a.leads?.phone) continue;
    // claim atômico: só quem conseguir marcar reminder_sent_at envia (evita duplicidade se o cron rodar duas vezes)
    const { data: claimed } = await db.from("appointments").update({ reminder_sent_at: new Date().toISOString() }).eq("id", a.id).is("reminder_sent_at", null).select("id");
    if (!claimed?.length) continue;
    const first = (a.leads.patient_name ?? a.leads.name ?? "").trim().split(/\s+/)[0] || null;
    const text = reminderText({ firstName: first, professional: a.professional, startsAt: a.starts_at, now });
    try {
      const waId = await sendText(a.leads.phone, text, typingDelay(text));
      await db.from("messages").insert({ lead_id: a.lead_id, role: "ia", content: text, wa_id: waId ?? null, processed: true });
      await logEvent(a.lead_id, "reminder_sent", { appointment_id: a.id, starts_at: a.starts_at });
      sent++;
    } catch (e) {
      await db.from("appointments").update({ reminder_sent_at: null }).eq("id", a.id); // tenta de novo na próxima execução
      await logEvent(a.lead_id, "reminder_error", { appointment_id: a.id, error: String(e).slice(0, 300) });
      failed++;
    }
  }
  return { checked: rows.length, sent, failed };
}
