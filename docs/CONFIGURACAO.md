# Configuração — status e o que falta

## Feito
- Organização **Clinicenter** (plano gratuito) e projeto **clinicenter-crm** no Supabase (região us-east-1).
- Schema executado e conferido: `leads`, `messages`, `appointments`, `lead_events`, `script_versions`, `script_insights` e a view `v_funnel`. RLS ligado em todas as tabelas.
- URL do projeto: `https://xxcjsvsjeqbfeveiregx.supabase.co`

## Falta (envolve segredos: faça você, ou me chame quando estiver com cada painel aberto)
1. **Usuários da equipe:** Supabase > Authentication > Users > Add user (e-mail e senha de cada pessoa que usará o CRM).
2. **Código no GitHub:** suba a pasta do projeto para um repositório (privado) e importe na Vercel.
3. **Variáveis na Vercel:** importe `.env.vercel.template` e preencha os campos vazios (chaves do Supabase, OpenAI, Evolution, Google).
4. **Google Calendar:** console.cloud.google.com > crie um projeto > ative a *Google Calendar API* > IAM > Service Accounts > crie uma conta > Keys > Add key (JSON). Converta para base64 (`base64 -w0 arquivo.json`) e cole em `GOOGLE_SERVICE_ACCOUNT_B64`. Depois, em cada uma das 4 agendas (Google Calendar > Configurações da agenda > Compartilhar com pessoas), adicione o e-mail da service account com permissão **Fazer alterações em eventos**.
5. **Evolution API:** na instância `clinicenter`, webhook = `https://SEU-APP.vercel.app/api/webhook/evolution?secret=<WEBHOOK_SECRET>`, evento `MESSAGES_UPSERT`.
6. **Teste:** mande "oi" de outro número, confira a resposta em menos de 15 s e o lead no CRM.
