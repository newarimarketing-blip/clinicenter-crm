import { admin } from "./supabase-admin";
import { STAGES, type Stage } from "./clinic-config";
import type { Lead } from "./types";

export const stageRank = (s: Stage) => STAGES.indexOf(s);

export async function upsertLead(phone: string, name?: string | null): Promise<Lead> {
  const db = admin();
  const { data: found } = await db.from("leads").select("*").eq("phone", phone).maybeSingle();
  if (found) {
    if (name && !found.name) await db.from("leads").update({ name }).eq("id", found.id);
    return found as Lead;
  }
  const { data, error } = await db.from("leads").insert({ phone, name: name ?? null }).select().single();
  if (error) throw error;
  await logEvent(data.id, "lead_created");
  return data as Lead;
}

export async function logEvent(leadId: string, type: string, data: Record<string, unknown> = {}) {
  await admin().from("lead_events").insert({ lead_id: leadId, type, data });
}

export async function updateLead(lead: Lead, patch: Partial<Lead>): Promise<Lead> {
  const { data, error } = await admin().from("leads").update(patch).eq("id", lead.id).select().single();
  if (error) throw error;
  if (patch.stage && patch.stage !== lead.stage) await logEvent(lead.id, "stage_changed", { from: lead.stage, to: patch.stage });
  return data as Lead;
}

/** Avança a etapa só para frente. Um lead "perdido" que volta a conversar é reaberto. */
export async function advanceStage(lead: Lead, to: Stage): Promise<Lead> {
  if (lead.stage === "perdido" || stageRank(to) > stageRank(lead.stage)) return updateLead(lead, { stage: to });
  return lead;
}
