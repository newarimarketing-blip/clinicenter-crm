// Fonte única dos fatos da clínica. O agente NUNCA inventa estes dados: eles entram no prompt
// a partir daqui, e o motor de aprendizado só altera o "script" (tom/fluxo), nunca preços ou grades.
// Valores copiados do prompt original — confirmar com a clínica.

export type TimeWindow = [string, string]; // ["15:00","17:00"]

export type Professional = {
  key: string; // calendar_hint
  name: string;
  specialty: string;
  slotMin: number;
  /** dia da semana (0=domingo) -> janelas */
  schedule: Record<number, TimeWindow[]>;
  calEnv?: string; // nome da env com o ID do Google Calendar (profissionais antigos)
  calendarId?: string; // ID do Google Calendar guardado no banco (profissionais cadastrados no CRM)
  particularOnly?: boolean;
  /** orientações de atendimento (o que a Marcelia deve saber/dizer sobre este profissional) */
  guidance?: string;
};

export const PROFESSIONALS: Professional[] = [
  { key: "priscilla", name: "Dra. Priscilla Grangeiro", specialty: "pediatria", slotMin: 30, schedule: { 1: [["15:00", "17:00"]] }, calEnv: "CAL_PRISCILLA" },
  { key: "maraysa", name: "Dra. Maraysa Lima", specialty: "psiquiatria", slotMin: 30, schedule: { 1: [["14:00", "17:00"]] }, calEnv: "CAL_MARAYSA" },
  { key: "fernanda", name: "Dra. Fernanda Sampaio", specialty: "psiquiatria", slotMin: 45, schedule: { 6: [["08:00", "12:00"]] }, calEnv: "CAL_FERNANDA" },
  {
    key: "gledson", name: "Dr. Gledson", specialty: "fisioterapia", slotMin: 60, particularOnly: true, calEnv: "CAL_GLEDSON",
    schedule: { 1: [["16:00", "18:00"]], 3: [["14:00", "17:00"]], 5: [["14:00", "17:00"]] },
  },
];

export const CLINIC = {
  name: "Clinicenter",
  address: "R. Divino Salvador, 187 - Centro, Barbalha - CE",
  phone: "88 99660-8355",
  instagram: "https://www.instagram.com/clinicentercariri/",
  tz: "America/Fortaleza",
  /** horas de pausa da IA quando um humano responde pelo celular da clínica */
  humanPauseHours: 12,
  /** gatilho para devolver a conversa à IA (mensagem enviada pela equipe) */
  resumeKeyword: "atendimento finalizado",
};

export const PRICES = [
  "Fisioterapia (Dr. Gledson): R$ 95,00 (convencional) | R$ 150,00 (osteopatia/RPG) — somente particular",
  "Pediatria: R$ 220,00",
  "Psiquiatria: R$ 320,00 (Unimed: R$ 150,00 mediante carteirinha)",
];

/** Especialidades cobertas por convênio, usadas para redirecionar sem perder o paciente */
export const INSURANCE: Record<string, string[]> = {
  Unimed: ["Fisioterapia", "Nutrição", "Psicologia", "T.O."],
  "São Camilo": ["Psiquiatria", "Pediatria", "Nutrição", "Fisio Infantil", "Psico Infantil", "T.O."],
  Cassi: ["Psiquiatria", "Pediatria", "Fisioterapia", "Nutrição", "Psicologia", "T.O."],
  "Postal Saúde": ["Pediatria", "Fisioterapia", "Psicologia", "T.O.", "Nutrição"],
  Camed: ["Pediatria", "Psicologia", "Fisioterapia", "T.O.", "Nutrição"],
  Medplan: ["Pediatria", "Psicologia", "Nutrição", "Fisioterapia", "T.O."],
};

export const SPECIALTIES = ["pediatria", "psiquiatria", "fisioterapia", "outra"] as const;
export const BASE_SPECIALTIES = ["pediatria", "psiquiatria", "fisioterapia"];
export const STAGES = ["novo", "qualificado", "horario_oferecido", "agendado", "compareceu", "perdido"] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABEL: Record<Stage, string> = {
  novo: "Novo",
  qualificado: "Qualificado",
  horario_oferecido: "Horário oferecido",
  agendado: "Agendado",
  compareceu: "Compareceu",
  perdido: "Perdido",
};

export const profByKey = (k: string) => PROFESSIONALS.find((p) => p.key === k);

const DOW = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

export type FactsSource = { professionals: Professional[]; prices: string[]; insurance: Record<string, string[]> };

/** `src` vem de getClinicSettings() (editável no CRM); sem ele, usa os padrões deste arquivo. */
export function factsBlock(todayLabel: string, src: FactsSource = { professionals: PROFESSIONALS, prices: PRICES, insurance: INSURANCE }): string {
  const grades = src.professionals.map((p) => {
    const days = Object.entries(p.schedule)
      .map(([d, w]) => `${DOW[+d]} ${w.map(([a, b]) => `${a}–${b}`).join(", ")}`)
      .join(" | ");
    return `- ${p.name} (${p.specialty}, calendar_hint="${p.key}"): ${days}; consultas de ${p.slotMin} em ${p.slotMin} min${p.particularOnly ? "; atende SOMENTE particular" : ""}`;
  }).join("\n");
  const ins = Object.entries(src.insurance).map(([k, v]) => `- ${k}: ${v.join(", ")}`).join("\n");
  return `# FATOS DA CLÍNICA (fonte de verdade — nunca contradiga)
Hoje: ${todayLabel} (fuso de Fortaleza). Use sempre este ano e dia da semana.
Endereço: ${CLINIC.address}
Telefone/WhatsApp geral: ${CLINIC.phone} (envie só se o paciente pedir ou para o fluxo de convênio do Dr. Gledson)

## Profissionais e grades
${grades}

## Valores
${src.prices.map((p) => `- ${p}`).join("\n")}

## Especialidades por convênio (para redirecionar)
${ins}`;
}
