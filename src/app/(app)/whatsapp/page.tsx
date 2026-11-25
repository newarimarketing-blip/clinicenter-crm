import { WhatsAppConnect } from "@/components/WhatsAppConnect";

export const dynamic = "force-dynamic";

export default function WhatsApp() {
  return (
    <div className="max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">WhatsApp</h1>
        <p className="text-sm text-muted">Conecte o número da clínica à Marcelia. Ao gerar o QR Code, o sistema também aponta o webhook da Evolution para este portal.</p>
      </header>
      <WhatsAppConnect />
      <p className="text-xs text-muted">Use o número do WhatsApp (ou WhatsApp Business) da clínica. Se trocar de número, desconecte e gere um novo QR Code.</p>
    </div>
  );
}
