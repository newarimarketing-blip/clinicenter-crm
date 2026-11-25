import { isDemo, supabaseServer } from "./supabase-server";
import { admin } from "./supabase-admin";

export type Role = "gestor" | "recepcao";
export type Me = { email: string | null; role: Role; /** false = tabela user_roles ainda não existe (migração 006) */ ready: boolean };

/**
 * Papel do usuário logado. Gestor edita configurações; recepção só visualiza.
 * Sem a migração 006 (ou em modo demonstração) todos continuam com acesso total, como antes.
 */
export async function currentMe(): Promise<Me> {
  if (isDemo) return { email: "demo", role: "gestor", ready: false };
  const db = await supabaseServer();
  const { data } = await db.auth.getUser();
  const email = data.user?.email?.toLowerCase() ?? null;
  if (!email) return { email: null, role: "recepcao", ready: true };
  const { data: row, error } = await admin().from("user_roles").select("role").eq("email", email).maybeSingle();
  if (error) return { email, role: "gestor", ready: false };
  return { email, role: row?.role === "gestor" ? "gestor" : "recepcao", ready: true };
}

export type RoleRow = { email: string; role: Role };

export async function listRoles(): Promise<RoleRow[]> {
  if (isDemo) return [];
  const { data } = await admin().from("user_roles").select("email, role").order("email");
  return (data ?? []) as RoleRow[];
}

export type TeamMember = { email: string; role: Role; hasRole: boolean; lastSignIn: string | null };

/** Usuários do login (Supabase Auth) com o papel de cada um. Quem não tem papel entra como recepção. */
export async function listTeam(): Promise<TeamMember[]> {
  if (isDemo) return [];
  const [{ data: users }, roles] = await Promise.all([admin().auth.admin.listUsers({ page: 1, perPage: 200 }), listRoles()]);
  const byEmail = new Map(roles.map((r) => [r.email, r.role]));
  const out: TeamMember[] = (users?.users ?? [])
    .filter((u) => u.email)
    .map((u) => ({ email: u.email!.toLowerCase(), role: byEmail.get(u.email!.toLowerCase()) ?? "recepcao", hasRole: byEmail.has(u.email!.toLowerCase()), lastSignIn: u.last_sign_in_at ?? null }));
  // papéis cadastrados sem usuário no login (e-mail ainda não criado)
  for (const r of roles) if (!out.some((m) => m.email === r.email)) out.push({ email: r.email, role: r.role, hasRole: true, lastSignIn: null });
  return out.sort((a, b) => a.email.localeCompare(b.email));
}
