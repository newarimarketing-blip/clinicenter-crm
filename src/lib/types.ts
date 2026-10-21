import type { Stage } from "./clinic-config";

export type Lead = {
  id: string;
  created_at: string;
  updated_at: string;
  phone: string;
  name: string | null;
  patient_name: string | null;
  email: string | null;
  specialty: string | null;
  insurance: string | null;
  stage: Stage;
  score: number | null;
  intent: string | null;
  lost_reason: string | null;
  source: string | null;
  ai_paused_until: string | null;
  last_message_at: string | null;
  last_inbound_at: string | null;
};

export type Message = {
  id: string;
  created_at: string;
  lead_id: string;
  role: "lead" | "ia" | "humano";
  content: string;
  media_type: string | null;
  wa_id: string | null;
  processed: boolean;
  script_version_id: string | null;
};

export type Appointment = {
  id: string;
  lead_id: string;
  professional: string;
  calendar_hint: string;
  specialty: string;
  starts_at: string;
  ends_at: string;
  gcal_event_id: string | null;
  status: string;
};

export type ScriptVersion = {
  id: string;
  created_at: string;
  version: number;
  status: "proposta" | "ativa" | "arquivada" | "rejeitada";
  prompt: string;
  rationale: string | null;
  changes: string[];
  approved_at: string | null;
};

export type Insight = {
  id: string;
  created_at: string;
  period_start: string;
  period_end: string;
  metrics: Record<string, unknown>;
  findings: { type: "funcionou" | "perdeu"; pattern: string; evidence: string }[];
};
