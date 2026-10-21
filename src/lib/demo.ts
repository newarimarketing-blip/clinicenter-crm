// Dados fictícios só para visualizar o CRM sem Supabase configurado.
import type { Appointment, Insight, Lead, Message, ScriptVersion } from "./types";
import type { Stage } from "./clinic-config";
import { DEFAULT_SCRIPT } from "./default-script";

const ago = (min: number) => new Date(Date.now() - min * 60000).toISOString();
let n = 0;
function lead(name: string, specialty: string | null, stage: Stage, min: number, o: Partial<Lead> = {}): Lead {
  n++;
  return {
    id: `demo-${n}`, created_at: ago(min + 600), updated_at: ago(min), phone: `55889${String(90000000 + n * 1337).slice(0, 8)}`,
    name, patient_name: null, email: null, specialty, insurance: null, stage, score: null, intent: null, lost_reason: null,
    source: "instagram", ai_paused_until: null, last_message_at: ago(min), last_inbound_at: ago(min), ...o,
  };
}

export const DEMO_LEADS: Lead[] = [
  lead("Mariana Alves", "pediatria", "horario_oferecido", 4, { insurance: "particular", score: 78, intent: "Consulta para filho de 4 anos com febres recorrentes", patient_name: "Davi" }),
  lead("Carlos Eduardo", "fisioterapia", "qualificado", 22, { insurance: "particular", score: 62, intent: "Dor lombar há 3 semanas" }),
  lead("Juliana Rocha", "psiquiatria", "agendado", 95, { insurance: "Unimed", score: 100, intent: "Primeira consulta", patient_name: "Juliana Rocha" }),
  lead("Pedro Henrique", "psiquiatria", "novo", 8, { score: 30 }),
  lead("Fernanda Lima", "pediatria", "agendado", 300, { insurance: "São Camilo", score: 100 }),
  lead("Rafael Souza", "fisioterapia", "perdido", 2200, { insurance: "Unimed", lost_reason: "convênio", score: 20 }),
  lead("Ana Beatriz", "pediatria", "qualificado", 140, { insurance: "Cassi", score: 55 }),
  lead("Lucas Martins", null, "novo", 35),
  lead("Camila Torres", "psiquiatria", "horario_oferecido", 600, { insurance: "particular", score: 70 }),
  lead("José Almeida", "fisioterapia", "compareceu", 4300, { insurance: "particular", score: 100 }),
  lead("Patrícia Gomes", "pediatria", "perdido", 3100, { lost_reason: "preço", score: 25 }),
  lead("Thiago Nunes", "psiquiatria", "qualificado", 1500, { insurance: "particular", score: 48, ai_paused_until: new Date(Date.now() + 3 * 3600e3).toISOString() }),
  lead("Larissa Pinto", "fisioterapia", "agendado", 800, { insurance: "particular", score: 100 }),
  lead("Bruno Carvalho", "pediatria", "novo", 12),
  lead("Isabela Freitas", "psiquiatria", "perdido", 5000, { lost_reason: "sem resposta", score: 35 }),
  lead("Marcos Vinícius", "fisioterapia", "horario_oferecido", 55, { insurance: "particular", score: 66 }),
];

const m = (lead_id: string, role: Message["role"], content: string, min: number): Message => ({
  id: `m-${lead_id}-${min}-${role}`, created_at: ago(min), lead_id, role, content, media_type: null, wa_id: null, processed: true, script_version_id: null,
});

export const DEMO_MESSAGES: Message[] = [
  m("demo-1", "lead", "Oi, boa tarde! Meu filho tá com febre toda semana, queria uma consulta com pediatra", 14),
  m("demo-1", "ia", "Olá, Mariana! Que bom ter você aqui na Clinicenter. Sou a Marcelia. Entendo a preocupação, vamos resolver isso. Quantos anos tem seu filho e você pretende usar plano de saúde ou consulta particular?", 13),
  m("demo-1", "lead", "Ele tem 4 anos. Particular mesmo", 10),
  m("demo-1", "ia", "Perfeito! A Dra. Priscilla atende às segundas-feiras. Tenho estes horários:\n• Segunda, 27/10 às 15:00\n• Segunda, 27/10 às 15:30\n• Segunda, 03/11 às 15:00\n\nQual funciona melhor para você?", 9),
  m("demo-1", "lead", "Qual o valor da consulta?", 4),
  m("demo-2", "lead", "Vocês fazem fisioterapia pra dor na lombar?", 30),
  m("demo-2", "ia", "Fazemos sim, com o Dr. Gledson, referência em reabilitação e alívio de dores. Ele atende somente particular: R$ 95,00 a sessão convencional. Posso ver os melhores dias para você?", 29),
  m("demo-2", "lead", "Pode ser. Tem quarta de tarde?", 22),
  m("demo-3", "lead", "Quero marcar psiquiatra, tenho Unimed", 130),
  m("demo-3", "ia", "Claro! Com a Unimed, a consulta de psiquiatria tem valor especial de R$ 150,00 mediante carteirinha. A Dra. Maraysa atende segundas à tarde. Quer ver os horários?", 128),
  m("demo-3", "lead", "Quero sim", 120),
  m("demo-3", "ia", "Consulta confirmada com a Dra. Maraysa, segunda às 15:00. Endereço: R. Divino Salvador, 187 - Centro, Barbalha. Até lá!", 95),
];

export const DEMO_APPOINTMENTS: Appointment[] = [];

export const DEMO_SCRIPTS: ScriptVersion[] = [
  { id: "sv-3", created_at: ago(1440), version: 3, status: "proposta", prompt: DEFAULT_SCRIPT,
    rationale: "Pacientes que receberam o valor junto com os horários agendaram mais. Quem recebeu só a lista de especialidades no começo abandonou mais.",
    changes: [
      "Quando o paciente já disser a especialidade na 1ª mensagem, pular a lista de áreas e perguntar logo o convênio.",
      "Em Pediatria, mencionar o valor particular junto das 3 opções de horário, em vez de esperar o paciente perguntar.",
      "Na objeção de preço, oferecer primeiro as opções de convênio cobertas antes de insistir no particular.",
    ], approved_at: null },
  { id: "sv-2", created_at: ago(20000), version: 2, status: "ativa", prompt: DEFAULT_SCRIPT, rationale: null, changes: [], approved_at: ago(20000) },
  { id: "sv-1", created_at: ago(40000), version: 1, status: "arquivada", prompt: DEFAULT_SCRIPT, rationale: null, changes: [], approved_at: ago(40000) },
];

export const DEMO_INSIGHTS: Insight[] = [
  { id: "in-1", created_at: ago(1440), period_start: ago(1440 + 10080), period_end: ago(1440), metrics: { total: 52, conversao: 0.31 },
    findings: [
      { type: "funcionou", pattern: "Oferecer 3 horários de uma vez logo após saber o convênio", evidence: "11 de 16 conversas que agendaram" },
      { type: "perdeu", pattern: "Perguntar o convênio antes de acolher a queixa", evidence: "7 de 12 conversas paradas em até 2 mensagens" },
      { type: "perdeu", pattern: "Fisioterapia: paciente com plano sai quando ouve 'só particular'", evidence: "5 leads, motivo: convênio" },
    ] },
];
