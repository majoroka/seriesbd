-- H6
-- Harden server-side governance for library snapshots.

create or replace function public.is_valid_library_snapshot_payload(payload jsonb)
returns boolean
language sql
immutable
as $$
  select
    jsonb_typeof(payload) = 'object'
    and payload ? 'version'
    and jsonb_typeof(payload -> 'version') = 'number'
    and payload ? 'generatedAt'
    and jsonb_typeof(payload -> 'generatedAt') = 'string'
    and payload ? 'watchlist'
    and jsonb_typeof(payload -> 'watchlist') = 'array'
    and payload ? 'archive'
    and jsonb_typeof(payload -> 'archive') = 'array'
    and payload ? 'watchedState'
    and jsonb_typeof(payload -> 'watchedState') = 'object'
    and payload ? 'userData'
    and jsonb_typeof(payload -> 'userData') = 'object'
$$;

alter table public.library_snapshots
  drop constraint if exists library_snapshots_schema_version_check;

alter table public.library_snapshots
  add constraint library_snapshots_schema_version_check
  check (schema_version >= 1 and schema_version <= 10);

alter table public.library_snapshots
  drop constraint if exists library_snapshots_payload_type_check;

alter table public.library_snapshots
  add constraint library_snapshots_payload_type_check
  check (public.is_valid_library_snapshot_payload(payload));

alter table public.library_snapshots
  drop constraint if exists library_snapshots_payload_size_check;

alter table public.library_snapshots
  add constraint library_snapshots_payload_size_check
  check (octet_length(payload::text) <= 4194304);

create or replace function public.upsert_library_snapshot(
  p_schema_version integer,
  p_payload jsonb
)
returns public.library_snapshots
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_result public.library_snapshots;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'Sessão autenticada obrigatória para guardar snapshot.'
      using errcode = '42501';
  end if;

  insert into public.library_snapshots (user_id, schema_version, payload)
  values (v_user_id, p_schema_version, p_payload)
  on conflict (user_id) do update
    set schema_version = excluded.schema_version,
        payload = excluded.payload
  returning * into v_result;

  return v_result;
end;
$$;

revoke insert, update, delete on table public.library_snapshots from authenticated;
grant select on table public.library_snapshots to authenticated;

revoke all on function public.upsert_library_snapshot(integer, jsonb) from public;
grant execute on function public.upsert_library_snapshot(integer, jsonb) to authenticated;
