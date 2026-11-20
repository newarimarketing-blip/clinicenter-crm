import { Nav } from "@/components/Nav";
import { isDemo } from "@/lib/supabase-server";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-[1400px] flex-col md:flex-row">
      <aside className="shrink-0 border-b border-line bg-white p-4 md:w-56 md:border-b-0 md:border-r">
        <div className="mb-5 px-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="Clinicenter - Clínica Médica Multiespecialidades" className="h-auto w-full" />
          <div className="mt-2 text-[11px] font-medium uppercase tracking-widest text-muted">CRM + atendimento IA</div>
        </div>
        <Nav />
        {isDemo && <p className="mt-6 rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn">Modo demonstração: dados fictícios. Configure o Supabase para usar dados reais.</p>}
      </aside>
      <main className="min-w-0 flex-1 p-4 md:p-8">{children}</main>
    </div>
  );
}
