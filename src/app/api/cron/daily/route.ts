import type { NextRequest } from "next/server";
import { sendAppointmentReminders } from "@/lib/reminders";
import { sendFollowups } from "@/lib/followups";
import { generateWeeklyReport, isMondayLocal } from "@/lib/report";

export const maxDuration = 120;

/**
 * Rotina diária (Vercel Cron, plano Hobby = 1 execução/dia por job).
 * Também pode ser chamada com mais frequência por um agendador externo, com o mesmo Bearer:
 *   /api/cron/daily?tasks=reminders,followups,report   (padrão: todas)
 * Cada tarefa é isolada: erro em uma não impede as outras.
 */
export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return new Response("unauthorized", { status: 401 });
  const wanted = (req.nextUrl.searchParams.get("tasks") ?? "reminders,followups,report").split(",");
  const out: Record<string, unknown> = {};
  const run = async (name: string, fn: () => Promise<unknown>) => {
    if (!wanted.includes(name)) return;
    try {
      out[name] = await fn();
    } catch (e) {
      out[name] = { error: String(e).slice(0, 300) };
    }
  };
  await run("reminders", () => sendAppointmentReminders());
  await run("followups", () => sendFollowups());
  // relatório semanal: toda segunda (Fortaleza); ?force=1 gera fora desse dia
  const force = req.nextUrl.searchParams.get("force") === "1";
  await run("report", async () => (isMondayLocal() || force ? generateWeeklyReport() : { skipped: "só gera às segundas" }));
  return Response.json(out);
}
