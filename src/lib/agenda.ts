import { google } from "googleapis";
import { CLINIC, PROFESSIONALS, profByKey, type Professional } from "./clinic-config";
import { admin } from "./supabase-admin";

export type Slot = { startTime: string; endTime: string; label: string };

const DOW = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const OFFSET_MS = 3 * 3600e3; // Fortaleza = UTC-3 (sem horário de verão)
const MIN_LEAD_MS = 2 * 3600e3; // não oferecer horário com menos de 2 h de antecedência
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const pad = (n: number) => String(n).padStart(2, "0");

function addMin(hm: string, min: number) {
  const [h, m] = hm.split(":").map(Number);
  const t = h * 60 + m + min;
  return `${pad(Math.floor(t / 60))}:${pad(t % 60)}`;
}

function calendarClient() {
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_B64;
  if (!b64) return null;
  const credentials = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  const auth = new google.auth.GoogleAuth({ credentials, scopes: ["https://www.googleapis.com/auth/calendar"] });
  return google.calendar({ version: "v3", auth });
}

const calendarId = (p: Professional) => process.env[p.calEnv];

type Interval = { start: number; end: number };

async function busyIntervals(p: Professional, from: Date, to: Date): Promise<Interval[]> {
  const busy: Interval[] = [];
  // 1) agendamentos já feitos pelo sistema
  const { data } = await admin()
    .from("appointments")
    .select("starts_at, ends_at")
    .eq("calendar_hint", p.key)
    .eq("status", "agendado")
    .gte("starts_at", from.toISOString())
    .lte("starts_at", to.toISOString());
  for (const a of data ?? []) busy.push({ start: +new Date(a.starts_at), end: +new Date(a.ends_at) });
  // 2) agenda real do Google (compromissos criados à mão pela equipe)
  const cal = calendarClient();
  const id = calendarId(p);
  if (cal && id) {
    const r = await cal.freebusy.query({ requestBody: { timeMin: from.toISOString(), timeMax: to.toISOString(), items: [{ id }] } });
    for (const b of r.data.calendars?.[id]?.busy ?? []) {
      if (b.start && b.end) busy.push({ start: +new Date(b.start), end: +new Date(b.end) });
    }
  }
  return busy;
}

export type SlotQuery = { janelaDias?: number; periodo?: "manha" | "tarde"; dia_semana?: string; date?: string };

export async function freeSlots(p: Professional, q: SlotQuery = {}, limit = 6): Promise<Slot[]> {
  const days = q.date ? 62 : Math.min(q.janelaDias ?? 14, 60);
  const shifted = new Date(Date.now() - OFFSET_MS); // usar getters UTC = relógio de Fortaleza
  const now = Date.now();
  const candidates: (Slot & { s: number; e: number })[] = [];

  for (let i = 0; i <= days; i++) {
    const d = new Date(shifted.getTime() + i * 86400e3);
    const dow = d.getUTCDay();
    if (q.dia_semana && norm(DOW[dow]) !== norm(q.dia_semana)) continue;
    const ymd = d.toISOString().slice(0, 10);
    if (q.date && q.date !== ymd) continue;
    for (const [ws, we] of p.schedule[dow] ?? []) {
      for (let t = ws; addMin(t, p.slotMin) <= we; t = addMin(t, p.slotMin)) {
        const hour = Number(t.slice(0, 2));
        if (q.periodo === "manha" && hour >= 12) continue;
        if (q.periodo === "tarde" && hour < 12) continue;
        const s = +new Date(`${ymd}T${t}:00-03:00`);
        if (s < now + MIN_LEAD_MS) continue;
        const e = s + p.slotMin * 60e3;
        candidates.push({
          s, e,
          startTime: `${ymd}T${t}:00-03:00`,
          endTime: `${ymd}T${addMin(t, p.slotMin)}:00-03:00`,
          label: `${DOW[dow][0].toUpperCase()}${DOW[dow].slice(1)}, ${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)} às ${t}`,
        });
      }
    }
  }
  if (!candidates.length) return [];
  const busy = await busyIntervals(p, new Date(candidates[0].s), new Date(candidates[candidates.length - 1].e));
  const free = candidates.filter((c) => !busy.some((b) => c.s < b.end && c.e > b.start));
  const picked = spreadAcrossDays(free, limit);
  return picked.map(({ startTime, endTime, label }) => ({ startTime, endTime, label }));
}

/** No máximo 2 horários por dia (os mais cedo), para o paciente ter dias diferentes para escolher. */
function spreadAcrossDays<T extends { startTime: string }>(slots: T[], limit: number, perDay = 2): T[] {
  if (limit > 50) return slots.slice(0, limit); // uso interno (validação): sem espalhar
  const count: Record<string, number> = {};
  const out: T[] = [];
  for (const s of slots) {
    const day = s.startTime.slice(0, 10);
    if ((count[day] ?? 0) >= perDay) continue;
    count[day] = (count[day] ?? 0) + 1;
    out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}

/** Confere se um horário escolhido ainda está livre (impede o modelo de inventar horário). */
export async function resolveSlot(p: Professional, startTime: string): Promise<Slot | null> {
  const slots = await freeSlots(p, { date: startTime.slice(0, 10) }, 1000);
  return slots.find((s) => +new Date(s.startTime) === +new Date(startTime)) ?? null;
}

export async function createAppointment(opts: { leadId: string; patient: string; phone: string; p: Professional; slot: Slot }) {
  const { leadId, patient, phone, p, slot } = opts;
  let gcal_event_id: string | null = null;
  const cal = calendarClient();
  const id = calendarId(p);
  if (cal && id) {
    const ev = await cal.events.insert({
      calendarId: id,
      requestBody: {
        summary: patient, // mesma convenção da agenda atual: título = nome do paciente
        description: `Whatsapp: https://wa.me/${phone}\nAgendado pela Marcelia (IA)`,
        start: { dateTime: slot.startTime, timeZone: CLINIC.tz },
        end: { dateTime: slot.endTime, timeZone: CLINIC.tz },
      },
    });
    gcal_event_id = ev.data.id ?? null;
  }
  const { data, error } = await admin()
    .from("appointments")
    .insert({ lead_id: leadId, professional: p.name, calendar_hint: p.key, specialty: p.specialty, starts_at: slot.startTime, ends_at: slot.endTime, gcal_event_id })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Cancela o próximo agendamento ativo do lead (opcionalmente filtrado por profissional). */
export async function cancelLatest(leadId: string, calendarHint?: string) {
  let q = admin().from("appointments").select("*").eq("lead_id", leadId).eq("status", "agendado").order("starts_at", { ascending: false }).limit(1);
  if (calendarHint) q = q.eq("calendar_hint", calendarHint);
  const { data } = await q;
  const appt = data?.[0];
  if (!appt) return cancelFromGoogle(leadId, calendarHint);
  return cancelById(appt);
}

type Appt = { id: string; professional: string; calendar_hint: string; starts_at: string; gcal_event_id: string | null };

export async function cancelById(appt: Appt) {
  const cal = calendarClient();
  const p = profByKey(appt.calendar_hint);
  const id = p ? calendarId(p) : undefined;
  if (cal && id && appt.gcal_event_id) await cal.events.delete({ calendarId: id, eventId: appt.gcal_event_id }).catch(() => {});
  await admin().from("appointments").update({ status: "cancelado" }).eq("id", appt.id);
  return appt;
}

/** Eventos criados direto no Google Calendar pela equipe: localiza pelo link do WhatsApp na descrição. */
async function cancelFromGoogle(leadId: string, calendarHint?: string) {
  const cal = calendarClient();
  if (!cal) return null;
  const { data: lead } = await admin().from("leads").select("phone").eq("id", leadId).single();
  if (!lead) return null;
  const targets = calendarHint ? [profByKey(calendarHint)].filter(Boolean) as Professional[] : PROFESSIONALS;
  for (const p of targets) {
    const id = calendarId(p);
    if (!id) continue;
    const r = await cal.events.list({ calendarId: id, q: lead.phone, timeMin: new Date().toISOString(), singleEvents: true, orderBy: "startTime", maxResults: 1 });
    const ev = r.data.items?.[0];
    if (ev?.id && ev.start?.dateTime) {
      await cal.events.delete({ calendarId: id, eventId: ev.id });
      return { id: ev.id, professional: p.name, calendar_hint: p.key, starts_at: ev.start.dateTime, gcal_event_id: ev.id };
    }
  }
  return null;
}

/** Próxima consulta ativa do lead com o profissional (para impedir marcação duplicada). */
export async function activeAppointment(leadId: string, calendarHint: string) {
  const { data } = await admin().from("appointments").select("*").eq("lead_id", leadId).eq("calendar_hint", calendarHint).eq("status", "agendado").gte("starts_at", new Date().toISOString()).order("starts_at").limit(1);
  return (data?.[0] ?? null) as Appt | null;
}

export const allProfessionalKeys = PROFESSIONALS.map((p) => p.key);
