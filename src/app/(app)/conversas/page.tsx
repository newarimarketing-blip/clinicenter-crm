import Link from "next/link";
import { getLeads, getMessages } from "@/lib/data";
import { isDemo } from "@/lib/supabase-server";
import { Thread } from "@/components/Thread";
import { SpecialtyChip, StageChip } from "@/components/ui";
import { initials, isPaused, phoneFmt, relTime } from "@/lib/format";
import { sendHumanMessage, setAiPaused } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function Conversas({ searchParams }: { searchParams: Promise<{ lead?: string }> }) {
  const { lead: sel } = await searchParams;
  // com ?lead= já na URL, busca lista e mensagens ao mesmo tempo
  const [allLeads, early] = await Promise.all([getLeads(), sel ? getMessages(sel) : Promise.resolve(null)]);
  const leads = allLeads.filter((l) => l.last_message_at);
  const current = leads.find((l) => l.id === sel) ?? leads[0];
  const messages = !current ? [] : early && current.id === sel ? early : await getMessages(current.id);
  const paused = current ? isPaused(current.ai_paused_until) : false;

  return (
    <div className="card flex h-[calc(100vh-4rem)] min-h-[520px] overflow-hidden">
      <aside className="w-72 shrink-0 overflow-y-auto border-r border-line">
        {leads.map((l) => (
          <Link key={l.id} href={`/conversas?lead=${l.id}`} className={`flex gap-3 border-b border-line px-3 py-3 ${l.id === current?.id ? "bg-brand-soft/60" : "hover:bg-black/[0.03]"}`}>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-semibold text-white">{initials(l.name)}</div>
            <div className="min-w-0 flex-1">
              <div className="flex justify-between gap-2">
                <span className="truncate text-sm font-medium">{l.name ?? l.phone}</span>
                <span className="shrink-0 text-xs text-muted">{relTime(l.last_message_at)}</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                <SpecialtyChip s={l.specialty} />
                {isPaused(l.ai_paused_until) && <span className="chip bg-warn-soft text-warn">humano</span>}
              </div>
            </div>
          </Link>
        ))}
      </aside>

      {current ? (
        <section className="flex min-w-0 flex-1 flex-col bg-bg">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-white px-4 py-3">
            <div>
              <div className="font-medium">{current.name ?? "Sem nome"} <span className="text-sm font-normal text-muted">{phoneFmt(current.phone)}</span></div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <StageChip stage={current.stage} />
                <SpecialtyChip s={current.specialty} />
                {current.insurance && <span className="chip bg-slate-100 text-slate-700">{current.insurance}</span>}
                {current.score != null && <span className="chip bg-slate-100 text-slate-700">score {current.score}</span>}
              </div>
            </div>
            <form action={setAiPaused.bind(null, current.id, !paused)}>
              <button className={`btn ${paused ? "btn-primary" : ""}`}>{paused ? "Devolver para a IA" : "Assumir conversa (pausar IA)"}</button>
            </form>
          </header>

          <Thread leadId={current.id} initial={messages} live={!isDemo} />

          <form action={sendHumanMessage.bind(null, current.id, current.phone)} className="flex gap-2 border-t border-line bg-white p-3">
            <input name="text" required autoComplete="off" placeholder={paused ? "Responder como equipe…" : "Enviar mensagem (a IA será pausada)…"} className="flex-1 rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand" />
            <button className="btn btn-primary">Enviar</button>
          </form>
        </section>
      ) : (
        <p className="m-auto text-sm text-muted">Nenhuma conversa ainda.</p>
      )}
    </div>
  );
}
