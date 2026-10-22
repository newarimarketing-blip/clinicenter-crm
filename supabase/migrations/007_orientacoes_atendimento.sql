-- 007 — Orientações de atendimento por profissional e por serviço (o que a Marcelia sabe dizer)
-- Rodar no Supabase > SQL Editor. Idempotente.
alter table professionals add column if not exists guidance text;
alter table services add column if not exists guidance text;
