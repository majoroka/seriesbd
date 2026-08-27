import { describe, expect, it } from 'vitest';
import {
  BACKUP_REMINDER_INTERVAL_MS,
  BACKUP_REMINDER_SNOOZE_MS,
  createBackupReminderState,
  disableBackupReminder,
  isBackupReminderDue,
  markBackupExported,
  normalizeBackupReminderState,
  postponeBackupReminder,
} from './backupReminder';

const NOW = Date.parse('2026-08-27T12:00:00.000Z');

describe('backup reminder', () => {
  it('starts the first reminder seven days after initialization', () => {
    const state = createBackupReminderState(NOW);

    expect(isBackupReminderDue(state, NOW + BACKUP_REMINDER_INTERVAL_MS - 1)).toBe(false);
    expect(isBackupReminderDue(state, NOW + BACKUP_REMINDER_INTERVAL_MS)).toBe(true);
  });

  it('resets the cycle only after a successful export', () => {
    const dueState = normalizeBackupReminderState({ nextReminderAt: '2026-08-20T12:00:00.000Z' }, NOW);
    const exported = markBackupExported(dueState, NOW);

    expect(exported.lastExportedAt).toBe('2026-08-27T12:00:00.000Z');
    expect(exported.snoozedUntil).toBeNull();
    expect(isBackupReminderDue(exported, NOW + BACKUP_REMINDER_INTERVAL_MS - 1)).toBe(false);
    expect(isBackupReminderDue(exported, NOW + BACKUP_REMINDER_INTERVAL_MS)).toBe(true);
  });

  it('snoozes a due reminder for one day', () => {
    const dueState = normalizeBackupReminderState({ nextReminderAt: '2026-08-20T12:00:00.000Z' }, NOW);
    const postponed = postponeBackupReminder(dueState, NOW);

    expect(isBackupReminderDue(postponed, NOW + BACKUP_REMINDER_SNOOZE_MS - 1)).toBe(false);
    expect(isBackupReminderDue(postponed, NOW + BACKUP_REMINDER_SNOOZE_MS)).toBe(true);
  });

  it('does not show a disabled reminder', () => {
    const dueState = normalizeBackupReminderState({ nextReminderAt: '2026-08-20T12:00:00.000Z' }, NOW);

    expect(isBackupReminderDue(disableBackupReminder(dueState), NOW)).toBe(false);
  });
});
