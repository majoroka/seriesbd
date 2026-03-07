-- Sprint 2 - Task 06
-- Stores proof-of-activity rows to keep the Supabase project active.

create table if not exists public.system_heartbeat (
  id bigserial primary key,
  source text not null default 'cloudflare-cron',
  status text not null default 'ok',
  details jsonb not null default '{}'::jsonb,
  triggered_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_system_heartbeat_triggered_at
  on public.system_heartbeat (triggered_at desc);

alter table public.system_heartbeat enable row level security;

revoke all on table public.system_heartbeat from anon;
revoke all on table public.system_heartbeat from authenticated;

grant select, insert on table public.system_heartbeat to service_role;
grant usage, select on sequence public.system_heartbeat_id_seq to service_role;
