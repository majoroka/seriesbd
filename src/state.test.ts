import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as C from './constants';
import type { Series, UserDataItem, WatchedStateItem } from './types';

const mocked = vi.hoisted(() => {
  const showNotification = vi.fn();

  const db = {
    watchlist: {
      toArray: vi.fn(),
      bulkPut: vi.fn(),
      clear: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
    },
    archive: {
      toArray: vi.fn(),
      bulkPut: vi.fn(),
      clear: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
    },
    watchedState: {
      toArray: vi.fn(),
      bulkPut: vi.fn(),
      bulkDelete: vi.fn(),
      clear: vi.fn(),
      where: vi.fn(() => ({ delete: vi.fn() })),
    },
    userData: {
      toArray: vi.fn(),
      bulkPut: vi.fn(),
      clear: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
    },
    kvStore: {
      toArray: vi.fn(),
      bulkPut: vi.fn(),
      put: vi.fn(),
    },
    transaction: vi.fn(async (...args: unknown[]) => {
      const callback = args.at(-1);
      if (typeof callback !== 'function') {
        throw new Error('Missing transaction callback');
      }
      return callback();
    }),
  };

  return { showNotification, db };
});

vi.mock('./ui', () => ({
  showNotification: mocked.showNotification,
}));

vi.mock('./db', () => ({
  db: mocked.db,
}));

import * as S from './state';

function makeSeries(id: number, name: string): Series {
  return {
    id,
    name,
    overview: `${name} overview`,
    poster_path: null,
    backdrop_path: null,
    first_air_date: '2020-01-01',
    genres: [],
  };
}

describe('state transitions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();

    mocked.db.watchlist.toArray.mockResolvedValue([]);
    mocked.db.archive.toArray.mockResolvedValue([]);
    mocked.db.watchedState.toArray.mockResolvedValue([]);
    mocked.db.userData.toArray.mockResolvedValue([]);
    mocked.db.kvStore.toArray.mockResolvedValue([]);
    mocked.db.watchlist.bulkPut.mockResolvedValue(undefined);
    mocked.db.archive.bulkPut.mockResolvedValue(undefined);
    mocked.db.watchedState.bulkPut.mockResolvedValue(undefined);
    mocked.db.watchedState.bulkDelete.mockResolvedValue(undefined);
    mocked.db.userData.bulkPut.mockResolvedValue(undefined);
    mocked.db.kvStore.bulkPut.mockResolvedValue(undefined);

    S.setMyWatchlist([]);
    S.setMyArchive([]);
    S.setWatchedState({});
    S.setUserData({});
  });

  it('marks and unmarks episodes while keeping watched state consistent', async () => {
    await S.markEpisodesAsWatched(42, [1001, 1002, 1001]);

    expect(S.watchedState[42]).toEqual([1001, 1002]);
    expect(mocked.db.watchedState.bulkPut).toHaveBeenCalledWith([
      { seriesId: 42, episodeId: 1001 },
      { seriesId: 42, episodeId: 1002 },
      { seriesId: 42, episodeId: 1001 },
    ] satisfies WatchedStateItem[]);

    await S.unmarkEpisodesAsWatched(42, [1002]);

    expect(S.watchedState[42]).toEqual([1001]);
    expect(mocked.db.watchedState.bulkDelete).toHaveBeenCalledWith([[42, 1002]]);
  });

  it('does not call bulkDelete when series has no watched episodes', async () => {
    await S.unmarkEpisodesAsWatched(999, [1, 2]);
    expect(mocked.db.watchedState.bulkDelete).not.toHaveBeenCalled();
  });

  it('loads state from IndexedDB tables preserving integrity', async () => {
    const watchlist = [makeSeries(1, 'Watchlist Show')];
    const archive = [makeSeries(2, 'Archive Show')];

    mocked.db.watchlist.toArray.mockResolvedValue(watchlist);
    mocked.db.archive.toArray.mockResolvedValue(archive);
    mocked.db.watchedState.toArray.mockResolvedValue([
      { seriesId: 1, episodeId: 11 },
      { seriesId: 1, episodeId: 12 },
      { seriesId: 2, episodeId: 21 },
    ] satisfies WatchedStateItem[]);
    mocked.db.userData.toArray.mockResolvedValue([
      { seriesId: 1, rating: 9, notes: 'Top tier' },
      { seriesId: 2, notes: 'Paused' },
    ] satisfies UserDataItem[]);
    mocked.db.kvStore.toArray.mockResolvedValue([
      { key: C.THEME_STORAGE_KEY, value: 'dark' },
    ]);

    const settings = await S.loadStateFromDB();

    expect(S.myWatchlist).toEqual(watchlist);
    expect(S.myArchive).toEqual(archive);
    expect(S.watchedState).toEqual({
      1: [11, 12],
      2: [21],
    });
    expect(S.userData).toEqual({
      1: { rating: 9, notes: 'Top tier' },
      2: { rating: 0, notes: 'Paused' },
    });
    expect(settings.get(C.THEME_STORAGE_KEY)).toBe('dark');
  });

  it('migrates localStorage data and sanitizes watched episode ids', async () => {
    const watchlist = [makeSeries(10, 'Migrated Watchlist')];
    const archive = [makeSeries(11, 'Migrated Archive')];

    localStorage.setItem('seriesdb.watchlist', JSON.stringify(watchlist));
    localStorage.setItem('seriesdb.archive', JSON.stringify(archive));
    localStorage.setItem(
      'seriesdb.watchedState',
      JSON.stringify({
        10: [101, '102', null, 'invalid'],
        invalidSeriesId: [200],
      }),
    );
    localStorage.setItem(
      'seriesdb.userData',
      JSON.stringify({
        10: { rating: 8, notes: 'Good' },
        invalidSeriesId: { rating: 5, notes: 'Skip' },
      }),
    );
    localStorage.setItem(C.WATCHLIST_VIEW_MODE_KEY, 'grid');
    localStorage.setItem(C.THEME_STORAGE_KEY, 'dark');

    await S.migrateFromLocalStorage();

    expect(mocked.db.watchlist.bulkPut).toHaveBeenCalledWith(watchlist);
    expect(mocked.db.archive.bulkPut).toHaveBeenCalledWith(archive);
    expect(mocked.db.watchedState.bulkPut).toHaveBeenCalledWith([
      { seriesId: 10, episodeId: 101 },
      { seriesId: 10, episodeId: 102 },
    ] satisfies WatchedStateItem[]);
    expect(mocked.db.userData.bulkPut).toHaveBeenCalledWith([
      { seriesId: 10, rating: 8, notes: 'Good' },
    ] satisfies UserDataItem[]);
    expect(mocked.db.kvStore.bulkPut).toHaveBeenCalledWith(
      expect.arrayContaining([
        { key: C.WATCHLIST_VIEW_MODE_KEY, value: 'grid' },
        { key: C.THEME_STORAGE_KEY, value: 'dark' },
      ]),
    );

    expect(localStorage.getItem('seriesdb.watchlist')).toBeNull();
    expect(localStorage.getItem('seriesdb.archive')).toBeNull();
    expect(localStorage.getItem('seriesdb.watchedState')).toBeNull();
    expect(localStorage.getItem('seriesdb.userData')).toBeNull();
    expect(localStorage.getItem(C.WATCHLIST_VIEW_MODE_KEY)).toBeNull();
    expect(localStorage.getItem(C.THEME_STORAGE_KEY)).toBeNull();
    expect(mocked.showNotification).toHaveBeenCalledTimes(2);
  });
});
