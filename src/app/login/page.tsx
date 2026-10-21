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
    <main className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={submit} className="card w-full max-w-sm space-y-4 p-6">
        <div>
          <h1 className="text-xl font-semibold text-brand">Clinicenter</h1>
          <p className="text-sm text-muted">Acesso da equipe</p>
        </div>
        <input name="email" type="email" required placeholder="E-mail" className="w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand" />
        <input name="password" type="password" required placeholder="Senha" className="w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand" />
        {err && <p className="text-sm text-bad">{err}</p>}
        <button disabled={busy} className="btn btn-primary w-full">{busy ? "Entrando…" : "Entrar"}</button>
      </form>
    </main>
  );
}
