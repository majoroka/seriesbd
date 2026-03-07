import Dexie, { Table } from 'dexie';
import { Series, WatchedStateItem, UserDataItem, KVStoreItem, SeasonCacheItem } from './types';
import { createMediaKey, parseMediaKey } from './media';

export class MySubClassedDexie extends Dexie {
  watchlist!: Table<Series, [string, number]>;
  archive!: Table<Series, [string, number]>;
  watchedState!: Table<WatchedStateItem, [string, number]>;
  userData!: Table<UserDataItem, string>;
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
    this.version(4).stores({
      watchlist: '[media_type+id], id, media_type',
      archive: '[media_type+id], id, media_type',
      watchedState: '[media_key+episodeId], media_key, seriesId, media_type, media_id, episodeId',
      userData: 'media_key, seriesId, media_type, media_id',
      kvStore: 'key',
      seasonCache: '[seriesId+seasonNumber]',
    }).upgrade(async (tx) => {
      await tx.table('watchlist').toCollection().modify((record: any) => {
        if (record.media_type !== 'series' && record.media_type !== 'movie' && record.media_type !== 'book') {
          record.media_type = 'series';
        }
      });

      await tx.table('archive').toCollection().modify((record: any) => {
        if (record.media_type !== 'series' && record.media_type !== 'movie' && record.media_type !== 'book') {
          record.media_type = 'series';
        }
      });

      await tx.table('watchedState').toCollection().modify((record: any) => {
        const parsed = parseMediaKey(record.media_key ?? record.seriesId ?? record.media_id);
        if (!parsed) return;
        record.media_type = parsed.media_type;
        record.media_id = parsed.media_id;
        record.media_key = createMediaKey(parsed.media_type, parsed.media_id);
        if (parsed.media_type === 'series') {
          record.seriesId = parsed.media_id;
        } else {
          delete record.seriesId;
        }
      });

      await tx.table('userData').toCollection().modify((record: any) => {
        const parsed = parseMediaKey(record.media_key ?? record.seriesId ?? record.media_id);
        if (!parsed) return;
        record.media_type = parsed.media_type;
        record.media_id = parsed.media_id;
        record.media_key = createMediaKey(parsed.media_type, parsed.media_id);
        if (parsed.media_type === 'series') {
          record.seriesId = parsed.media_id;
        } else {
          delete record.seriesId;
        }
      });
    });
  }
}

export const db = new MySubClassedDexie();
