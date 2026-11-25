-- 008 — Lista de espera de horários
-- Rodar no Supabase > SQL Editor. Idempotente (pode rodar mais de uma vez).
-- Quando o paciente quer um horário que não existe, o pedido fica aqui. Se uma vaga abrir
-- (cancelamento/remarcação), a Marcelia avisa o 1º da fila e espera a resposta.

create table if not exists waitlist (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  lead_id          uuid not null references leads(id) on delete cascade,
  professional_key text not null,
  periodo          text check (periodo in ('manha','tarde','noite')),          -- null = qualquer período
  dia_semana       text check (dia_semana in ('segunda','terca','quarta','quinta','sexta','sabado')), -- null = qualquer dia
  status           text not null default 'aguardando',                          -- aguardando | oferecido | agendado | cancelado
  offered_starts_at timestamptz,                                                -- vaga oferecida agora
  offered_at       timestamptz,
  declined         jsonb not null default '[]'::jsonb,                          -- vagas já oferecidas e não aceitas
  note             text
);
create index if not exists waitlist_prof_status on waitlist (professional_key, status, created_at);
create index if not exists waitlist_lead on waitlist (lead_id);

alter table waitlist enable row level security;
drop policy if exists team_read on waitlist;
create policy team_read on waitlist for select to authenticated using (true);
drop policy if exists team_write on waitlist;
create policy team_write on waitlist for all to authenticated using (true) with check (true);
