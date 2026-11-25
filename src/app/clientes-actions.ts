"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isDemo, supabaseServer } from "@/lib/supabase-server";
import { admin } from "@/lib/supabase-admin";
import { logEvent } from "@/lib/leads";

const normPhone = (v: string) => {
  const d = v.replace(/\D/g, "");
  return d.length === 10 || d.length === 11 ? `55${d}` : d;
};
const clean = (v: FormDataEntryValue | null, max = 200) => String(v ?? "").trim().slice(0, max) || null;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

async function user() {
  if (isDemo) return null;
  const db = await supabaseServer();
  const { data } = await db.auth.getUser();
  return data.user ?? null;
}

/** Cadastra um cliente manualmente (ou abre o já existente com o mesmo WhatsApp). */
export async function createClient(formData: FormData) {
  const u = await user();
  if (!u) return redirect("/clientes?erro=" + encodeURIComponent(isDemo ? "Modo demonstração: nada é salvo." : "Sessão expirada."));
  const name = clean(formData.get("name"));
  const phone = normPhone(String(formData.get("phone") ?? ""));
  const email = clean(formData.get("email"));
  if (!name) return redirect("/clientes?erro=" + encodeURIComponent("Informe o nome."));
  if (phone.length < 12 || phone.length > 13) return redirect("/clientes?erro=" + encodeURIComponent("Informe o WhatsApp com DDD (ex.: 88 99999-0000)."));
  if (email && !EMAIL.test(email)) return redirect("/clientes?erro=" + encodeURIComponent("E-mail inválido."));
  const db = admin();
  const { data: found } = await db.from("leads").select("id").eq("phone", phone).maybeSingle();
  if (found) return redirect(`/clientes/${found.id}?aviso=` + encodeURIComponent("Esse WhatsApp já estava cadastrado."));
  const { data, error } = await db.from("leads").insert({ phone, name, patient_name: clean(formData.get("patient_name")), email, insurance: clean(formData.get("insurance")), specialty: clean(formData.get("specialty"), 60)?.toLowerCase() ?? null, source: "cadastro manual", notes: clean(formData.get("notes"), 4000) }).select("id").single();
  if (error) return redirect("/clientes?erro=" + encodeURIComponent(error.message));
  await logEvent(data.id, "lead_created", { by: u.email ?? "equipe", manual: true });
  revalidatePath("/clientes");
  return redirect(`/clientes/${data.id}?ok=criado`);
}

/** Atualiza o cadastro do cliente. */
export async function updateClient(id: string, formData: FormData) {
  const u = await user();
  const back = (q: string): never => redirect(`/clientes/${id}?${q}`);
  if (!u) return back("erro=" + encodeURIComponent(isDemo ? "Modo demonstração: nada é salvo." : "Sessão expirada."));
  const name = clean(formData.get("name"));
  const email = clean(formData.get("email"));
  if (!name) return back("erro=" + encodeURIComponent("Informe o nome."));
  if (email && !EMAIL.test(email)) return back("erro=" + encodeURIComponent("E-mail inválido."));
  const { error } = await admin().from("leads").update({
    name,
    patient_name: clean(formData.get("patient_name")),
    email,
    insurance: clean(formData.get("insurance")),
    specialty: clean(formData.get("specialty"), 60)?.toLowerCase() ?? null,
    notes: clean(formData.get("notes"), 4000),
  }).eq("id", id);
  if (error) return back("erro=" + encodeURIComponent(error.message));
  await logEvent(id, "client_updated", { by: u.email ?? "equipe" });
  revalidatePath("/clientes");
  revalidatePath(`/clientes/${id}`);
  return back("ok=salvo");
}
