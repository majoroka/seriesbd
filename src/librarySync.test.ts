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

  const supabaseClient = {
    from: vi.fn(),
    rpc: vi.fn(),
  };

  return { db, supabaseClient };
});

vi.mock('./db', () => ({
  db: mocked.db,
}));

vi.mock('./ui', () => ({
  showNotification: vi.fn(),
}));

vi.mock('./supabase', () => ({
  isSupabaseConfigured: vi.fn(() => false),
  getSupabaseClient: vi.fn(() => mocked.supabaseClient),
}));

import * as S from './state';
import {
  applyRemoteLibrarySnapshotToLocal,
  clearPendingLibrarySyncConflict,
  getPendingLibrarySyncConflict,
  pushLocalLibrarySnapshot,
  resolvePendingLibrarySyncConflict,
  syncLibrarySnapshotAfterLogin,
} from './librarySync';
import { getSupabaseClient, isSupabaseConfigured } from './supabase';

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
    mocked.supabaseClient.rpc.mockResolvedValue({ error: null });
    mocked.supabaseClient.from.mockReset();
    vi.mocked(isSupabaseConfigured).mockReturnValue(false);
    S.setMyWatchlist([]);
    S.setMyArchive([]);
    S.setWatchedState({});
    S.setUserData({});
    mocked.db.kvStore.get.mockResolvedValue(null);
    clearPendingLibrarySyncConflict();
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

  it('pushes local snapshot through RPC when Supabase is configured', async () => {
    vi.mocked(isSupabaseConfigured).mockReturnValue(true);
    vi.mocked(getSupabaseClient).mockReturnValue(mocked.supabaseClient as any);

    S.setMyWatchlist([makeBook(789, 'Book RPC')]);
    S.setMyArchive([]);
    S.setWatchedState({});
    S.setUserData({
      'book:789': {
        rating: 8,
        notes: 'rpc test',
        progress_percent: 34,
      },
    });

    await pushLocalLibrarySnapshot('user-id-ignored-by-rpc');

    expect(mocked.supabaseClient.rpc).toHaveBeenCalledWith(
      'upsert_library_snapshot',
      expect.objectContaining({
        p_schema_version: 2,
        p_payload: expect.objectContaining({
          version: 2,
          watchlist: [expect.objectContaining({ id: 789, media_type: 'book' })],
          userData: expect.objectContaining({
            'book:789': expect.objectContaining({
              rating: 8,
              notes: 'rpc test',
              progress_percent: 34,
            }),
          }),
        }),
      }),
    );
  });

  it('flags a conflict when the remote snapshot is much richer than local', async () => {
    vi.mocked(isSupabaseConfigured).mockReturnValue(true);
    vi.mocked(getSupabaseClient).mockReturnValue(mocked.supabaseClient as any);

    S.setMyWatchlist([makeBook(1, 'Only Local Item')]);
    mocked.db.kvStore.get.mockResolvedValue({
      key: 'seriesdb.localLibraryMutationAt',
      value: '2026-05-23T21:06:49.960Z',
    });

    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        user_id: 'user-1',
        schema_version: 2,
        updated_at: '2026-05-24T22:15:34.689Z',
        payload: {
          version: 2,
          generatedAt: '2026-05-24T22:15:34.689Z',
          watchlist: Array.from({ length: 52 }, (_, index) => makeBook(1000 + index, `Watch ${index}`)),
          archive: Array.from({ length: 157 }, (_, index) => makeBook(2000 + index, `Archive ${index}`)),
          watchedState: {
            'book:1000': [1],
            'book:1001': [1],
          },
          userData: {
            'book:1000': { rating: 8, notes: 'a', progress_percent: 100 },
          },
        },
      },
      error: null,
    });

    const eq = vi.fn(() => ({ maybeSingle }));
    const select = vi.fn(() => ({ eq }));
    mocked.supabaseClient.from.mockReturnValue({ select });

    const outcome = await syncLibrarySnapshotAfterLogin('user-1');

    expect(outcome).toBe('conflict_remote_richer');
    expect(getPendingLibrarySyncConflict()).toEqual(
      expect.objectContaining({
        userId: 'user-1',
        localCounts: expect.objectContaining({ totalItemCount: 1 }),
        remoteCounts: expect.objectContaining({ totalItemCount: 209 }),
      }),
    );
    expect(mocked.supabaseClient.rpc).not.toHaveBeenCalled();
    expect(mocked.db.watchlist.clear).not.toHaveBeenCalled();
  });

  it('flags a conflict when the local snapshot is much richer than remote', async () => {
    vi.mocked(isSupabaseConfigured).mockReturnValue(true);
    vi.mocked(getSupabaseClient).mockReturnValue(mocked.supabaseClient as any);

    S.setMyWatchlist(Array.from({ length: 40 }, (_, index) => makeBook(3000 + index, `Local ${index}`)));
    S.setMyArchive(Array.from({ length: 30 }, (_, index) => makeBook(4000 + index, `Local Archive ${index}`)));
    mocked.db.kvStore.get.mockResolvedValue({
      key: 'seriesdb.localLibraryMutationAt',
      value: '2026-05-25T10:00:00.000Z',
    });

    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        user_id: 'user-2',
        schema_version: 2,
        updated_at: '2026-05-24T22:15:34.689Z',
        payload: {
          version: 2,
          generatedAt: '2026-05-24T22:15:34.689Z',
          watchlist: [makeBook(9, 'Remote Only')],
          archive: [],
          watchedState: {},
          userData: {},
        },
      },
      error: null,
    });

    const eq = vi.fn(() => ({ maybeSingle }));
    const select = vi.fn(() => ({ eq }));
    mocked.supabaseClient.from.mockReturnValue({ select });

    const outcome = await syncLibrarySnapshotAfterLogin('user-2');

    expect(outcome).toBe('conflict_local_richer');
    expect(getPendingLibrarySyncConflict()).toEqual(
      expect.objectContaining({
        userId: 'user-2',
        localCounts: expect.objectContaining({ totalItemCount: 70 }),
        remoteCounts: expect.objectContaining({ totalItemCount: 1 }),
      }),
    );
    expect(mocked.supabaseClient.rpc).not.toHaveBeenCalled();
  });

  it('resolves a pending remote-richer conflict by pulling remote data', async () => {
    vi.mocked(isSupabaseConfigured).mockReturnValue(true);
    vi.mocked(getSupabaseClient).mockReturnValue(mocked.supabaseClient as any);

    S.setMyWatchlist([makeBook(1, 'Only Local Item')]);
    mocked.db.kvStore.get.mockResolvedValue({
      key: 'seriesdb.localLibraryMutationAt',
      value: '2026-05-23T21:06:49.960Z',
    });

    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        user_id: 'user-3',
        schema_version: 2,
        updated_at: '2026-05-24T22:15:34.689Z',
        payload: {
          version: 2,
          generatedAt: '2026-05-24T22:15:34.689Z',
          watchlist: Array.from({ length: 18 }, (_, index) => makeBook(5000 + index, `Remote Book ${index}`)),
          archive: Array.from({ length: 12 }, (_, index) => makeBook(5100 + index, `Remote Archive ${index}`)),
          watchedState: {},
          userData: {},
        },
      },
      error: null,
    });

    const eq = vi.fn(() => ({ maybeSingle }));
    const select = vi.fn(() => ({ eq }));
    mocked.supabaseClient.from.mockReturnValue({ select });

    const outcome = await syncLibrarySnapshotAfterLogin('user-3');
    expect(outcome).toBe('conflict_remote_richer');

    const resolved = await resolvePendingLibrarySyncConflict('use_remote');

    expect(resolved).toBe('pulled');
    expect(mocked.db.watchlist.clear).toHaveBeenCalled();
    expect(mocked.db.watchlist.bulkPut).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: 5000 })]),
    );
    expect(getPendingLibrarySyncConflict()).toBeNull();
  });

  it('resolves a pending local-richer conflict by pushing local data', async () => {
    vi.mocked(isSupabaseConfigured).mockReturnValue(true);
    vi.mocked(getSupabaseClient).mockReturnValue(mocked.supabaseClient as any);

    S.setMyWatchlist(Array.from({ length: 25 }, (_, index) => makeBook(6000 + index, `Push ${index}`)));
    mocked.db.kvStore.get.mockResolvedValue({
      key: 'seriesdb.localLibraryMutationAt',
      value: '2026-05-25T10:00:00.000Z',
    });

    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        user_id: 'user-4',
        schema_version: 2,
        updated_at: '2026-05-24T22:15:34.689Z',
        payload: {
          version: 2,
          generatedAt: '2026-05-24T22:15:34.689Z',
          watchlist: [makeBook(9, 'Remote Only')],
          archive: [],
          watchedState: {},
          userData: {},
        },
      },
      error: null,
    });

    const eq = vi.fn(() => ({ maybeSingle }));
    const select = vi.fn(() => ({ eq }));
    mocked.supabaseClient.from.mockReturnValue({ select });

    const outcome = await syncLibrarySnapshotAfterLogin('user-4');
    expect(outcome).toBe('conflict_local_richer');

    const resolved = await resolvePendingLibrarySyncConflict('use_local');

    expect(resolved).toBe('pushed');
    expect(mocked.supabaseClient.rpc).toHaveBeenCalledWith(
      'upsert_library_snapshot',
      expect.objectContaining({
        p_schema_version: 2,
        p_payload: expect.objectContaining({
          watchlist: expect.arrayContaining([expect.objectContaining({ id: 6000 })]),
        }),
      }),
    );
    expect(getPendingLibrarySyncConflict()).toBeNull();
  });
});
