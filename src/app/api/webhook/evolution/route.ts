import { after, type NextRequest } from "next/server";
import { processWebhook } from "@/lib/inbound";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (req.nextUrl.searchParams.get("secret") !== process.env.WEBHOOK_SECRET) {
    return new Response("unauthorized", { status: 401 });
  }
  const body = await req.json().catch(() => null);
  if (!body || (body.event && !/messages[._]upsert/i.test(body.event))) return Response.json({ ok: true, ignored: true });

  // responde 200 na hora (o Evolution não reenvia) e processa depois
  after(async () => {
    try {
      await processWebhook(body);
    } catch (e) {
      console.error("webhook error", e);
    }
  });
  return Response.json({ ok: true });
}
