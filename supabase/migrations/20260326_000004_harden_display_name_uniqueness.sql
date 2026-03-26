-- H2 - Garantia estrutural de unicidade para display_name.

create or replace function public.normalize_display_name(value text)
returns text
language sql
immutable
as $$
  select nullif(regexp_replace(trim(coalesce(value, '')), '\s+', ' ', 'g'), '');
$$;

update public.profiles
set display_name = public.normalize_display_name(display_name)
where display_name is distinct from public.normalize_display_name(display_name);

alter table public.profiles
  add column if not exists display_name_normalized text
  generated always as (
    case
      when public.normalize_display_name(display_name) is null then null
      else lower(public.normalize_display_name(display_name))
    end
  ) stored;

drop index if exists profiles_display_name_normalized_unique_idx;
create unique index if not exists profiles_display_name_normalized_unique_idx
  on public.profiles (display_name_normalized)
  where display_name_normalized is not null;

alter table public.profiles
  drop constraint if exists profiles_display_name_length_check;

alter table public.profiles
  add constraint profiles_display_name_length_check
  check (
    display_name is null
    or (
      char_length(public.normalize_display_name(display_name)) >= 3
      and char_length(public.normalize_display_name(display_name)) <= 80
    )
  );
