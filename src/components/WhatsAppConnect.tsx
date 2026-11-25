"use client";
import { useCallback, useEffect, useRef, useState } from "react";

type Status = { configured?: boolean; gestor?: boolean; instance?: string; state?: "open" | "connecting" | "close" | "absent"; number?: string; name?: string; error?: string };

const fmtNumber = (n?: string) => {
  if (!n) return "";
  const m = n.match(/^55(\d{2})(9?\d{4})(\d{4})$/);
  return m ? `+55 (${m[1]}) ${m[2]}-${m[3]}` : `+${n}`;
};

export function WhatsAppConnect() {
  const [st, setSt] = useState<Status | null>(null);
  const [qr, setQr] = useState<string>();
  const [code, setCode] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [phone, setPhone] = useState("");
  const [mode, setMode] = useState<"qr" | "code">("qr");
  const waiting = useRef(false); // true enquanto aguardamos o pareamento

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/whatsapp", { cache: "no-store" });
      const j = (await r.json()) as Status;
      setSt(j);
      if (j.state === "open") { waiting.current = false; setQr(undefined); setCode(undefined); }
    } catch { setSt({ error: "Sem conexão com o servidor." }); }
  }, []);

  async function connect(number?: string) {
    setBusy(true); setMsg("");
    try {
      const r = await fetch("/api/whatsapp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "connect", number }) });
      const j = await r.json();
      if (!r.ok) { setMsg(j.error ?? "Não foi possível gerar o QR Code."); return; }
      waiting.current = true;
      setQr(j.qr); setCode(j.pairingCode);
      if (!j.qr && !j.pairingCode) setMsg("A Evolution não devolveu o QR Code. Tente novamente em alguns segundos.");
    } finally { setBusy(false); }
  }

  async function logout() {
    if (!window.confirm("Desconectar o WhatsApp? A Marcelia para de responder até você conectar de novo.")) return;
    setBusy(true); setMsg("");
    try {
      const r = await fetch("/api/whatsapp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "logout" }) });
      const j = await r.json();
      if (!r.ok) setMsg(j.error ?? "Não foi possível desconectar.");
      else setMsg("WhatsApp desconectado.");
      setQr(undefined); setCode(undefined);
    } finally { setBusy(false); refresh(); }
  }

  useEffect(() => { refresh(); }, [refresh]);
  // enquanto espera o pareamento: confere o estado a cada 3 s e renova o QR a cada 25 s (ele expira)
  useEffect(() => {
    if (!qr && !code) return;
    const poll = setInterval(refresh, 3000);
    const renew = setInterval(() => { if (waiting.current && mode === "qr") connect(); }, 25000);
    return () => { clearInterval(poll); clearInterval(renew); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qr, code, mode, refresh]);

  if (!st) return <div className="card p-6 text-sm text-muted">Verificando conexão…</div>;
  if (st.configured === false) {
    return (
      <div className="card p-6 text-sm">
        <p className="font-medium">Evolution API ainda não configurada neste ambiente.</p>
        <p className="mt-1 text-muted">Defina na Vercel as variáveis <code>EVOLUTION_BASE_URL</code>, <code>EVOLUTION_API_KEY</code>, <code>EVOLUTION_INSTANCE</code> e <code>WEBHOOK_SECRET</code> e faça um novo deploy.</p>
      </div>
    );
  }

  const connected = st.state === "open";
  const gestor = st.gestor !== false;
  return (
    <div className="card space-y-5 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <span className={`chip ${connected ? "bg-ok-soft text-green-800" : st.error ? "bg-bad-soft text-bad" : "bg-warn-soft text-warn"}`}>
          {connected ? "Conectado" : st.error ? "Erro" : st.state === "connecting" ? "Aguardando leitura do QR" : "Desconectado"}
        </span>
        {connected && <span className="text-sm">{st.name ? `${st.name} · ` : ""}{fmtNumber(st.number)}</span>}
        {st.instance && <span className="ml-auto text-xs text-muted">instância: {st.instance}</span>}
      </div>

      {st.error && <p className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">{st.error}</p>}
      {msg && <p className="rounded-lg bg-brand-soft px-3 py-2 text-sm">{msg}</p>}

      {connected ? (
        <div className="space-y-3">
          <p className="text-sm text-muted">O WhatsApp da clínica está ligado ao sistema e a Marcelia responde as mensagens recebidas.</p>
          {gestor && <button disabled={busy} onClick={logout} className="btn text-bad">Desconectar WhatsApp</button>}
        </div>
      ) : !gestor ? (
        <p className="text-sm text-muted">Somente o gestor pode conectar o WhatsApp.</p>
      ) : (
        <div className="space-y-4">
          <div className="flex gap-2">
            {(["qr", "code"] as const).map((m) => (
              <button key={m} onClick={() => { setMode(m); setQr(undefined); setCode(undefined); waiting.current = false; }} className={`chip border ${mode === m ? "border-brand bg-brand-soft text-brand" : "border-line bg-white text-muted"}`}>
                {m === "qr" ? "QR Code" : "Código por número"}
              </button>
            ))}
          </div>

          {mode === "code" && !code && (
            <div className="flex max-w-md gap-2">
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="DDD + número do WhatsApp da clínica" inputMode="tel" className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm" />
              <button disabled={busy || phone.replace(/\D/g, "").length < 10} onClick={() => connect(phone.startsWith("+") || phone.replace(/\D/g, "").startsWith("55") ? phone : "55" + phone)} className="btn btn-primary shrink-0">Gerar código</button>
            </div>
          )}
          {mode === "qr" && !qr && <button disabled={busy} onClick={() => connect()} className="btn btn-primary">{busy ? "Gerando…" : "Gerar QR Code"}</button>}

          {mode === "qr" && qr && (
            <div className="flex flex-wrap items-start gap-6">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qr} alt="QR Code do WhatsApp" className="h-60 w-60 rounded-lg border border-line bg-white p-2" />
              <ol className="max-w-sm list-decimal space-y-1.5 pl-5 text-sm text-muted">
                <li>No celular da clínica, abra o WhatsApp.</li>
                <li>Toque em <b>Aparelhos conectados</b> (Android: menu ⋮ · iPhone: Configurações).</li>
                <li>Toque em <b>Conectar um aparelho</b> e aponte para este QR Code.</li>
                <li>Aguarde: esta tela muda para &quot;Conectado&quot; sozinha. O QR renova a cada 25 s.</li>
              </ol>
            </div>
          )}
          {mode === "code" && code && (
            <div className="space-y-2">
              <div className="inline-block rounded-lg border border-line bg-white px-5 py-3 font-mono text-2xl font-semibold tracking-[0.3em]">{code}</div>
              <p className="max-w-md text-sm text-muted">No WhatsApp: Aparelhos conectados → Conectar um aparelho → <b>Conectar com número de telefone</b> e digite este código.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
