import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import { z } from "zod";
import { admin } from "./supabase-admin";
import { openai } from "./openai";
import { sendText, typingDelay } from "./evolution";
import { splitMessage } from "./split";
import { DEFAULT_SCRIPT } from "./default-script";
import { CLINIC, factsBlock, PROFESSIONALS, SPECIALTIES, STAGES } from "./clinic-config";
import { activeAppointment, cancelById, cancelLatest, confirmAppointment, createAppointment, freeSlots, resolveSlot, upcomingAppointments } from "./agenda";
import { getClinicSettings, type ClinicSettings } from "./clinic-settings";
import { advanceStage, logEvent, updateLead } from "./leads";
import { fmtDateTime, todayLabel } from "./time";
import type { Lead, Message } from "./types";

const HISTORY_LIMIT = 40;
const MAX_STEPS = 6;
const keys = PROFESSIONALS.map((p) => p.key) as [string, ...string[]];

const tools: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "consultar_horarios",
      description: "Consulta a agenda REAL do profissional. Chame sempre antes de citar qualquer data ou horário. Devolve startTime/endTime/label; apresente até 3 opções exatamente como vierem.",
      parameters: {
        type: "object",
        properties: {
          calendar_hint: { type: "string", enum: keys },
          periodo: { type: "string", enum: ["manha", "tarde"], description: "Só se o paciente indicar preferência" },
          dia_semana: { type: "string", enum: ["segunda", "terca", "quarta", "quinta", "sexta", "sabado"], description: "Só se o paciente indicar o dia" },
          janela_dias: { type: "integer", description: "Padrão 14. Use 30 quando o paciente recusar as opções." },
        },
        required: ["calendar_hint"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "agendar_consulta",
      description: "Cria o agendamento. Só depois de o paciente escolher o horário e informar o nome do paciente. startTime deve ser exatamente um startTime devolvido por consultar_horarios.",
      parameters: {
        type: "object",
        properties: {
          calendar_hint: { type: "string", enum: keys },
          startTime: { type: "string" },
          nome_paciente: { type: "string" },
          email: { type: "string" },
        },
        required: ["calendar_hint", "startTime", "nome_paciente"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cancelar_consulta",
      description: "Cancela a consulta ativa do paciente. Só com confirmação clara.",
      parameters: { type: "object", properties: { calendar_hint: { type: "string", enum: keys } }, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "reagendar_consulta",
      description: "Move a consulta ativa para um novo horário já escolhido (de consultar_horarios).",
      parameters: {
        type: "object",
        properties: { calendar_hint: { type: "string", enum: keys }, startTime: { type: "string" } },
        required: ["calendar_hint", "startTime"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "confirmar_consulta",
      description: "Registra que o paciente CONFIRMOU presença na consulta já marcada (ex.: respondeu 'sim', 'confirmo', 'estarei lá' ao lembrete). Não use para agendar.",
      parameters: { type: "object", properties: { calendar_hint: { type: "string", enum: keys } }, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "atualizar_lead",
      description: "Registra no CRM o que você descobriu sobre o lead. Chame assim que souber algo novo, sem avisar o paciente. score: 0-100 (0-30 só curiosidade, 31-60 interesse real, 61-100 pronto para agendar).",
      parameters: {
        type: "object",
        properties: {
          specialty: { type: "string", enum: [...SPECIALTIES] },
          insurance: { type: "string", description: "Nome do convênio ou 'particular'" },
          patient_name: { type: "string" },
          stage: { type: "string", enum: [...STAGES] },
          score: { type: "integer" },
          intent: { type: "string", description: "Resumo de uma linha do que o lead quer" },
          lost_reason: { type: "string", description: "Só se stage = perdido: preço, convênio, horário, sem resposta, outro" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "transferir_humano",
      description: "Passa a conversa para a equipe e pausa a IA. Use em financeiro (boleto/reembolso), reclamação, pedido de atendente ou assunto clínico sensível.",
      parameters: { type: "object", properties: { motivo: { type: "string" } }, required: ["motivo"] },
    },
  },
];

const updateSchema = z.object({
  specialty: z.enum(SPECIALTIES).optional(),
  insurance: z.string().optional(),
  patient_name: z.string().optional(),
  stage: z.enum(STAGES).optional(),
  score: z.number().int().min(0).max(100).optional(),
  intent: z.string().optional(),
  lost_reason: z.string().optional(),
});

export async function activeScript(): Promise<{ id: string | null; prompt: string }> {
  const { data } = await admin().from("script_versions").select("id,prompt").eq("status", "ativa").maybeSingle();
  return data ? { id: data.id, prompt: data.prompt } : { id: null, prompt: DEFAULT_SCRIPT };
}

async function alertTeam(text: string) {
  const to = process.env.TEAM_ALERT_NUMBER;
  if (to) await sendText(to, text, 500).catch(() => {});
}

type Ctx = { lead: Lead; handoff: boolean; cfg: ClinicSettings };

async function runTool(name: string, rawArgs: string, ctx: Ctx): Promise<unknown> {
  const args = JSON.parse(rawArgs || "{}");
  const p = args.calendar_hint ? ctx.cfg.professionals.find((x) => x.key === args.calendar_hint) : undefined;

  switch (name) {
    case "consultar_horarios": {
      if (!p) return { erro: "calendar_hint inválido" };
      const slots = await freeSlots(p, { janelaDias: args.janela_dias, periodo: args.periodo, dia_semana: args.dia_semana }, 6);
      if (slots.length) ctx.lead = await advanceStage(ctx.lead, "horario_oferecido");
      return slots.length ? { profissional: p.name, horarios: slots } : { profissional: p.name, horarios: [], aviso: "sem vagas na janela; tente janela_dias maior ou outro profissional" };
    }
    case "agendar_consulta": {
      if (!p) return { erro: "calendar_hint inválido" };
      const existing = await activeAppointment(ctx.lead.id, p.key);
      if (existing) return { erro: `o paciente já tem consulta com ${existing.professional} em ${fmtDateTime(existing.starts_at)}; pergunte se quer manter ou reagendar (use reagendar_consulta)` };
      const slot = await resolveSlot(p, args.startTime);
      if (!slot) return { erro: "horário indisponível; chame consultar_horarios de novo" };
      const patient = args.nome_paciente as string;
      const appt = await createAppointment({ leadId: ctx.lead.id, patient, phone: ctx.lead.phone, p, slot });
      ctx.lead = await updateLead(ctx.lead, { patient_name: patient, email: args.email ?? ctx.lead.email, specialty: p.specialty, stage: "agendado", score: 100 });
      await logEvent(ctx.lead.id, "appointment_created", { id: appt.id, starts_at: slot.startTime, professional: p.name });
      await alertTeam(`✅ Consulta agendada\n${patient} — ${p.name}\n${slot.label}\nwa.me/${ctx.lead.phone}`);
      return { ok: true, profissional: p.name, horario: slot.label };
    }
    case "cancelar_consulta": {
      const appt = await cancelLatest(ctx.lead.id, args.calendar_hint);
      if (!appt) return { erro: "nenhuma consulta ativa encontrada" };
      await logEvent(ctx.lead.id, "appointment_cancelled", { id: appt.id });
      ctx.lead = await updateLead(ctx.lead, { stage: "qualificado" });
      return { ok: true, profissional: appt.professional };
    }
    case "reagendar_consulta": {
      if (!p) return { erro: "calendar_hint inválido" };
      const old = await activeAppointment(ctx.lead.id, p.key);
      if (!old) return { erro: "nenhuma consulta ativa para reagendar" };
      const slot = await resolveSlot(p, args.startTime);
      if (!slot) return { erro: "horário indisponível; chame consultar_horarios de novo" };
      // cria o novo ANTES de cancelar o antigo: se falhar, o paciente não fica sem consulta
      await createAppointment({ leadId: ctx.lead.id, patient: ctx.lead.patient_name ?? ctx.lead.name ?? "Paciente", phone: ctx.lead.phone, p, slot });
      await cancelById(old, "remarcado"); // o horário antigo volta para a agenda
      await logEvent(ctx.lead.id, "appointment_rescheduled", { from: old.starts_at, to: slot.startTime });
      return { ok: true, profissional: p.name, horario: slot.label };
    }
    case "confirmar_consulta": {
      const appt = await confirmAppointment(ctx.lead.id, args.calendar_hint);
      if (!appt) return { erro: "nenhuma consulta ativa para confirmar" };
      await logEvent(ctx.lead.id, "appointment_confirmed", { id: appt.id, starts_at: appt.starts_at });
      return { ok: true, profissional: appt.professional, horario: fmtDateTime(appt.starts_at) };
    }
    case "atualizar_lead": {
      const patch = updateSchema.parse(args);
      // o modelo não pode pular para "agendado" (só agendar_consulta faz isso)
      if (patch.stage === "agendado" || patch.stage === "compareceu") delete patch.stage;
      ctx.lead = await updateLead(ctx.lead, patch);
      return { ok: true };
    }
    case "transferir_humano": {
      const until = new Date(Date.now() + CLINIC.humanPauseHours * 3600e3).toISOString();
      ctx.lead = await updateLead(ctx.lead, { ai_paused_until: until });
      await logEvent(ctx.lead.id, "handoff", { motivo: args.motivo });
      await alertTeam(`🙋 Atendimento humano solicitado\n${ctx.lead.name ?? ""} wa.me/${ctx.lead.phone}\nMotivo: ${args.motivo}`);
      ctx.handoff = true;
      return { ok: true };
    }
    default:
      return { erro: `ferramenta desconhecida: ${name}` };
  }
}

function toChat(history: Message[]): ChatCompletionMessageParam[] {
  return history.map((m) => ({ role: m.role === "lead" ? "user" : "assistant", content: m.content }) as ChatCompletionMessageParam);
}

/** Uma única chamada de agente por rodada: responde, classifica o lead e agenda via tools. */
export async function runAgent(leadId: string): Promise<void> {
  const db = admin();
  const { data: leadRow } = await db.from("leads").select("*").eq("id", leadId).single();
  const { data: hist } = await db.from("messages").select("*").eq("lead_id", leadId).order("created_at", { ascending: false }).limit(HISTORY_LIMIT);
  const history = ((hist ?? []) as Message[]).reverse();
  const script = await activeScript();

  const cfg = await getClinicSettings(); // preços, grades e convênios editados no CRM (com fallback)
  const ctx: Ctx = { lead: leadRow as Lead, handoff: false, cfg };
  const lead = ctx.lead;
  const system =
    `${script.prompt}\n\n${factsBlock(todayLabel(), cfg)}\n\n# CONTEXTO DO LEAD (CRM)\n` +
    `Nome no WhatsApp: ${lead.name ?? "?"} | Paciente: ${lead.patient_name ?? "?"} | Especialidade: ${lead.specialty ?? "?"} | Convênio: ${lead.insurance ?? "?"} | Etapa: ${lead.stage}\n` +
    `Se o paciente pedir para não receber mais mensagens ou disser que não tem interesse, agradeça com educação, registre stage=perdido com lost_reason "pediu para parar" e não insista.`;

  const upcoming = await upcomingAppointments(leadId);
  const apptBlock = upcoming.length
    ? `\n\n# CONSULTAS MARCADAS DESTE PACIENTE\n${upcoming.map((a) => `- ${a.professional} (calendar_hint="${a.calendar_hint}"): ${fmtDateTime(a.starts_at)}${a.confirmed_at ? " — presença já confirmada" : a.reminder_sent_at ? " — lembrete enviado, aguardando confirmação" : ""}`).join("\n")}\n` +
      `Se o paciente confirmar presença (sim, confirmo, estarei lá): chame confirmar_consulta e agradeça em uma frase, sem repetir tudo.\n` +
      `Se disser que NÃO pode ir ou pedir outro horário: seja acolhedora, chame consultar_horarios, ofereça até 3 opções e, quando escolher, use reagendar_consulta (o horário antigo volta sozinho para a agenda). Se desistir de vez, use cancelar_consulta e deixe a porta aberta para voltar.`
    : "";

  const messages: ChatCompletionMessageParam[] = [{ role: "system", content: system + apptBlock }, ...toChat(history)];
  let reply = "";

  for (let step = 0; step < MAX_STEPS; step++) {
    const res = await openai().chat.completions.create({
      model: process.env.AGENT_MODEL || "gpt-4.1-mini",
      messages,
      tools,
      temperature: 0.4,
    });
    const msg = res.choices[0].message;
    if (!msg.tool_calls?.length) {
      reply = msg.content?.trim() ?? "";
      break;
    }
    messages.push(msg);
    // ferramentas independentes rodam em paralelo
    const results = await Promise.all(
      msg.tool_calls.map(async (tc) => {
        if (tc.type !== "function") return { id: tc.id, out: { erro: "tipo não suportado" } };
        try {
          return { id: tc.id, out: await runTool(tc.function.name, tc.function.arguments, ctx) };
        } catch (e) {
          await logEvent(leadId, "tool_error", { tool: tc.function.name, error: String(e) });
          return { id: tc.id, out: { erro: "falha ao executar; tente novamente ou transfira para humano" } };
        }
      }),
    );
    for (const r of results) messages.push({ role: "tool", tool_call_id: r.id, content: JSON.stringify(r.out) });
  }

  if (!reply) throw new Error("agente sem resposta final");

  for (const part of splitMessage(reply)) {
    const waId = await sendText(lead.phone, part, typingDelay(part));
    await db.from("messages").insert({ lead_id: leadId, role: "ia", content: part, wa_id: waId ?? null, processed: true, script_version_id: script.id });
  }
}
