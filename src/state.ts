import { db } from './db';
import * as C from './constants';
import { showNotification } from './ui';
import { MediaType, Series, WatchedState, UserData, WatchedStateItem, UserDataItem } from './types';
import { createMediaKey, getSeriesMediaKey, normalizeSeries, normalizeSeriesCollection, parseMediaKey } from './media';
import { clampProgressPercent, clampUserNotes, safeParseJson } from './dataGuards';

// State variables
export let myWatchlist: Series[] = [];
export let myArchive: Series[] = [];
export let currentSearchResults: Series[] = [];
export let dashboardSuggestedMedia: Series[] = [];
export let charts: { [key: string]: any } = {};
export let watchedState: WatchedState = {};
export let userData: UserData = {};
export let detailViewAbortController = new AbortController();
export let searchAbortController = new AbortController();
export let allSeriesGenreFilter = 'all';
export type AllSeriesStatusFilter = 'all' | 'watchlist' | 'unseen' | 'archive';
export let allSeriesStatusFilter: AllSeriesStatusFilter = 'all';
export type AllSeriesMediaFilter = 'all' | MediaType;
export let allSeriesMediaFilter: AllSeriesMediaFilter = 'all';
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
export function setDashboardSuggestedMedia(data: Series[]) { dashboardSuggestedMedia = normalizeSeriesCollection(data); }
export function setCharts(data: { [key: string]: any }) { charts = data; }
export function getSeries(seriesId: number): Series | undefined {
    return [...myWatchlist, ...myArchive].find(s => s.media_type === 'series' && s.id === seriesId);
}
export function getMediaItem(mediaType: MediaType, mediaId: number): Series | undefined {
    return [...myWatchlist, ...myArchive].find(s => s.media_type === mediaType && s.id === mediaId);
}
export function setAllSeriesGenreFilter(value: string) { allSeriesGenreFilter = value; }
export function setAllSeriesStatusFilter(value: string) {
    if (value === 'watchlist' || value === 'unseen' || value === 'archive') {
        allSeriesStatusFilter = value;
        return;
    }
    allSeriesStatusFilter = 'all';
}
export function setAllSeriesMediaFilter(value: string) {
    if (value === 'series' || value === 'movie' || value === 'book') {
        allSeriesMediaFilter = value;
        return;
    }
    allSeriesMediaFilter = 'all';
}
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

function toSeriesStateKey(seriesId: number): string {
    return String(seriesId);
}

function toStateKey(mediaType: MediaType, mediaId: number): string {
    return mediaType === 'series' ? toSeriesStateKey(mediaId) : createMediaKey(mediaType, mediaId);
}

export async function addSeries(series: Series) {
    const normalizedSeries = normalizeSeries(series);
    myWatchlist.push(normalizedSeries);
    await db.watchlist.put(normalizedSeries);
    emitStateMutation('addSeries');
}

export async function removeSeries(seriesId: number) {
    await removeMedia('series', seriesId);
}

export async function removeMedia(mediaType: MediaType, mediaId: number) {
    const mediaKey = createMediaKey(mediaType, mediaId);
    await db.transaction('rw', db.watchlist, db.archive, db.watchedState, db.userData, async () => {
        await db.watchlist.where('[media_type+id]').equals([mediaType, mediaId]).delete();
        await db.archive.where('[media_type+id]').equals([mediaType, mediaId]).delete();
        await db.watchedState.where({ media_key: mediaKey }).delete();
        await db.userData.where({ media_key: mediaKey }).delete();
        if (mediaType === 'series') {
            await db.watchedState.where({ seriesId: mediaId }).delete();
            await db.userData.where({ seriesId: mediaId }).delete();
        }
    });
    myWatchlist = myWatchlist.filter(series => !(series.media_type === mediaType && series.id === mediaId));
    myArchive = myArchive.filter(series => !(series.media_type === mediaType && series.id === mediaId));
    if (mediaType === 'series') {
        delete watchedState[toSeriesStateKey(mediaId)];
        delete userData[toSeriesStateKey(mediaId)];
    }
    delete watchedState[mediaKey];
    delete userData[mediaKey];
    emitStateMutation('removeMedia');
}

export async function archiveSeries(series: Series) {
    const normalizedSeries = normalizeSeries(series);
    if (!myArchive.some(s => s.media_type === normalizedSeries.media_type && s.id === normalizedSeries.id)) {
        myArchive.push(normalizedSeries);
    }
    myWatchlist = myWatchlist.filter(s => !(s.media_type === normalizedSeries.media_type && s.id === normalizedSeries.id));
    await db.transaction('rw', db.watchlist, db.archive, async () => {
        await db.archive.put(normalizedSeries);
        await db.watchlist.where('[media_type+id]').equals([normalizedSeries.media_type, normalizedSeries.id]).delete();
    });
    emitStateMutation('archiveSeries');
}

export async function unarchiveSeries(series: Series) {
    const normalizedSeries = normalizeSeries(series);
    if (!myWatchlist.some(s => s.media_type === normalizedSeries.media_type && s.id === normalizedSeries.id)) {
        myWatchlist.push(normalizedSeries);
    }
    myArchive = myArchive.filter(s => !(s.media_type === normalizedSeries.media_type && s.id === normalizedSeries.id));
    await db.transaction('rw', db.watchlist, db.archive, async () => {
        await db.watchlist.put(normalizedSeries);
        await db.archive.where('[media_type+id]').equals([normalizedSeries.media_type, normalizedSeries.id]).delete();
    });
    emitStateMutation('unarchiveSeries');
}

export async function updateSeries(series: Series) {
    const normalizedSeries = normalizeSeries(series);
    const inWatchlist = myWatchlist.some(s => s.media_type === normalizedSeries.media_type && s.id === normalizedSeries.id);
    if (inWatchlist) {
        myWatchlist = myWatchlist.map((item) =>
            item.media_type === normalizedSeries.media_type && item.id === normalizedSeries.id
                ? normalizedSeries
                : item
        );
    } else {
        myArchive = myArchive.map((item) =>
            item.media_type === normalizedSeries.media_type && item.id === normalizedSeries.id
                ? normalizedSeries
                : item
        );
    }
    if (inWatchlist) {
        await db.watchlist.put(normalizedSeries);
    } else {
        await db.archive.put(normalizedSeries);
    }
    emitStateMutation('updateSeries');
}

export async function markEpisodesAsWatched(seriesId: number, episodeIds: number[]) {
    const stateKey = toSeriesStateKey(seriesId);
    const mediaKey = getSeriesMediaKey(seriesId);
    if (!watchedState[stateKey]) {
        watchedState[stateKey] = [];
    }
    const newWatchedEpisodes = new Set([...watchedState[stateKey], ...episodeIds]);
    watchedState[stateKey] = Array.from(newWatchedEpisodes);
    const itemsToPut = episodeIds.map(epId => ({
        media_key: mediaKey,
        media_type: 'series' as const,
        media_id: seriesId,
        seriesId,
        episodeId: epId
    }));
    await db.watchedState.bulkPut(itemsToPut);
    emitStateMutation('markEpisodesAsWatched');
}

export async function unmarkEpisodesAsWatched(seriesId: number, episodeIds: number[]) {
    const stateKey = toSeriesStateKey(seriesId);
    if (!watchedState[stateKey]) return;
    const episodeIdsSet = new Set(episodeIds);
    watchedState[stateKey] = watchedState[stateKey].filter(id => !episodeIdsSet.has(id));
    const keysToRemove = episodeIds.map(epId => [seriesId, epId] as [number, number]);
    await db.watchedState.bulkDelete(keysToRemove);
    emitStateMutation('unmarkEpisodesAsWatched');
}

export async function updateUserRating(seriesId: number, rating: number) {
    await updateMediaRating('series', seriesId, rating);
}

export async function updateMediaRating(mediaType: MediaType, mediaId: number, rating: number) {
    const stateKey = toStateKey(mediaType, mediaId);
    const notes = userData[stateKey]?.notes || '';
    const progressPercent = userData[stateKey]?.progress_percent;
    if (!userData[stateKey]) {
        userData[stateKey] = {};
    }
    userData[stateKey].rating = rating;
    await db.userData.put({
        media_key: mediaType === 'series' ? getSeriesMediaKey(mediaId) : createMediaKey(mediaType, mediaId),
        media_type: mediaType,
        media_id: mediaId,
        seriesId: mediaId,
        rating,
        notes,
        progress_percent: progressPercent,
    });
    emitStateMutation('updateMediaRating');
}

export async function updateUserNotes(seriesId: number, notes: string) {
    await updateMediaNotes('series', seriesId, notes);
}

export async function updateMediaNotes(mediaType: MediaType, mediaId: number, notes: string) {
    const stateKey = toStateKey(mediaType, mediaId);
    const rating = userData[stateKey]?.rating || 0;
    const progressPercent = userData[stateKey]?.progress_percent;
    const normalizedNotes = clampUserNotes(notes);
    if (!userData[stateKey]) {
        userData[stateKey] = {};
    }
    userData[stateKey].notes = normalizedNotes;
    await db.userData.put({
        media_key: mediaType === 'series' ? getSeriesMediaKey(mediaId) : createMediaKey(mediaType, mediaId),
        media_type: mediaType,
        media_id: mediaId,
        seriesId: mediaId,
        rating,
        notes: normalizedNotes,
        progress_percent: progressPercent,
    });
    emitStateMutation('updateMediaNotes');
}

export async function updateMediaProgress(mediaType: MediaType, mediaId: number, progressPercent: number) {
    const normalizedProgress = Number.isFinite(progressPercent)
        ? Math.max(0, Math.min(100, Math.round(progressPercent)))
        : 0;
    const stateKey = toStateKey(mediaType, mediaId);
    const currentEntry = userData[stateKey] || {};
    const rating = currentEntry.rating || 0;
    const notes = currentEntry.notes || '';

    userData[stateKey] = {
        ...currentEntry,
        progress_percent: normalizedProgress,
    };

    await db.userData.put({
        media_key: createMediaKey(mediaType, mediaId),
        media_type: mediaType,
        media_id: mediaId,
        seriesId: mediaId,
        rating,
        notes,
        progress_percent: normalizedProgress,
    });
    emitStateMutation('updateMediaProgress');
}

async function loadWatchedStateFromDB(): Promise<WatchedState> {
    const records = await db.watchedState.toArray();
    const state: WatchedState = {};
    records.forEach(record => {
        const parsed = parseMediaKey(record.media_key ?? record.seriesId ?? record.media_id);
        if (!parsed) return;
        const stateKey = parsed.media_type === 'series' ? String(parsed.media_id) : createMediaKey(parsed.media_type, parsed.media_id);
        if (!state[stateKey]) {
            state[stateKey] = [];
        }
        state[stateKey].push(record.episodeId);
    });
    return state;
}

async function loadUserDataFromDB(): Promise<UserData> {
    const records = await db.userData.toArray();
    const data: UserData = {};
    records.forEach(record => {
        const parsed = parseMediaKey(record.media_key ?? record.seriesId ?? record.media_id);
        if (!parsed) return;
        const stateKey = parsed.media_type === 'series' ? String(parsed.media_id) : createMediaKey(parsed.media_type, parsed.media_id);
        data[stateKey] = {
            rating: record.rating || 0,
            notes: clampUserNotes(record.notes),
            progress_percent: clampProgressPercent(record.progress_percent),
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
    
    const oldWatchlist = normalizeSeriesCollection(safeParseJson(localStorage.getItem('seriesdb.watchlist'), [] as Series[]));
    const oldArchive = normalizeSeriesCollection(safeParseJson(localStorage.getItem('seriesdb.archive'), [] as Series[]));
    const oldWatchedState = safeParseJson(localStorage.getItem('seriesdb.watchedState'), {} as WatchedState);
    const oldUserData = safeParseJson(localStorage.getItem('seriesdb.userData'), {} as UserData);

    await db.transaction('rw', [db.watchlist, db.archive, db.watchedState, db.userData, db.kvStore], async () => {
        if (oldWatchlist.length > 0) await db.watchlist.bulkPut(oldWatchlist);
        if (oldArchive.length > 0) await db.archive.bulkPut(oldArchive);

        const watchedItems: WatchedStateItem[] = [];
        for (const stateKey in oldWatchedState) {
            if (oldWatchedState.hasOwnProperty(stateKey) && Array.isArray(oldWatchedState[stateKey])) {
                const parsedMedia = parseMediaKey(stateKey);
                if (!parsedMedia) continue;
                const mediaKey = createMediaKey(parsedMedia.media_type, parsedMedia.media_id);
                oldWatchedState[stateKey].forEach((episodeId: number) => {
                    if (episodeId !== null && episodeId !== undefined) {
                        const epId = parseInt(String(episodeId), 10);
                        if (!isNaN(epId)) {
                            watchedItems.push({
                                media_key: mediaKey,
                                media_type: parsedMedia.media_type,
                                media_id: parsedMedia.media_id,
                                seriesId: parsedMedia.media_id,
                                episodeId: epId
                            });
                        }
                    }
                });
            }
        }
        if (watchedItems.length > 0) await db.watchedState.bulkPut(watchedItems);

        const userDataItems: UserDataItem[] = [];
        for (const stateKey in oldUserData) {
            if (oldUserData.hasOwnProperty(stateKey)) {
                const parsedMedia = parseMediaKey(stateKey);
                if(parsedMedia) {
                    const { rating, notes } = oldUserData[stateKey];
                    userDataItems.push({
                        media_key: createMediaKey(parsedMedia.media_type, parsedMedia.media_id),
                        media_type: parsedMedia.media_type,
                        media_id: parsedMedia.media_id,
                        seriesId: parsedMedia.media_id,
                        rating,
                        notes: clampUserNotes(notes),
                        progress_percent: clampProgressPercent(oldUserData[stateKey]?.progress_percent),
                    });
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
