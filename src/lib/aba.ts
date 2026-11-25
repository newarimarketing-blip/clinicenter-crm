import { headers } from "next/headers";
import { redirect } from "next/navigation";

/** Volta para a página mantendo a aba em que o usuário estava (lida do endereço de origem). */
export async function backTo(base: string, q: string): Promise<never> {
  let aba = "";
  try {
    const ref = (await headers()).get("referer");
    if (ref) aba = new URL(ref).searchParams.get("aba") ?? "";
  } catch {}
  return redirect(`${base}?${aba ? `aba=${encodeURIComponent(aba)}&` : ""}${q}`);
}
