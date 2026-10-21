# Clinicenter — CRM + agente de atendimento (Next.js + Supabase + Vercel)

Substitui o fluxo n8n "Agendamento Inteligente". Diagnóstico completo em `docs/DIAGNOSTICO.md`.

## O que tem aqui
- `src/app/api/webhook/evolution`: recebe o WhatsApp (Evolution API), agrupa mensagens picotadas (6 s) e roda o agente.
- `src/lib/agent.ts`: **uma** chamada de LLM por rodada, com ferramentas para consultar horários, agendar, cancelar, reagendar, atualizar o lead (especialidade, etapa e score) e passar para humano.
- `src/lib/clinic-config.ts`: profissionais, grades, preços e convênios (fonte única; confirmar com a clínica).
- `src/lib/default-script.ts`: script de vendas inicial. É a única parte que o aprendizado reescreve.
- `src/lib/learn.ts` e `/api/cron/learn`: toda segunda a IA analisa a semana e **propõe** um novo script; você aprova em `/script`.
- CRM: Painel, Funil (kanban por etapa e especialidade), Conversas (tempo real, assumir/devolver para a IA) e Script da IA.

## Colocar no ar
1. **Supabase:** crie um projeto, rode `supabase/schema.sql` no SQL Editor e crie os usuários da equipe em Authentication.
2. **Variáveis:** copie `.env.example` para `.env.local` (e configure as mesmas na Vercel).
3. **Vercel:** importe o projeto. O cron semanal já está em `vercel.json` (defina `CRON_SECRET`).
4. **Evolution API:** aponte o webhook da instância para `https://SEU-APP.vercel.app/api/webhook/evolution?secret=SEU_WEBHOOK_SECRET`, evento `MESSAGES_UPSERT`. Desligue o workflow n8n antigo para não responder em duplicidade.
5. **Google Calendar:** crie uma service account, compartilhe cada agenda com o e-mail dela e preencha `GOOGLE_SERVICE_ACCOUNT_B64` e `CAL_*`. Sem isso, a disponibilidade usa só os agendamentos do sistema.
6. Sem as variáveis do Supabase, o CRM abre em **modo demonstração** com dados fictícios (`npm install && npm run dev`).

## Comportamento importante
- Se a equipe responde pelo celular da clínica, a IA pausa por 12 h. Para devolver, envie "Atendimento finalizado" ou use o botão no CRM.
- O modelo nunca escolhe horário sozinho: `agendar_consulta` revalida o horário contra a agenda antes de criar.
- O aprendizado exige pelo menos 15 leads na semana e nunca altera preços, horários ou endereço.
