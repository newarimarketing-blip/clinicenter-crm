export function relTime(iso: string | null): string {
  if (!iso) return "—";
  const m = Math.round((Date.now() - +new Date(iso)) / 60000);
  if (m < 1) return "agora";
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h`;
  return `${Math.round(h / 24)} d`;
}

export function phoneFmt(p: string): string {
  const d = p.replace(/\D/g, "");
  if (d.length === 13) return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
  return `+${d}`;
}

export const initials = (n: string | null) => (n ?? "?").split(" ").map((s) => s[0]).slice(0, 2).join("").toUpperCase();

export const timeHM = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Fortaleza" });

export const isPaused = (until: string | null) => !!until && new Date(until) > new Date();
