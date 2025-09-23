import Dexie, { Table } from 'dexie';
import { Series, WatchedStateItem, UserDataItem, KVStoreItem, SeasonCacheItem } from './types';

export class MySubClassedDexie extends Dexie {
  watchlist!: Table<Series>;
  archive!: Table<Series>;
  watchedState!: Table<WatchedStateItem, [number, number]>;
  userData!: Table<UserDataItem>;
  kvStore!: Table<KVStoreItem>;
  seasonCache!: Table<SeasonCacheItem, [number, number]>;

  constructor() {
    super('seriesDB');
    this.version(3).stores({
      watchlist: 'id',
      archive: 'id',
      watchedState: '[seriesId+episodeId]',
      userData: 'seriesId',
      kvStore: 'key',
      seasonCache: '[seriesId+seasonNumber]',
    });
  }
}

export const db = new MySubClassedDexie();