import { db } from './db';
import * as C from './constants';
import { showNotification } from './ui';
import { Series, WatchedState, UserData, WatchedStateItem, UserDataItem } from './types';
import { normalizeSeries, normalizeSeriesCollection } from './media';

// State variables
export let myWatchlist: Series[] = [];
export let myArchive: Series[] = [];
export let currentSearchResults: Series[] = [];
export let charts: { [key: string]: any } = {};
export let watchedState: WatchedState = {};
export let userData: UserData = {};
export let detailViewAbortController = new AbortController();
export let searchAbortController = new AbortController();
export let allSeriesGenreFilter = 'all';
export type DetailEpisodeMeta = { id: number; season_number: number; episode_number: number; };
export type DetailSeasonMeta = { season_number: number; episode_count: number; };
export type DetailViewData = {
    allEpisodes: DetailEpisodeMeta[];
    episodeMap: Record<number, number>;
    seasons: DetailSeasonMeta[];
};
export let detailViewData: DetailViewData = { allEpisodes: [], episodeMap: {}, seasons: [] };
export const STATE_MUTATION_EVENT_NAME = 'seriesdb:state-mutated';

function emitStateMutation(reason: string) {
    if (typeof document === 'undefined') return;
    document.dispatchEvent(new CustomEvent(STATE_MUTATION_EVENT_NAME, { detail: { reason, at: new Date().toISOString() } }));
}

// State update functions
export function setMyWatchlist(data: Series[]) { myWatchlist = normalizeSeriesCollection(data); }
export function setMyArchive(data: Series[]) { myArchive = normalizeSeriesCollection(data); }
export function setWatchedState(data: WatchedState) { watchedState = data; }
export function setUserData(data: UserData) { userData = data; }
export function setCurrentSearchResults(data: Series[]) { currentSearchResults = data.map(normalizeSeries); }
export function setCharts(data: { [key: string]: any }) { charts = data; }
export function getSeries(seriesId: number): Series | undefined { return [...myWatchlist, ...myArchive].find(s => s.id === seriesId); }
export function setAllSeriesGenreFilter(value: string) { allSeriesGenreFilter = value; }
export function setDetailViewData(data: DetailViewData) { detailViewData = data; }
export function getDetailViewData(): DetailViewData { return detailViewData; }
export function resetDetailViewData() { detailViewData = { allEpisodes: [], episodeMap: {}, seasons: [] }; }

export function resetDetailViewAbortController() {
    detailViewAbortController.abort();
    detailViewAbortController = new AbortController();
    resetDetailViewData();
}

export function resetSearchAbortController() {
    searchAbortController.abort();
    searchAbortController = new AbortController();
}

export async function addSeries(series: Series) {
    const normalizedSeries = normalizeSeries(series);
    myWatchlist.push(normalizedSeries);
    await db.watchlist.put(normalizedSeries);
    emitStateMutation('addSeries');
}

export async function removeSeries(seriesId: number) {
    await db.transaction('rw', db.watchlist, db.archive, db.watchedState, db.userData, async () => {
        await db.watchlist.delete(seriesId);
        await db.archive.delete(seriesId);
        await db.watchedState.where({ seriesId: seriesId }).delete();
        await db.userData.delete(seriesId);
    });
    myWatchlist = myWatchlist.filter(series => series.id !== seriesId);
    myArchive = myArchive.filter(series => series.id !== seriesId);
    delete watchedState[String(seriesId)];
    delete userData[String(seriesId)];
    emitStateMutation('removeSeries');
}

export async function archiveSeries(series: Series) {
    const normalizedSeries = normalizeSeries(series);
    if (!myArchive.some(s => s.id === normalizedSeries.id)) {
        myArchive.push(normalizedSeries);
    }
    myWatchlist = myWatchlist.filter(s => s.id !== normalizedSeries.id);
    await db.transaction('rw', db.watchlist, db.archive, async () => {
        await db.archive.put(normalizedSeries);
        await db.watchlist.delete(normalizedSeries.id);
    });
    emitStateMutation('archiveSeries');
}

export async function unarchiveSeries(series: Series) {
    const normalizedSeries = normalizeSeries(series);
    if (!myWatchlist.some(s => s.id === normalizedSeries.id)) {
        myWatchlist.push(normalizedSeries);
    }
    myArchive = myArchive.filter(s => s.id !== normalizedSeries.id);
    await db.transaction('rw', db.watchlist, db.archive, async () => {
        await db.watchlist.put(normalizedSeries);
        await db.archive.delete(normalizedSeries.id);
    });
    emitStateMutation('unarchiveSeries');
}

export async function updateSeries(series: Series) {
    const normalizedSeries = normalizeSeries(series);
    const inWatchlist = myWatchlist.some(s => s.id === normalizedSeries.id);
    if (inWatchlist) {
        await db.watchlist.put(normalizedSeries);
    } else {
        await db.archive.put(normalizedSeries);
    }
    emitStateMutation('updateSeries');
}

export async function markEpisodesAsWatched(seriesId: number, episodeIds: number[]) {
    if (!watchedState[seriesId]) {
        watchedState[seriesId] = [];
    }
    const newWatchedEpisodes = new Set([...watchedState[seriesId], ...episodeIds]);
    watchedState[seriesId] = Array.from(newWatchedEpisodes);
    const itemsToPut = episodeIds.map(epId => ({ seriesId, episodeId: epId }));
    await db.watchedState.bulkPut(itemsToPut);
    emitStateMutation('markEpisodesAsWatched');
}

export async function unmarkEpisodesAsWatched(seriesId: number, episodeIds: number[]) {
    if (!watchedState[seriesId]) return;
    const episodeIdsSet = new Set(episodeIds);
    watchedState[String(seriesId)] = watchedState[String(seriesId)].filter(id => !episodeIdsSet.has(id));
    const keysToRemove = episodeIds.map(epId => [seriesId, epId] as [number, number]);
    await db.watchedState.bulkDelete(keysToRemove);
    emitStateMutation('unmarkEpisodesAsWatched');
}

export async function updateUserRating(seriesId: number, rating: number) {
    const notes = userData[String(seriesId)]?.notes || '';
    if (!userData[seriesId]) {
        userData[seriesId] = {};
    }
    userData[seriesId].rating = rating;
    await db.userData.put({ seriesId, rating, notes });
    emitStateMutation('updateUserRating');
}

export async function updateUserNotes(seriesId: number, notes: string) {
    const rating = userData[String(seriesId)]?.rating || 0;
    if (!userData[seriesId]) {
        userData[seriesId] = {};
    }
    userData[seriesId].notes = notes;
    await db.userData.put({ seriesId, rating, notes });
    emitStateMutation('updateUserNotes');
}

async function loadWatchedStateFromDB(): Promise<WatchedState> {
    const records = await db.watchedState.toArray();
    const state: WatchedState = {};
    records.forEach(record => {
        if (!state[record.seriesId]) {
            state[record.seriesId] = [];
        }
        state[record.seriesId].push(record.episodeId);
    });
    return state;
}

async function loadUserDataFromDB(): Promise<UserData> {
    const records = await db.userData.toArray();
    const data: UserData = {};
    records.forEach(record => {
        data[record.seriesId] = {
            rating: record.rating || 0,
            notes: record.notes
        };
    });
    return data;
}

export async function loadStateFromDB() {
    const [wl, ar, ws, ud, settings] = await Promise.all([
        db.watchlist.toArray(), db.archive.toArray(), loadWatchedStateFromDB(), loadUserDataFromDB(), db.kvStore.toArray()
    ]);
    setMyWatchlist(wl);
    setMyArchive(ar);
    setWatchedState(ws);
    setUserData(ud);
    return new Map(settings.map(i => [i.key, i.value]));
}

export async function migrateFromLocalStorage() {
    console.log("Migrating data from localStorage to IndexedDB...");
    showNotification("A atualizar a base de dados local... Por favor, aguarde.");
    
    const oldWatchlist = normalizeSeriesCollection(JSON.parse(localStorage.getItem('seriesdb.watchlist') || '[]'));
    const oldArchive = normalizeSeriesCollection(JSON.parse(localStorage.getItem('seriesdb.archive') || '[]'));
    const oldWatchedState: WatchedState = JSON.parse(localStorage.getItem('seriesdb.watchedState') || '{}');
    const oldUserData: UserData = JSON.parse(localStorage.getItem('seriesdb.userData') || '{}');

    await db.transaction('rw', [db.watchlist, db.archive, db.watchedState, db.userData, db.kvStore], async () => {
        if (oldWatchlist.length > 0) await db.watchlist.bulkPut(oldWatchlist);
        if (oldArchive.length > 0) await db.archive.bulkPut(oldArchive);

        const watchedItems: WatchedStateItem[] = [];
        for (const seriesId in oldWatchedState) {
            if (oldWatchedState.hasOwnProperty(seriesId) && Array.isArray(oldWatchedState[seriesId])) {
                const sId = parseInt(seriesId, 10);
                if (isNaN(sId)) continue;
                oldWatchedState[seriesId].forEach((episodeId: number) => {
                    if (episodeId !== null && episodeId !== undefined) {
                        const epId = parseInt(String(episodeId), 10);
                        if (!isNaN(epId)) watchedItems.push({ seriesId: sId, episodeId: epId } as WatchedStateItem);
                    }
                });
            }
        }
        if (watchedItems.length > 0) await db.watchedState.bulkPut(watchedItems);

        const userDataItems: UserDataItem[] = [];
        for (const seriesId in oldUserData) {
            if (oldUserData.hasOwnProperty(seriesId)) {
                const sId = parseInt(seriesId, 10);
                if(!isNaN(sId)) {
                    const { rating, notes } = oldUserData[seriesId];
                    userDataItems.push({ seriesId: sId, rating, notes });
                }
            }
        }
        if (userDataItems.length > 0) await db.userData.bulkPut(userDataItems);

        const settingsToMigrate = [C.ARCHIVE_VIEW_MODE_KEY, C.WATCHLIST_VIEW_MODE_KEY, C.UNSEEN_VIEW_MODE_KEY, C.ALL_SERIES_VIEW_MODE_KEY, C.THEME_STORAGE_KEY];
        const kvItems = settingsToMigrate.map(key => ({ key, value: localStorage.getItem(key) as string })).filter(item => item.value !== null);
        if (kvItems.length > 0) await db.kvStore.bulkPut(kvItems);
    });

    const keysToRemove = [
        'seriesdb.watchlist', 'seriesdb.archive', 'seriesdb.watchedState', 'seriesdb.userData',
        C.ARCHIVE_VIEW_MODE_KEY, C.WATCHLIST_VIEW_MODE_KEY, C.UNSEEN_VIEW_MODE_KEY, C.ALL_SERIES_VIEW_MODE_KEY, C.THEME_STORAGE_KEY
    ];
    keysToRemove.forEach(key => localStorage.removeItem(key));

    console.log("Migration complete.");
    showNotification("Base de dados atualizada com sucesso!");
}
