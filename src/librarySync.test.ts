import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Series } from './types';
import { MAX_USER_NOTES_LENGTH } from './dataGuards';

const mocked = vi.hoisted(() => {
  const db = {
    watchlist: {
      clear: vi.fn(),
      bulkPut: vi.fn(),
    },
    archive: {
      clear: vi.fn(),
      bulkPut: vi.fn(),
    },
    watchedState: {
      clear: vi.fn(),
      bulkPut: vi.fn(),
    },
    userData: {
      clear: vi.fn(),
      bulkPut: vi.fn(),
    },
    kvStore: {
      put: vi.fn(),
      get: vi.fn(),
    },
    transaction: vi.fn(async (...args: unknown[]) => {
      const callback = args.at(-1);
      if (typeof callback !== 'function') {
        throw new Error('Missing transaction callback');
      }
      return callback();
    }),
  };

  return { db };
});

vi.mock('./db', () => ({
  db: mocked.db,
}));

vi.mock('./ui', () => ({
  showNotification: vi.fn(),
}));

vi.mock('./supabase', () => ({
  isSupabaseConfigured: vi.fn(() => false),
  getSupabaseClient: vi.fn(),
}));

import { applyRemoteLibrarySnapshotToLocal } from './librarySync';

function makeBook(id: number, name: string): Series {
  return {
    id,
    media_type: 'book',
    name,
    overview: `${name} overview`,
    poster_path: null,
    backdrop_path: null,
    first_air_date: '2020-01-01',
    genres: [],
  };
}

describe('library snapshot restore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.db.watchlist.clear.mockResolvedValue(undefined);
    mocked.db.archive.clear.mockResolvedValue(undefined);
    mocked.db.watchedState.clear.mockResolvedValue(undefined);
    mocked.db.userData.clear.mockResolvedValue(undefined);
    mocked.db.watchlist.bulkPut.mockResolvedValue(undefined);
    mocked.db.archive.bulkPut.mockResolvedValue(undefined);
    mocked.db.watchedState.bulkPut.mockResolvedValue(undefined);
    mocked.db.userData.bulkPut.mockResolvedValue(undefined);
    mocked.db.kvStore.put.mockResolvedValue(undefined);
  });

  it('restores book progress_percent from remote snapshot userData', async () => {
    const remoteUpdatedAtIso = '2026-03-19T10:00:00.000Z';

    await applyRemoteLibrarySnapshotToLocal(
      {
        version: 2,
        generatedAt: remoteUpdatedAtIso,
        watchlist: [makeBook(123, 'Book Progress')],
        archive: [],
        watchedState: {},
        userData: {
          'book:123': {
            rating: 0,
            notes: 'reading',
            progress_percent: 67,
          },
        },
      },
      remoteUpdatedAtIso,
    );

    expect(mocked.db.userData.bulkPut).toHaveBeenCalledWith([
      expect.objectContaining({
        media_key: 'book:123',
        media_type: 'book',
        media_id: 123,
        notes: 'reading',
        progress_percent: 67,
      }),
    ]);
    expect(mocked.db.kvStore.put).toHaveBeenCalledWith({
      key: 'seriesdb.localLibraryMutationAt',
      value: remoteUpdatedAtIso,
    });
  });

  it('sanitizes remote snapshot notes and progress values', async () => {
    const remoteUpdatedAtIso = '2026-03-19T10:00:00.000Z';
    const longNotes = 'x'.repeat(MAX_USER_NOTES_LENGTH + 100);

    await applyRemoteLibrarySnapshotToLocal(
      {
        version: 2,
        generatedAt: remoteUpdatedAtIso,
        watchlist: [makeBook(456, 'Book Sanitized')],
        archive: [],
        watchedState: {},
        userData: {
          'book:456': {
            rating: 7,
            notes: longNotes,
            progress_percent: 999,
          },
        },
      },
      remoteUpdatedAtIso,
    );

    expect(mocked.db.userData.bulkPut).toHaveBeenCalledWith([
      expect.objectContaining({
        media_key: 'book:456',
        notes: 'x'.repeat(MAX_USER_NOTES_LENGTH),
        progress_percent: 100,
      }),
    ]);
  });
});
