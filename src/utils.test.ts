import { describe, it, expect } from 'vitest';
import { formatDuration, getTranslatedSeasonName, formatDate } from './utils';

describe('formatDuration', () => {
  it('should format 0 minutes correctly', () => {
    expect(formatDuration(0)).toBe('0min');
    expect(formatDuration(-10)).toBe('0min');
  });

  it('should format less than an hour correctly', () => {
    expect(formatDuration(45)).toBe('45min');
  });

  it('should format exact hours correctly', () => {
    expect(formatDuration(120)).toBe('2h');
  });

  it('should format hours and minutes correctly', () => {
    expect(formatDuration(125)).toBe('2h 5min');
  });

  it('should format large durations with days, hours and minutes', () => {
    // 2 days, 3 hours, 30 minutes = (2 * 24 * 60) + (3 * 60) + 30 = 3090
    expect(formatDuration(3090)).toBe('2d 3h 30min');
  });
});

describe('getTranslatedSeasonName', () => {
    it('should return "Especiais" for "specials"', () => {
        expect(getTranslatedSeasonName('specials', 0)).toBe('Especiais');
    });

    it('should return "Temporada X" for "Season X"', () => {
        expect(getTranslatedSeasonName('Season 1', 1)).toBe('Temporada 1');
    });

    it('should return the original name if not a special case', () => {
        expect(getTranslatedSeasonName('The Minisodes', 1)).toBe('The Minisodes');
    });
});

describe('formatDate', () => {
    it('should format a valid date string', () => {
        expect(formatDate('2025-09-23T12:00:00Z')).toBe('23/09/2025');
    });

    it('should format a valid Date object', () => {
        const date = new Date('2025-10-31T12:00:00Z');
        expect(formatDate(date)).toBe('31/10/2025');
    });

    it('should return an empty string for an invalid date string', () => {
        expect(formatDate('not a date')).toBe('');
    });

    it('should return an empty string for null or undefined input', () => {
        expect(formatDate(null as any)).toBe('');
        expect(formatDate(undefined as any)).toBe('');
    });

    it('should use custom formatting options', () => {
        const options: Intl.DateTimeFormatOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        expect(formatDate('2025-12-25T00:00:00Z', 'pt-PT', options)).toBe('quinta-feira, 25 de dezembro de 2025');
    });
});
