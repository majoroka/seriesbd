-- P3 - Persist the periodic export reminder as a per-user synced setting.

alter table public.user_settings
  add column if not exists backup_reminder jsonb not null default '{
    "version": 1,
    "nextReminderAt": null,
    "lastExportedAt": null,
    "snoozedUntil": null,
    "disabled": false
  }'::jsonb;

comment on column public.user_settings.backup_reminder is
  'Estado sincronizado do lembrete periódico de exportação da biblioteca.';
