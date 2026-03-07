-- Sprint 2 - Task 04
-- Cloud sync table for per-user library snapshot.

create table if not exists public.library_snapshots (
  user_id uuid primary key references auth.users(id) on delete cascade,
  schema_version integer not null default 1,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

drop trigger if exists set_library_snapshots_updated_at on public.library_snapshots;
create trigger set_library_snapshots_updated_at
before update on public.library_snapshots
for each row
execute function public.set_updated_at();

alter table public.library_snapshots enable row level security;

drop policy if exists "library_snapshots_select_own" on public.library_snapshots;
create policy "library_snapshots_select_own"
on public.library_snapshots
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "library_snapshots_insert_own" on public.library_snapshots;
create policy "library_snapshots_insert_own"
on public.library_snapshots
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "library_snapshots_update_own" on public.library_snapshots;
create policy "library_snapshots_update_own"
on public.library_snapshots
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

revoke all on table public.library_snapshots from anon;
grant select, insert, update on table public.library_snapshots to authenticated;
