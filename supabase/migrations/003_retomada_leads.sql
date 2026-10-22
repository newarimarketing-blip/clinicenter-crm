-- 003 — Retomada automática de lead que sumiu (função 2)
-- Rodar no Supabase > SQL Editor. Idempotente.
-- followup_count: quantas retomadas já foram enviadas desde a última mensagem do paciente (máx. 2; volta a 0 quando ele responde).
-- last_followup_at: quando saiu a última retomada.
alter table leads add column if not exists followup_count int not null default 0;
alter table leads add column if not exists last_followup_at timestamptz;
