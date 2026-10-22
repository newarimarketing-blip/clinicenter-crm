-- 002 — Lembrete e confirmação de consulta (função 1)
-- Rodar no Supabase > SQL Editor. Idempotente (pode rodar mais de uma vez).
-- reminder_sent_at: quando a Marcelia enviou o lembrete (evita enviar duas vezes).
-- confirmed_at: quando o paciente confirmou presença.
alter table appointments add column if not exists reminder_sent_at timestamptz;
alter table appointments add column if not exists confirmed_at timestamptz;
create index if not exists appointments_reminder_idx on appointments (starts_at) where status = 'agendado' and reminder_sent_at is null;
