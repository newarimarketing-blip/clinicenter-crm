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
