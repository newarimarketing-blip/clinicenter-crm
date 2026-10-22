import { z } from "zod";
import { admin } from "./supabase-admin";
import { BASE_SPECIALTIES, INSURANCE, PRICES, PROFESSIONALS, type Professional, type TimeWindow } from "./clinic-config";

export type Service = {
  id: string;
  name: string;
  specialty: string | null;
  professional_key: string | null;
  price: string;
  note: string | null;
  particular_only: boolean;
  active: boolean;
  sort: number;
};
export type ProfessionalRow = Professional & { active: boolean };

/**
 * Preços, grades e convênios EDITÁVEIS (tabela clinic_settings). Os valores de clinic-config.ts
 * são o fallback: sem linha no banco, sem a tabela ou com JSON inválido, o sistema usa os padrões.
 * Chave, especialidade e agenda do Google de cada profissional continuam vindo do código.
 */
export type ClinicSettings = {
  professionals: Professional[];
  prices: string[];
  insurance: Record<string, string[]>;
  /** quais seções estão personalizadas no banco */
  custom: { professionals: boolean; prices: boolean; insurance: boolean };
  /** false = tabela ainda não criada (migração 004 pendente) ou sem acesso ao banco */
  ready: boolean;
  /** migração 006: profissionais e serviços cadastrados no banco */
  tables: { professionals: boolean; services: boolean };
  /** todos os profissionais, inclusive inativos (tela de Configurações e Agenda) */
  professionalsAll: ProfessionalRow[];
  services: Service[];
  /** especialidades conhecidas (profissionais + serviços + padrão) */
  specialties: string[];
};

export const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const windowSchema = z.tuple([z.string().regex(HM), z.string().regex(HM)]).refine(([a, b]) => a < b, "início deve ser antes do fim");
export const professionalsSchema = z.array(
  z.object({
    key: z.string(),
    name: z.string().min(2).max(80),
    slotMin: z.number().int().min(10).max(180),
    particularOnly: z.boolean().optional(),
    schedule: z.record(z.string().regex(/^[0-6]$/), z.array(windowSchema).max(4)),
  }),
);
export const pricesSchema = z.array(z.string().min(2).max(240)).min(1).max(30);
export const insuranceSchema = z.record(z.string().min(1).max(60), z.array(z.string().min(1).max(60)).max(20));

export const defaults = (): ClinicSettings => ({
  professionals: PROFESSIONALS,
  prices: PRICES,
  insurance: INSURANCE,
  custom: { professionals: false, prices: false, insurance: false },
  ready: false,
  tables: { professionals: false, services: false },
  professionalsAll: PROFESSIONALS.map((p) => ({ ...p, active: true })),
  services: [],
  specialties: [...BASE_SPECIALTIES],
});

const scheduleSchema = z.record(z.string().regex(/^[0-6]$/), z.array(windowSchema).max(4));

export function serviceLine(s: Service, profs: Professional[]): string {
  const who = s.professional_key ? profs.find((p) => p.key === s.professional_key)?.name : null;
  const extras = [s.note, s.particular_only && !/particular/i.test(s.note ?? "") ? "somente particular" : null].filter(Boolean).join("; ");
  return `${s.name}${who ? ` (${who})` : ""}: ${s.price}${extras ? ` — ${extras}` : ""}`;
}

export const slugKey = (name: string) =>
  name
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/\b(dr|dra|doutor|doutora)\b\.?/g, " ")
    .replace(/[^a-z0-9]+/g, " ").trim().split(" ")[0] || "prof";

export function mergeProfessionals(stored: z.infer<typeof professionalsSchema>): Professional[] {
  return PROFESSIONALS.map((base) => {
    const o = stored.find((s) => s.key === base.key);
    if (!o) return base;
    const schedule: Record<number, TimeWindow[]> = {};
    for (const [d, w] of Object.entries(o.schedule)) if (w.length) schedule[+d] = w as TimeWindow[];
    return { ...base, name: o.name, slotMin: o.slotMin, particularOnly: o.particularOnly ?? base.particularOnly, schedule };
  });
}

let cache: { at: number; value: ClinicSettings } | null = null;
const TTL_MS = 30_000;
export const invalidateClinicSettings = () => (cache = null);

type ProfDbRow = { key: string; name: string; specialty: string; slot_min: number; particular_only: boolean; schedule: unknown; calendar_id: string | null; active: boolean };

function rowToProfessional(r: ProfDbRow): ProfessionalRow | null {
  const sch = scheduleSchema.safeParse(r.schedule ?? {});
  if (!sch.success) return null;
  const base = PROFESSIONALS.find((b) => b.key === r.key);
  const schedule: Record<number, TimeWindow[]> = {};
  for (const [d, w] of Object.entries(sch.data)) if (w.length) schedule[+d] = w as TimeWindow[];
  return {
    key: r.key,
    name: r.name,
    specialty: r.specialty,
    slotMin: r.slot_min,
    particularOnly: r.particular_only,
    schedule,
    calendarId: r.calendar_id ?? undefined,
    calEnv: base?.calEnv,
    active: r.active,
  };
}

export async function getClinicSettings(): Promise<ClinicSettings> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const out = defaults();
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const db = admin();
      const [cs, pr, sv] = await Promise.all([
        db.from("clinic_settings").select("key, value"),
        db.from("professionals").select("*").order("created_at"),
        db.from("services").select("*").order("sort").order("created_at"),
      ]);
      if (!cs.error) {
        out.ready = true;
        for (const row of cs.data ?? []) {
          if (row.key === "insurance") {
            const p = insuranceSchema.safeParse(row.value);
            if (p.success) { out.insurance = p.data; out.custom.insurance = true; }
          } else if (row.key === "prices") {
            const p = pricesSchema.safeParse(row.value);
            if (p.success) { out.prices = p.data; out.custom.prices = true; }
          } else if (row.key === "professionals") {
            const p = professionalsSchema.safeParse(row.value);
            if (p.success) { out.professionals = mergeProfessionals(p.data); out.custom.professionals = true; }
          }
        }
      }
      if (!pr.error && (pr.data?.length ?? 0) > 0) {
        out.tables.professionals = true;
        const all = (pr.data as ProfDbRow[]).map(rowToProfessional).filter((x): x is ProfessionalRow => !!x);
        out.professionalsAll = all;
        out.professionals = all.filter((p) => p.active);
        out.custom.professionals = true;
      } else {
        out.professionalsAll = out.professionals.map((p) => ({ ...p, active: true }));
      }
      if (!sv.error) {
        out.tables.services = true;
        out.services = (sv.data ?? []) as Service[];
        const act = out.services.filter((x) => x.active);
        if (act.length) { out.prices = act.map((x) => serviceLine(x, out.professionals)); out.custom.prices = true; }
      }
    } catch {
      /* fallback aos padrões */
    }
  }
  if (!out.professionalsAll.length) out.professionalsAll = out.professionals.map((p) => ({ ...p, active: true }));
  const set = new Set<string>(BASE_SPECIALTIES);
  for (const p of out.professionalsAll) set.add(p.specialty.toLowerCase());
  for (const x of out.services) if (x.specialty) set.add(x.specialty.toLowerCase());
  out.specialties = [...set];
  cache = { at: Date.now(), value: out };
  return out;
}

/* ---------- conversão entre texto de formulário e dados ---------- */

export const DOW_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export function scheduleToText(windows: TimeWindow[] | undefined): string {
  return (windows ?? []).map(([a, b]) => `${a}-${b}`).join(", ");
}

/** "15:00-17:00, 18:00-19:00" -> janelas. Retorna erro em português se algo estiver fora do padrão. */
export function parseWindows(text: string): { ok: true; value: TimeWindow[] } | { ok: false; error: string } {
  const t = text.trim();
  if (!t) return { ok: true, value: [] };
  const out: TimeWindow[] = [];
  for (const part of t.split(/[,;]+/)) {
    const m = part.trim().match(/^(\d{1,2})(?::|h)?(\d{2})?\s*(?:-|–|às|a)\s*(\d{1,2})(?::|h)?(\d{2})?$/i);
    if (!m) return { ok: false, error: `"${part.trim()}" não segue o formato 15:00-17:00` };
    const f = (h: string, mm?: string) => `${h.padStart(2, "0")}:${mm ?? "00"}`;
    const w: TimeWindow = [f(m[1], m[2]), f(m[3], m[4])];
    if (!HM.test(w[0]) || !HM.test(w[1])) return { ok: false, error: `horário inválido em "${part.trim()}"` };
    if (w[0] >= w[1]) return { ok: false, error: `em "${part.trim()}" o início deve ser antes do fim` };
    out.push(w);
  }
  return { ok: true, value: out };
}

export const pricesToText = (p: string[]) => p.join("\n");
export const insuranceToText = (i: Record<string, string[]>) => Object.entries(i).map(([k, v]) => `${k}: ${v.join(", ")}`).join("\n");

export function parseInsurance(text: string): { ok: true; value: Record<string, string[]> } | { ok: false; error: string } {
  const out: Record<string, string[]> = {};
  for (const line of text.split("\n").map((l) => l.trim()).filter(Boolean)) {
    const i = line.indexOf(":");
    if (i < 1) return { ok: false, error: `a linha "${line}" precisa ser "Convênio: Especialidade, Especialidade"` };
    out[line.slice(0, i).trim()] = line.slice(i + 1).split(",").map((s) => s.trim()).filter(Boolean);
  }
  const r = insuranceSchema.safeParse(out);
  return r.success ? { ok: true, value: r.data } : { ok: false, error: "convênios inválidos (nomes até 60 caracteres)" };
}
