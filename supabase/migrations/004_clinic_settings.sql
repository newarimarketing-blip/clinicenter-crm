-- 004 — Configurações editáveis pela recepção: preços, grades de horários e convênios (função 4)
-- Rodar no Supabase > SQL Editor. Idempotente.
-- Cada linha guarda uma seção: 'prices', 'insurance' ou 'professionals' (JSON).
-- Sem linha = o sistema usa os valores padrão de src/lib/clinic-config.ts (fallback).
create table if not exists clinic_settings (
  key        text primary key check (key in ('prices','insurance','professionals')),
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);
alter table clinic_settings enable row level security;
drop policy if exists team_all on clinic_settings;
create policy team_all on clinic_settings for all to authenticated using (true) with check (true);
