import { isDemo, supabaseServer } from "./supabase-server";
import { DEMO_INSIGHTS, DEMO_LEADS, DEMO_MESSAGES, DEMO_SCRIPTS } from "./demo";
import type { Insight, Lead, Message, ScriptVersion } from "./types";

export async function getLeads(): Promise<Lead[]> {
  if (isDemo) return DEMO_LEADS;
  const db = await supabaseServer();
  const { data } = await db.from("leads").select("*").order("last_message_at", { ascending: false, nullsFirst: false }).limit(2000);
  return (data ?? []) as Lead[];
}

export async function getMessages(leadId: string): Promise<Message[]> {
  if (isDemo) return DEMO_MESSAGES.filter((m) => m.lead_id === leadId);
  const db = await supabaseServer();
  const { data } = await db.from("messages").select("*").eq("lead_id", leadId).order("created_at").limit(300);
  return (data ?? []) as Message[];
}

export async function getScripts(): Promise<{ versions: ScriptVersion[]; insights: Insight[] }> {
  if (isDemo) return { versions: DEMO_SCRIPTS, insights: DEMO_INSIGHTS };
  const db = await supabaseServer();
  const [v, i] = await Promise.all([
    db.from("script_versions").select("*").order("version", { ascending: false }).limit(20),
    db.from("script_insights").select("*").order("created_at", { ascending: false }).limit(4),
  ]);
  return { versions: (v.data ?? []) as ScriptVersion[], insights: (i.data ?? []) as Insight[] };
}
