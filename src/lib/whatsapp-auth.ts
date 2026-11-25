import type { NextRequest } from "next/server";
import { isDemo, supabaseServer } from "./supabase-server";
import { currentMe } from "./roles";

/** Usuário logado (qualquer papel) ou gestor. Em modo demonstração, libera como gestor. */
export async function whatsappAuth(): Promise<{ ok: boolean; gestor: boolean }> {
  if (isDemo) return { ok: true, gestor: true };
  const db = await supabaseServer();
  const { data } = await db.auth.getUser();
  if (!data.user) return { ok: false, gestor: false };
  const me = await currentMe();
  return { ok: true, gestor: me.role === "gestor" };
}

/** URL pública do sistema (para registrar o webhook no Evolution). */
export function publicOrigin(req: NextRequest): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? req.nextUrl.host;
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}

export const webhookUrl = (req: NextRequest) => `${publicOrigin(req)}/api/webhook/evolution?secret=${encodeURIComponent(process.env.WEBHOOK_SECRET ?? "")}`;
