import Dexie from 'https://unpkg.com/dexie@4.0.1/dist/dexie.mjs';

export const db = new Dexie('SériesDB');

db.version(2).stores({
    watchlist: '&id, name', // Primary key 'id', index 'name'
    archive: '&id, name',   // Primary key 'id', index 'name'
    watchedState: '[seriesId+episodeId], seriesId', // Compound primary key, index on seriesId
    userData: '&seriesId', // Primary key 'seriesId'
    kvStore: '&key', // Key-value store for simple settings like theme, view modes
    seasonCache: '[seriesId+seasonNumber]' // Cache for season details
});