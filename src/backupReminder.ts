export const BACKUP_REMINDER_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
export const BACKUP_REMINDER_SNOOZE_MS = 24 * 60 * 60 * 1000;

export type BackupReminderState = {
  version: 1;
  nextReminderAt: string;
  lastExportedAt: string | null;
  snoozedUntil: string | null;
  disabled: boolean;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function validIsoDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return Number.isNaN(Date.parse(value)) ? null : value;
}

function normalizeBoolean(value: unknown): boolean {
  return value === true || value === 'true';
}

function toIso(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

export function createBackupReminderState(now: number = Date.now()): BackupReminderState {
  return {
    version: 1,
    nextReminderAt: toIso(now + BACKUP_REMINDER_INTERVAL_MS),
    lastExportedAt: null,
    snoozedUntil: null,
    disabled: false,
  };
}

export function normalizeBackupReminderState(
  value: unknown,
  now: number = Date.now(),
): BackupReminderState {
  const record = asRecord(value);
  const lastExportedAt = validIsoDate(record?.lastExportedAt);
  const nextReminderAt = validIsoDate(record?.nextReminderAt)
    ?? toIso((lastExportedAt ? Date.parse(lastExportedAt) : now) + BACKUP_REMINDER_INTERVAL_MS);

  return {
    version: 1,
    nextReminderAt,
    lastExportedAt,
    snoozedUntil: validIsoDate(record?.snoozedUntil),
    disabled: normalizeBoolean(record?.disabled),
  };
}

export function needsBackupReminderInitialization(value: unknown): boolean {
  const record = asRecord(value);
  return !validIsoDate(record?.nextReminderAt);
}

export function isBackupReminderDue(state: BackupReminderState, now: number = Date.now()): boolean {
  if (state.disabled) return false;
  if (now < Date.parse(state.nextReminderAt)) return false;
  return !state.snoozedUntil || now >= Date.parse(state.snoozedUntil);
}

export function markBackupExported(state: BackupReminderState, now: number = Date.now()): BackupReminderState {
  return {
    ...state,
    lastExportedAt: toIso(now),
    nextReminderAt: toIso(now + BACKUP_REMINDER_INTERVAL_MS),
    snoozedUntil: null,
  };
}

export function postponeBackupReminder(state: BackupReminderState, now: number = Date.now()): BackupReminderState {
  return {
    ...state,
    snoozedUntil: toIso(now + BACKUP_REMINDER_SNOOZE_MS),
  };
}

export function disableBackupReminder(state: BackupReminderState): BackupReminderState {
  return {
    ...state,
    disabled: true,
    snoozedUntil: null,
  };
}

export function getBackupReminderNotificationId(state: BackupReminderState): string {
  return `backup-reminder:${state.nextReminderAt.slice(0, 10)}`;
}
