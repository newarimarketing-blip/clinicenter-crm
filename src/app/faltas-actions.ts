"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isDemo, supabaseServer } from "@/lib/supabase-server";
import { registerAbsence, removeAbsence } from "@/lib/absences";
import { getClinicSettings } from "@/lib/clinic-settings";

const back = (q: string): never => redirect(`/faltas?${q}`);
const err = (m: string) => back("erro=" + encodeURIComponent(m));
const YMD = /^\d{4}-\d{2}-\d{2}$/;

async function user() {
  if (isDemo) return null;
  const db = await supabaseServer();
  const { data } = await db.auth.getUser();
  return data.user ?? null;
}

/** Registra a falta do profissional, desmarca as consultas e avisa os clientes por WhatsApp. */
export async function registrarFalta(formData: FormData) {
  const u = await user();
  if (!u) return err(isDemo ? "Modo demonstração: nada é salvo." : "Sessão expirada. Entre de novo.");
  const key = String(formData.get("professional") ?? "");
  const from = String(formData.get("from") ?? "");
  const to = String(formData.get("to") ?? "") || from;
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 120);
  const notify = formData.get("notify") === "on";
  const today = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
  if (!(await getClinicSettings()).professionals.some((p) => p.key === key)) return err("Escolha o profissional.");
  if (!YMD.test(from) || !YMD.test(to)) return err("Informe a data da falta.");
  if (from < today) return err("A data da falta não pode ser no passado.");
  if (to < from) return err("A data final não pode ser antes da inicial.");
  if (+new Date(to) - +new Date(from) > 60 * 86400e3) return err("O período máximo é de 60 dias.");
  try {
    const r = await registerAbsence({ professionalKey: key, from, to, reason, by: u.email ?? "equipe", notify });
    revalidatePath("/faltas");
    revalidatePath("/agenda");
    revalidatePath("/consultas");
    const q = new URLSearchParams({ ok: "falta", a: String(r.affected), n: String(r.notified) });
    if (r.failed.length) q.set("f", r.failed.join(", "));
    if (r.tableMissing) q.set("aviso", "A falta foi aplicada, mas a tabela de faltas ainda não existe: rode a migração 009 no Supabase para o dia ficar bloqueado na agenda e o registro aparecer aqui.");
    return back(q.toString());
  } catch (e) {
    if (e && typeof e === "object" && "digest" in e) throw e; // redirect
    return err("Não foi possível registrar: " + String(e instanceof Error ? e.message : e).slice(0, 160));
  }
}

/** Remove a falta: o dia volta a ter vagas (clientes já avisados não são reavisados). */
export async function desfazerFalta(formData: FormData) {
  if (!(await user())) return;
  await removeAbsence(String(formData.get("id") ?? ""));
  revalidatePath("/faltas");
  revalidatePath("/agenda");
  return back("ok=removida");
}
