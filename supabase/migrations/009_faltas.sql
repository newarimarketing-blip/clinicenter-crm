-- Faltas de profissionais: bloqueiam o dia na agenda e registram quem foi avisado.
create table if not exists professional_absences (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  professional_key text not null,
  starts_on        date not null,
  ends_on          date not null,
  reason           text,
  affected         int not null default 0,   -- consultas que estavam marcadas
  notified         int not null default 0,   -- clientes avisados por WhatsApp
  created_by       text
);
create index if not exists absences_prof on professional_absences (professional_key, starts_on, ends_on);

alter table professional_absences enable row level security;
drop policy if exists team_read on professional_absences;
create policy team_read on professional_absences for select to authenticated using (true);
drop policy if exists team_write on professional_absences;
create policy team_write on professional_absences for all to authenticated using (true) with check (true);
