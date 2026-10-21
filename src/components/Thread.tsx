"use client";
import { useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { timeHM } from "@/lib/format";
import type { Message } from "@/lib/types";

const STYLE: Record<Message["role"], string> = {
  lead: "self-start bg-white border border-line",
  ia: "self-end bg-brand-soft",
  humano: "self-end bg-amber-100",
};
const WHO: Record<Message["role"], string> = { lead: "Paciente", ia: "Marcelia (IA)", humano: "Equipe" };

export function Thread({ leadId, initial, live }: { leadId: string; initial: Message[]; live: boolean }) {
  const [msgs, setMsgs] = useState(initial);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMsgs(initial);
  }, [initial]);

  useEffect(() => {
    if (!live) return;
    const sb = supabaseBrowser();
    const ch = sb
      .channel(`msgs-${leadId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `lead_id=eq.${leadId}` }, (p) =>
        setMsgs((cur) => (cur.some((m) => m.id === (p.new as Message).id) ? cur : [...cur, p.new as Message])),
      )
      .subscribe();
    return () => {
      try {
        void sb.removeChannel(ch);
      } catch {}
    };
  }, [leadId, live]);

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs.length]);

  return (
    <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-4">
      {msgs.map((m) => (
        <div key={m.id} className={`max-w-[78%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm ${STYLE[m.role]}`}>
          <div className="mb-0.5 text-[11px] font-medium text-muted">
            {WHO[m.role]} · {timeHM(m.created_at)}
          </div>
          {m.content}
        </div>
      ))}
      <div ref={end} />
    </div>
  );
}
