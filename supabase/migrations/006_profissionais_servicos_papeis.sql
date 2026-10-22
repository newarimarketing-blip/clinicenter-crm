-- 006 — Cadastro de profissionais/serviços, papéis (gestor/recepção) e ficha do lead
-- Rodar no Supabase > SQL Editor. Idempotente (pode rodar mais de uma vez).

-- Profissionais: passam a ser editáveis no CRM. calendar_id vazio = usa a env CAL_* do código (profissionais antigos).
create table if not exists professionals (
  key             text primary key,
  name            text not null,
  specialty       text not null,
  slot_min        int  not null default 30 check (slot_min between 10 and 180),
  particular_only boolean not null default false,
  schedule        jsonb not null default '{}'::jsonb,   -- {"1":[["15:00","17:00"]]} (0=domingo)
  calendar_id     text,
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);
alter table professionals enable row level security;
drop policy if exists team_read on professionals;
create policy team_read on professionals for select to authenticated using (true);

insert into professionals (key, name, specialty, slot_min, particular_only, schedule) values
  ('priscilla', 'Dra. Priscilla Grangeiro', 'pediatria',   30, false, '{"1":[["15:00","17:00"]]}'),
  ('maraysa',   'Dra. Maraysa Lima',        'psiquiatria', 30, false, '{"1":[["14:00","17:00"]]}'),
  ('fernanda',  'Dra. Fernanda Sampaio',    'psiquiatria', 45, false, '{"6":[["08:00","12:00"]]}'),
  ('gledson',   'Dr. Gledson',              'fisioterapia',60, true,  '{"1":[["16:00","18:00"]],"3":[["14:00","17:00"]],"5":[["14:00","17:00"]]}')
on conflict (key) do nothing;

-- Serviços e valores (a Marcelia só fala os preços cadastrados aqui).
create table if not exists services (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  specialty        text,
  professional_key text,
  price            text not null,          -- como a Marcelia deve falar: "R$ 220,00"
  note             text,                   -- ex.: "Unimed: R$ 150,00 mediante carteirinha"
  particular_only  boolean not null default false,
  active           boolean not null default true,
  sort             int not null default 0,
  created_at       timestamptz not null default now()
);
alter table services enable row level security;
drop policy if exists team_read on services;
create policy team_read on services for select to authenticated using (true);

insert into services (name, specialty, professional_key, price, note, particular_only, sort)
select * from (values
  ('Fisioterapia convencional', 'fisioterapia', 'gledson', 'R$ 95,00',  'somente particular', true,  1),
  ('Osteopatia / RPG',          'fisioterapia', 'gledson', 'R$ 150,00', 'somente particular', true,  2),
  ('Consulta de pediatria',     'pediatria',    null,      'R$ 220,00', null,                 false, 3),
  ('Consulta de psiquiatria',   'psiquiatria',  null,      'R$ 320,00', 'Unimed: R$ 150,00 mediante carteirinha', false, 4)
) as v(name, specialty, professional_key, price, note, particular_only, sort)
where not exists (select 1 from services);

-- Papéis: gestor edita configurações; recepção só visualiza. Sem linha = recepção.
create table if not exists user_roles (
  email      text primary key,
  role       text not null check (role in ('gestor','recepcao')),
  created_at timestamptz not null default now()
);
alter table user_roles enable row level security;
drop policy if exists team_read on user_roles;
create policy team_read on user_roles for select to authenticated using (true);

-- Quem já tinha acesso continua gestor (ninguém perde o acesso); novos usuários entram como recepção.
insert into user_roles (email, role)
select lower(email), 'gestor' from auth.users where email is not null
on conflict (email) do nothing;
insert into user_roles (email, role) values ('gledsonfds@gmail.com', 'gestor') on conflict (email) do nothing;

-- Ficha do lead: resumo (IA) e notas internas.
alter table leads add column if not exists summary text;
alter table leads add column if not exists summary_at timestamptz;
alter table leads add column if not exists notes text;
