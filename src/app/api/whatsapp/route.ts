import type { NextRequest } from "next/server";
import { connectInstance, ensureInstance, evolutionConfigured, getInstanceInfo, instanceName, logoutInstance, setWebhook } from "@/lib/evolution";
import { isDemo } from "@/lib/supabase-server";
import { whatsappAuth, webhookUrl } from "@/lib/whatsapp-auth";

export const dynamic = "force-dynamic";
const msg = (e: unknown) => String(e instanceof Error ? e.message : e).slice(0, 300);

/** Estado da conexão do WhatsApp (qualquer usuário logado). */
export async function GET() {
  const a = await whatsappAuth();
  if (!a.ok) return Response.json({ error: "não autenticado" }, { status: 401 });
  if (isDemo || !evolutionConfigured()) return Response.json({ configured: false, gestor: a.gestor });
  try {
    return Response.json({ configured: true, gestor: a.gestor, instance: instanceName(), ...(await getInstanceInfo()) });
  } catch (e) {
    return Response.json({ configured: true, gestor: a.gestor, error: msg(e) }, { status: 502 });
  }
}

/** Ações do gestor: { action: "connect", number? } gera QR Code/código e aponta o webhook; { action: "logout" } desconecta. */
export async function POST(req: NextRequest) {
  const a = await whatsappAuth();
  if (!a.ok) return Response.json({ error: "não autenticado" }, { status: 401 });
  if (!a.gestor) return Response.json({ error: "Somente o gestor pode alterar a conexão do WhatsApp." }, { status: 403 });
  if (!evolutionConfigured()) return Response.json({ error: "Evolution não configurado (EVOLUTION_BASE_URL / EVOLUTION_API_KEY)." }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) as { action?: string; number?: string };
  try {
    if (body.action === "logout") {
      await logoutInstance();
      return Response.json({ ok: true });
    }
    if (body.action === "connect") {
      if (!process.env.WEBHOOK_SECRET) return Response.json({ error: "WEBHOOK_SECRET não configurado na Vercel." }, { status: 400 });
      const digits = body.number?.replace(/\D/g, "");
      await ensureInstance();
      await setWebhook(webhookUrl(req));
      return Response.json(await connectInstance(digits && digits.length >= 10 ? digits : undefined));
    }
    return Response.json({ error: "ação inválida" }, { status: 400 });
  } catch (e) {
    return Response.json({ error: msg(e) }, { status: 502 });
  }
}
