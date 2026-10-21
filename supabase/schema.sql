-- Clinicenter CRM — schema Supabase (rodar no SQL Editor)
-- Substitui: dados_cliente, chats, chat_messages, n8n_chat_histories, n8n_chat_histories_gerente

create extension if not exists pgcrypto;

-- ---------- Enums ----------
create type lead_stage as enum ('novo','qualificado','horario_oferecido','agendado','compareceu','perdido');
create type msg_role   as enum ('lead','ia','humano');

-- ---------- Leads ----------
create table leads (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  phone         text not null unique,            -- só dígitos, ex: 5588999999999
  name          text,                            -- nome informado no WhatsApp
  patient_name  text,                            -- nome do paciente (se diferente)
  email         text,
  specialty     text,                            -- pediatria | psiquiatria | fisioterapia | outra
  insurance     text,                            -- convênio ou 'particular'
  stage         lead_stage not null default 'novo',
  score         int check (score between 0 and 100),
  intent        text,                            -- resumo curto da intenção
  lost_reason   text,
  source        text,                            -- instagram, indicação, google...
  ai_paused_until timestamptz,                   -- IA pausada (humano assumiu)
  last_message_at timestamptz,
  last_inbound_at timestamptz
);
create index on leads (stage);
create index on leads (specialty);
create index on leads (last_message_at desc);

-- ---------- Mensagens (histórico único) ----------
create table messages (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  lead_id     uuid not null references leads(id) on delete cascade,
  role        msg_role not null,
  content     text not null,
  media_type  text,                              -- audio | image | null
  wa_id       text unique,                       -- id da mensagem no WhatsApp (idempotência)
  processed   boolean not null default false,    -- IA já respondeu a esta mensagem?
  script_version_id uuid                         -- versão do script usada (quando role = ia)
);
create index on messages (lead_id, created_at);
create index on messages (lead_id) where processed = false and role = 'lead';

-- ---------- Agendamentos ----------
create table appointments (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  lead_id       uuid not null references leads(id) on delete cascade,
  professional  text not null,
  calendar_hint text not null,
  specialty     text not null,
  starts_at     timestamptz not null,
  ends_at       timestamptz not null,
  gcal_event_id text,
  status        text not null default 'agendado'  -- agendado | cancelado | remarcado | compareceu | faltou
);
create index on appointments (lead_id);
create index on appointments (starts_at);

-- ---------- Eventos do funil (para métricas e aprendizado) ----------
create table lead_events (
  id         bigserial primary key,
  created_at timestamptz not null default now(),
  lead_id    uuid not null references leads(id) on delete cascade,
  type       text not null,                      -- stage_changed | appointment_created | human_takeover | ...
  data       jsonb not null default '{}'
);
create index on lead_events (lead_id, created_at);

-- ---------- Script de vendas versionado ----------
create table script_versions (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  version     int generated always as identity,
  status      text not null default 'proposta',  -- proposta | ativa | arquivada | rejeitada
  prompt      text not null,
  rationale   text,                              -- por que a IA propôs
  changes     jsonb not null default '[]',       -- lista de mudanças em linguagem simples
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  parent_id   uuid references script_versions(id)
);
-- só uma versão ativa por vez
create unique index one_active_script on script_versions ((status)) where status = 'ativa';

create table script_insights (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  period_start timestamptz not null,
  period_end   timestamptz not null,
  metrics     jsonb not null,                    -- conversão por etapa/especialidade
  findings    jsonb not null,                    -- padrões que converteram / perderam
  script_version_id uuid references script_versions(id)
);

-- ---------- Triggers ----------
create or replace function touch_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end $$ language plpgsql;
create trigger leads_touch before update on leads for each row execute function touch_updated_at();

create or replace function on_message_insert() returns trigger as $$
begin
  update leads set last_message_at = new.created_at,
         last_inbound_at = case when new.role = 'lead' then new.created_at else last_inbound_at end
  where id = new.lead_id;
  return new;
end $$ language plpgsql;
create trigger messages_touch_lead after insert on messages for each row execute function on_message_insert();

-- ---------- View: funil por especialidade ----------
create or replace view v_funnel with (security_invoker = true) as
select coalesce(specialty,'indefinida') as specialty, stage, count(*)::int as total
from leads group by 1,2;

-- ---------- RLS: só usuários autenticados da equipe enxergam; o agente usa service_role ----------
alter table leads           enable row level security;
alter table messages        enable row level security;
alter table appointments    enable row level security;
alter table lead_events     enable row level security;
alter table script_versions enable row level security;
alter table script_insights enable row level security;

create policy team_all on leads           for all to authenticated using (true) with check (true);
create policy team_all on messages        for all to authenticated using (true) with check (true);
create policy team_all on appointments    for all to authenticated using (true) with check (true);
create policy team_all on lead_events     for select to authenticated using (true);
create policy team_all on script_versions for all to authenticated using (true) with check (true);
create policy team_all on script_insights for select to authenticated using (true);

-- Realtime para o inbox
alter publication supabase_realtime add table messages;
alter publication supabase_realtime add table leads;
