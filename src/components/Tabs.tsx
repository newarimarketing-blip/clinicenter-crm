import Link from "next/link";

/** Abas por endereço (?aba=): funcionam sem JavaScript e mantêm o link compartilhável. */
export function Tabs({ base, current, tabs }: { base: string; current: string; tabs: { id: string; label: string }[] }) {
  return (
    <div className="flex flex-wrap gap-1 border-b border-line">
      {tabs.map((t) => (
        <Link
          key={t.id}
          href={t.id === tabs[0].id ? base : `${base}?aba=${t.id}`}
          className={`-mb-px rounded-t-lg border-b-2 px-4 py-2 text-sm font-medium ${current === t.id ? "border-brand text-brand" : "border-transparent text-muted hover:text-brand"}`}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
