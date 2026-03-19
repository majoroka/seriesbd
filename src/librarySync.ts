import { db } from './db';
import * as S from './state';
import { UserData, UserDataItem, WatchedState, WatchedStateItem, Series } from './types';
import { getSupabaseClient, isSupabaseConfigured } from './supabase';
import { createMediaKey, normalizeSeriesCollection, parseMediaKey } from './media';

export const LIBRARY_SNAPSHOT_SCHEMA_VERSION = 2;
export const LOCAL_LIBRARY_MUTATION_AT_KEY = 'seriesdb.localLibraryMutationAt';

export type LibrarySnapshotPayload = {
  version: number;
  generatedAt: string;
  watchlist: Series[];
  archive: Series[];
  watchedState: WatchedState;
  userData: UserData;
};

type RemoteLibrarySnapshotRow = {
  user_id: string;
  schema_version: number;
  payload: LibrarySnapshotPayload | null;
  updated_at: string;
};

export type LibrarySyncOutcome =
  | 'disabled'
  | 'noop'
  | 'pushed'
  | 'pulled';

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeWatchedState(input: unknown): WatchedState {
  if (!isObjectLike(input)) return {};
  const normalized: WatchedState = {};
  Object.entries(input).forEach(([mediaKey, episodeIds]) => {
    if (!Array.isArray(episodeIds)) return;
    normalized[mediaKey] = episodeIds
      .map((id) => Number(id))
      .filter((id) => !Number.isNaN(id));
  });
  return normalized;
}

function normalizeUserData(input: unknown): UserData {
  if (!isObjectLike(input)) return {};
  const normalized: UserData = {};
  Object.entries(input).forEach(([mediaKey, value]) => {
    if (!isObjectLike(value)) return;
    const rawRating = value.rating;
    const rawNotes = value.notes;
    const rawProgress = value.progress_percent;
    const parsedProgress =
      typeof rawProgress === 'number'
        ? rawProgress
        : Number(rawProgress);
    normalized[mediaKey] = {
      rating: typeof rawRating === 'number' ? rawRating : Number(rawRating || 0),
      notes: typeof rawNotes === 'string' ? rawNotes : '',
      progress_percent: Number.isFinite(parsedProgress)
        ? Math.max(0, Math.min(100, Math.round(parsedProgress)))
        : undefined,
    };
  });
  return normalized;
}

function normalizeLibraryPayload(payload: unknown): LibrarySnapshotPayload {
  const record = isObjectLike(payload) ? payload : {};
  return {
    version:
      typeof record.version === 'number'
        ? record.version
        : LIBRARY_SNAPSHOT_SCHEMA_VERSION,
    generatedAt:
      typeof record.generatedAt === 'string'
        ? record.generatedAt
        : new Date().toISOString(),
    watchlist: normalizeSeriesCollection(record.watchlist),
    archive: normalizeSeriesCollection(record.archive),
    watchedState: normalizeWatchedState(record.watchedState),
    userData: normalizeUserData(record.userData),
  };
}

function hasMeaningfulLibraryData(snapshot: LibrarySnapshotPayload): boolean {
  return (
    snapshot.watchlist.length > 0 ||
    snapshot.archive.length > 0 ||
    Object.keys(snapshot.watchedState).length > 0 ||
    Object.keys(snapshot.userData).length > 0
  );
}

function parseIsoDate(value: string | null): number {
  if (!value) return Number.NaN;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.NaN : parsed;
}

export async function markLocalLibraryMutation(atIso: string = new Date().toISOString()): Promise<void> {
  await db.kvStore.put({ key: LOCAL_LIBRARY_MUTATION_AT_KEY, value: atIso });
}

export async function getLocalLibraryMutationAt(): Promise<string | null> {
  const record = await db.kvStore.get(LOCAL_LIBRARY_MUTATION_AT_KEY);
  if (!record) return null;
  return typeof record.value === 'string' ? record.value : String(record.value || '');
}

export function buildLocalLibrarySnapshot(): LibrarySnapshotPayload {
  return {
    version: LIBRARY_SNAPSHOT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    watchlist: S.myWatchlist,
    archive: S.myArchive,
    watchedState: S.watchedState,
    userData: S.userData,
  };
}

async function fetchRemoteLibrarySnapshot(userId: string): Promise<RemoteLibrarySnapshotRow | null> {
  if (!isSupabaseConfigured()) return null;
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('library_snapshots')
    .select('user_id, schema_version, payload, updated_at')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;
  return (data as RemoteLibrarySnapshotRow | null) || null;
}

export async function pushLocalLibrarySnapshot(userId: string): Promise<void> {
  if (!isSupabaseConfigured()) return;
  const client = getSupabaseClient();
  const payload = buildLocalLibrarySnapshot();
  const { error } = await client.from('library_snapshots').upsert(
    {
      user_id: userId,
      schema_version: LIBRARY_SNAPSHOT_SCHEMA_VERSION,
      payload,
    },
    { onConflict: 'user_id' }
  );
  if (error) throw error;
}

export async function applyRemoteLibrarySnapshotToLocal(rawPayload: unknown, remoteUpdatedAtIso: string): Promise<void> {
  const payload = normalizeLibraryPayload(rawPayload);

  const watchedItems: WatchedStateItem[] = [];
  Object.entries(payload.watchedState).forEach(([stateKey, episodeIds]) => {
    const parsedMedia = parseMediaKey(stateKey);
    if (!parsedMedia || !Array.isArray(episodeIds)) return;
    episodeIds.forEach((episodeId) => {
      const numericEpisodeId = Number(episodeId);
      if (Number.isNaN(numericEpisodeId)) return;
      watchedItems.push({
        media_key: createMediaKey(parsedMedia.media_type, parsedMedia.media_id),
        media_type: parsedMedia.media_type,
        media_id: parsedMedia.media_id,
        seriesId: parsedMedia.media_id,
        episodeId: numericEpisodeId,
      });
    });
  });

  const userDataItems: UserDataItem[] = [];
  Object.entries(payload.userData).forEach(([stateKey, data]) => {
    const parsedMedia = parseMediaKey(stateKey);
    if (!parsedMedia) return;
    userDataItems.push({
      media_key: createMediaKey(parsedMedia.media_type, parsedMedia.media_id),
      media_type: parsedMedia.media_type,
      media_id: parsedMedia.media_id,
      seriesId: parsedMedia.media_id,
      rating: data?.rating || 0,
      notes: data?.notes || '',
      progress_percent: typeof data?.progress_percent === 'number' ? data.progress_percent : undefined,
    });
  });

  await db.transaction('rw', [db.watchlist, db.archive, db.watchedState, db.userData], async () => {
    await db.watchlist.clear();
    await db.archive.clear();
    await db.watchedState.clear();
    await db.userData.clear();
    if (payload.watchlist.length > 0) await db.watchlist.bulkPut(payload.watchlist);
    if (payload.archive.length > 0) await db.archive.bulkPut(payload.archive);
    if (watchedItems.length > 0) await db.watchedState.bulkPut(watchedItems);
    if (userDataItems.length > 0) await db.userData.bulkPut(userDataItems);
  });

  await markLocalLibraryMutation(remoteUpdatedAtIso);
}

export async function syncLibrarySnapshotAfterLogin(userId: string): Promise<LibrarySyncOutcome> {
  if (!isSupabaseConfigured()) return 'disabled';

  const localSnapshot = buildLocalLibrarySnapshot();
  const localHasData = hasMeaningfulLibraryData(localSnapshot);
  const localMutationAt = await getLocalLibraryMutationAt();
  const localMutationTs = parseIsoDate(localMutationAt);

  const remoteRow = await fetchRemoteLibrarySnapshot(userId);
  if (!remoteRow) {
    if (!localHasData) return 'noop';
    await pushLocalLibrarySnapshot(userId);
    await markLocalLibraryMutation(new Date().toISOString());
    return 'pushed';
  }

  const remotePayload = normalizeLibraryPayload(remoteRow.payload);
  const remoteHasData = hasMeaningfulLibraryData(remotePayload);
  const remoteUpdatedTs = parseIsoDate(remoteRow.updated_at);

  if (!remoteHasData) {
    if (!localHasData) return 'noop';
    await pushLocalLibrarySnapshot(userId);
    await markLocalLibraryMutation(new Date().toISOString());
    return 'pushed';
  }

  if (!localHasData) {
    await applyRemoteLibrarySnapshotToLocal(remotePayload, remoteRow.updated_at);
    return 'pulled';
  }

  // Proteção contra migrações antigas sem timestamp local: priorizar local para evitar perda de dados.
  if (Number.isNaN(localMutationTs)) {
    await pushLocalLibrarySnapshot(userId);
    await markLocalLibraryMutation(new Date().toISOString());
    return 'pushed';
  }

  if (!Number.isNaN(localMutationTs) && !Number.isNaN(remoteUpdatedTs) && localMutationTs > remoteUpdatedTs + 1000) {
    await pushLocalLibrarySnapshot(userId);
    await markLocalLibraryMutation(new Date().toISOString());
    return 'pushed';
  }

  if (!Number.isNaN(remoteUpdatedTs) && (Number.isNaN(localMutationTs) || remoteUpdatedTs > localMutationTs + 1000)) {
    await applyRemoteLibrarySnapshotToLocal(remotePayload, remoteRow.updated_at);
    return 'pulled';
  }

  return 'noop';
}
