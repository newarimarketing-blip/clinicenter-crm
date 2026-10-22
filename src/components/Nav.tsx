"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/", label: "Painel" },
  { href: "/agenda", label: "Agenda" },
  { href: "/funil", label: "Funil" },
  { href: "/conversas", label: "Conversas" },
  { href: "/consultas", label: "Consultas" },
  { href: "/relatorios", label: "Relatórios" },
  { href: "/script", label: "Script da IA" },
  { href: "/configuracoes", label: "Configurações" },
];

export function Nav() {
  const path = usePathname();
  return (
    <nav className="flex gap-1 md:flex-col">
      {items.map((i) => {
        const active = i.href === "/" ? path === "/" : path.startsWith(i.href);
        return (
          <Link key={i.href} href={i.href} className={`rounded-lg px-3 py-2 text-sm font-medium ${active ? "bg-brand-soft text-brand" : "text-muted hover:bg-black/5"}`}>
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}
