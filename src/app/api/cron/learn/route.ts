import type { NextRequest } from "next/server";
import { runLearning } from "@/lib/learn";

export const maxDuration = 120;

// Vercel Cron envia "Authorization: Bearer $CRON_SECRET"
export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return new Response("unauthorized", { status: 401 });
  return Response.json(await runLearning(7));
}
