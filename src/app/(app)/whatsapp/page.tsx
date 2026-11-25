import { redirect } from "next/navigation";

export default function WhatsApp() {
  redirect("/configuracoes?aba=whatsapp");
}
