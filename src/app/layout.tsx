import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Clinicenter CRM", description: "Leads, conversas e agente de atendimento" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
