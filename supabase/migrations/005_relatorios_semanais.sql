-- 005 — Relatório semanal automático para o cliente (função 5)
-- Rodar no Supabase > SQL Editor. Idempotente.
-- Um relatório por semana (segunda 00:00 a segunda 00:00, fuso de Fortaleza). A equipe só lê; quem grava é o servidor (service_role).
create table if not exists weekly_reports (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  period_start timestamptz not null unique,
  period_end   timestamptz not null,
  metrics      jsonb not null,
  summary      text not null
);
alter table weekly_reports enable row level security;
drop policy if exists team_read on weekly_reports;
create policy team_read on weekly_reports for select to authenticated using (true);
