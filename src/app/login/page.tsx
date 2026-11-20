"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";

export default function Login() {
  const router = useRouter();
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const f = new FormData(e.currentTarget);
    const { error } = await supabaseBrowser().auth.signInWithPassword({ email: String(f.get("email")), password: String(f.get("password")) });
    setBusy(false);
    if (error) return setErr("E-mail ou senha inválidos.");
    router.replace("/");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#def3f4] via-white to-[#e2f3e0] p-4">
      <form onSubmit={submit} className="card w-full max-w-sm space-y-4 p-6">
        <div className="space-y-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="Clinicenter - Clínica Médica Multiespecialidades" className="mx-auto h-auto w-full max-w-[260px]" />
          <p className="text-center text-sm text-muted">Acesso da equipe</p>
        </div>
        <input name="email" type="email" required placeholder="E-mail" className="w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand" />
        <input name="password" type="password" required placeholder="Senha" className="w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand" />
        {err && <p className="text-sm text-bad">{err}</p>}
        <button disabled={busy} className="btn btn-primary w-full">{busy ? "Entrando…" : "Entrar"}</button>
      </form>
    </main>
  );
}
