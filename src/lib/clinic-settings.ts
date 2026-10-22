import { z } from "zod";
import { admin } from "./supabase-admin";
import { INSURANCE, PRICES, PROFESSIONALS, type Professional, type TimeWindow } from "./clinic-config";

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
});

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

export async function getClinicSettings(): Promise<ClinicSettings> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const out = defaults();
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const { data, error } = await admin().from("clinic_settings").select("key, value");
      if (!error) {
        out.ready = true;
        for (const row of data ?? []) {
          if (row.key === "prices") {
            const p = pricesSchema.safeParse(row.value);
            if (p.success) { out.prices = p.data; out.custom.prices = true; }
          } else if (row.key === "insurance") {
            const p = insuranceSchema.safeParse(row.value);
            if (p.success) { out.insurance = p.data; out.custom.insurance = true; }
          } else if (row.key === "professionals") {
            const p = professionalsSchema.safeParse(row.value);
            if (p.success) { out.professionals = mergeProfessionals(p.data); out.custom.professionals = true; }
          }
        }
      }
    } catch {
      /* fallback aos padrões */
    }
  }
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
