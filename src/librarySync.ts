import { db } from './db';
import * as S from './state';
import { UserData, UserDataItem, WatchedState, WatchedStateItem, Series } from './types';
import { getSupabaseClient, isSupabaseConfigured } from './supabase';
import { createMediaKey, normalizeSeriesCollection, parseMediaKey } from './media';
import {
  assertSerializedJsonLimit,
  clampProgressPercent,
  clampUserNotes,
  MAX_LIBRARY_SNAPSHOT_SIZE_BYTES,
} from './dataGuards';

export const LIBRARY_SNAPSHOT_SCHEMA_VERSION = 2;
export const LOCAL_LIBRARY_MUTATION_AT_KEY = 'seriesdb.localLibraryMutationAt';
export const LOCAL_DEVICE_ID_KEY = 'seriesdb.deviceId';

export type LibrarySnapshotSyncReason =
  | 'auto'
  | 'post_login_local_seed'
  | 'post_login_conflict_local'
  | 'manual_replace_cloud'
  | 'import';

export type LibrarySnapshotSyncMeta = {
  deviceId: string;
  syncReason: LibrarySnapshotSyncReason;
  watchlistCount: number;
  archiveCount: number;
  watchedStateKeyCount: number;
  userDataCount: number;
  totalItemCount: number;
  appVersion: string | null;
};

export type LibrarySnapshotPayload = {
  version: number;
  generatedAt: string;
  watchlist: Series[];
  archive: Series[];
  watchedState: WatchedState;
  userData: UserData;
  syncMeta?: LibrarySnapshotSyncMeta | null;
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
  | 'pulled'
  | 'conflict_remote_richer'
  | 'conflict_local_richer';

export type LibrarySnapshotCounts = {
  watchlistCount: number;
  archiveCount: number;
  watchedStateKeyCount: number;
  userDataCount: number;
  totalItemCount: number;
  footprintScore: number;
};

export type LibrarySyncConflictContext = {
  userId: string;
  localMutationAt: string | null;
  remoteUpdatedAt: string;
  localCounts: LibrarySnapshotCounts;
  remoteCounts: LibrarySnapshotCounts;
};

export type LibrarySyncStatusSummary = {
  localDeviceId: string;
  localMutationAt: string | null;
  localCounts: LibrarySnapshotCounts;
  remoteAvailable: boolean;
  remoteUpdatedAt: string | null;
  remoteCounts: LibrarySnapshotCounts | null;
  remoteDeviceId: string | null;
  remoteSyncReason: string | null;
  pendingConflict: LibrarySyncConflictContext | null;
};

type PendingLibrarySyncConflict = LibrarySyncConflictContext & {
  remotePayload: LibrarySnapshotPayload;
};

let pendingLibrarySyncConflict: PendingLibrarySyncConflict | null = null;

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
    normalized[mediaKey] = {
      rating: typeof rawRating === 'number' ? rawRating : Number(rawRating || 0),
      notes: clampUserNotes(value.notes),
      progress_percent: clampProgressPercent(value.progress_percent),
    };
  });
  return normalized;
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function normalizeInteger(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.trunc(numeric));
}

function normalizeSyncMeta(input: unknown): LibrarySnapshotSyncMeta | null {
  if (!isObjectLike(input)) return null;
  const deviceId = normalizeString(input.deviceId);
  if (!deviceId) return null;
  const syncReason = normalizeString(input.syncReason) || 'auto';
  const appVersion = normalizeString(input.appVersion);
  return {
    deviceId,
    syncReason: syncReason as LibrarySnapshotSyncReason,
    watchlistCount: normalizeInteger(input.watchlistCount),
    archiveCount: normalizeInteger(input.archiveCount),
    watchedStateKeyCount: normalizeInteger(input.watchedStateKeyCount),
    userDataCount: normalizeInteger(input.userDataCount),
    totalItemCount: normalizeInteger(input.totalItemCount),
    appVersion,
  };
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
    syncMeta: normalizeSyncMeta(record.syncMeta),
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

function getLibrarySnapshotCounts(snapshot: LibrarySnapshotPayload): LibrarySnapshotCounts {
  const watchlistCount = snapshot.watchlist.length;
  const archiveCount = snapshot.archive.length;
  const watchedStateKeyCount = Object.keys(snapshot.watchedState).length;
  const userDataCount = Object.keys(snapshot.userData).length;
  const totalItemCount = watchlistCount + archiveCount;
  return {
    watchlistCount,
    archiveCount,
    watchedStateKeyCount,
    userDataCount,
    totalItemCount,
    footprintScore: totalItemCount + watchedStateKeyCount + userDataCount,
  };
}

function isSnapshotMuchRicher(richer: LibrarySnapshotCounts, poorer: LibrarySnapshotCounts): boolean {
  if (richer.footprintScore <= poorer.footprintScore) return false;
  if (richer.totalItemCount >= 20 && poorer.totalItemCount <= 5 && richer.totalItemCount - poorer.totalItemCount >= 10) {
    return true;
  }
  if (poorer.footprintScore < richer.footprintScore * 0.25) {
    return true;
  }
  return richer.footprintScore - poorer.footprintScore >= 20;
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

function createLocalDeviceId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `device-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

export async function getOrCreateLocalDeviceId(): Promise<string> {
  const record = await db.kvStore.get(LOCAL_DEVICE_ID_KEY);
  const existingValue =
    typeof record?.value === 'string' ? record.value.trim() : String(record?.value || '').trim();
  if (existingValue) return existingValue;

  const deviceId = createLocalDeviceId();
  await db.kvStore.put({ key: LOCAL_DEVICE_ID_KEY, value: deviceId });
  return deviceId;
}

export function getPendingLibrarySyncConflict(): LibrarySyncConflictContext | null {
  if (!pendingLibrarySyncConflict) return null;
  const { remotePayload: _remotePayload, ...context } = pendingLibrarySyncConflict;
  return context;
}

export function clearPendingLibrarySyncConflict(): void {
  pendingLibrarySyncConflict = null;
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

function buildSnapshotSyncMeta(
  counts: LibrarySnapshotCounts,
  deviceId: string,
  syncReason: LibrarySnapshotSyncReason,
): LibrarySnapshotSyncMeta {
  const appVersion =
    typeof import.meta !== 'undefined' && typeof import.meta.env?.VITE_APP_VERSION === 'string'
      ? import.meta.env.VITE_APP_VERSION
      : null;

  return {
    deviceId,
    syncReason,
    watchlistCount: counts.watchlistCount,
    archiveCount: counts.archiveCount,
    watchedStateKeyCount: counts.watchedStateKeyCount,
    userDataCount: counts.userDataCount,
    totalItemCount: counts.totalItemCount,
    appVersion,
  };
}

async function buildLocalLibrarySnapshotForSync(syncReason: LibrarySnapshotSyncReason): Promise<{
  payload: LibrarySnapshotPayload;
  counts: LibrarySnapshotCounts;
  deviceId: string;
}> {
  const payload = normalizeLibraryPayload(buildLocalLibrarySnapshot());
  const counts = getLibrarySnapshotCounts(payload);
  const deviceId = await getOrCreateLocalDeviceId();
  payload.syncMeta = buildSnapshotSyncMeta(counts, deviceId, syncReason);
  return { payload, counts, deviceId };
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

export async function pushLocalLibrarySnapshot(_userId: string): Promise<void> {
  if (!isSupabaseConfigured()) return;
  const client = getSupabaseClient();
  const { payload, counts, deviceId } = await buildLocalLibrarySnapshotForSync('auto');
  assertSerializedJsonLimit(payload, MAX_LIBRARY_SNAPSHOT_SIZE_BYTES, 'O snapshot da biblioteca');
  let { error } = await client.rpc('upsert_library_snapshot', {
    p_schema_version: LIBRARY_SNAPSHOT_SCHEMA_VERSION,
    p_payload: payload,
    p_sync_reason: 'auto',
    p_device_id: deviceId,
    p_watchlist_count: counts.watchlistCount,
    p_archive_count: counts.archiveCount,
    p_watched_state_key_count: counts.watchedStateKeyCount,
    p_user_data_count: counts.userDataCount,
    p_total_item_count: counts.totalItemCount,
  });
  if (error && /upsert_library_snapshot/i.test(error.message || '')) {
    const fallbackResult = await client.rpc('upsert_library_snapshot', {
      p_schema_version: LIBRARY_SNAPSHOT_SCHEMA_VERSION,
      p_payload: payload,
    });
    error = fallbackResult.error;
  }
  if (error) throw error;
}

export async function pushLocalLibrarySnapshotWithReason(
  _userId: string,
  syncReason: LibrarySnapshotSyncReason,
): Promise<void> {
  if (!isSupabaseConfigured()) return;
  const client = getSupabaseClient();
  const { payload, counts, deviceId } = await buildLocalLibrarySnapshotForSync(syncReason);
  assertSerializedJsonLimit(payload, MAX_LIBRARY_SNAPSHOT_SIZE_BYTES, 'O snapshot da biblioteca');
  let { error } = await client.rpc('upsert_library_snapshot', {
    p_schema_version: LIBRARY_SNAPSHOT_SCHEMA_VERSION,
    p_payload: payload,
    p_sync_reason: syncReason,
    p_device_id: deviceId,
    p_watchlist_count: counts.watchlistCount,
    p_archive_count: counts.archiveCount,
    p_watched_state_key_count: counts.watchedStateKeyCount,
    p_user_data_count: counts.userDataCount,
    p_total_item_count: counts.totalItemCount,
  });
  if (error && /upsert_library_snapshot/i.test(error.message || '')) {
    const fallbackResult = await client.rpc('upsert_library_snapshot', {
      p_schema_version: LIBRARY_SNAPSHOT_SCHEMA_VERSION,
      p_payload: payload,
    });
    error = fallbackResult.error;
  }
  if (error) throw error;
}

export async function applyRemoteLibrarySnapshotToLocal(rawPayload: unknown, remoteUpdatedAtIso: string): Promise<void> {
  const payload = normalizeLibraryPayload(rawPayload);
  assertSerializedJsonLimit(payload, MAX_LIBRARY_SNAPSHOT_SIZE_BYTES, 'O snapshot remoto da biblioteca');

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
      notes: clampUserNotes(data?.notes),
      progress_percent: clampProgressPercent(data?.progress_percent),
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

export async function restoreLibrarySnapshotFromCloud(userId: string): Promise<LibrarySyncOutcome> {
  if (!isSupabaseConfigured()) return 'disabled';
  const remoteRow = await fetchRemoteLibrarySnapshot(userId);
  if (!remoteRow) return 'noop';
  const remotePayload = normalizeLibraryPayload(remoteRow.payload);
  if (!hasMeaningfulLibraryData(remotePayload)) return 'noop';
  pendingLibrarySyncConflict = null;
  await applyRemoteLibrarySnapshotToLocal(remotePayload, remoteRow.updated_at);
  return 'pulled';
}

export async function replaceRemoteLibrarySnapshotWithLocal(
  userId: string,
  syncReason: LibrarySnapshotSyncReason = 'manual_replace_cloud',
): Promise<LibrarySyncOutcome> {
  if (!isSupabaseConfigured()) return 'disabled';
  pendingLibrarySyncConflict = null;
  await pushLocalLibrarySnapshotWithReason(userId, syncReason);
  await markLocalLibraryMutation(new Date().toISOString());
  return 'pushed';
}

export async function getLibrarySyncStatusSummary(userId: string): Promise<LibrarySyncStatusSummary> {
  const localSnapshot = buildLocalLibrarySnapshot();
  const localCounts = getLibrarySnapshotCounts(localSnapshot);
  const localMutationAt = await getLocalLibraryMutationAt();
  const localDeviceId = await getOrCreateLocalDeviceId();

  if (!isSupabaseConfigured()) {
    return {
      localDeviceId,
      localMutationAt,
      localCounts,
      remoteAvailable: false,
      remoteUpdatedAt: null,
      remoteCounts: null,
      remoteDeviceId: null,
      remoteSyncReason: null,
      pendingConflict: getPendingLibrarySyncConflict(),
    };
  }

  const remoteRow = await fetchRemoteLibrarySnapshot(userId);
  if (!remoteRow) {
    return {
      localDeviceId,
      localMutationAt,
      localCounts,
      remoteAvailable: false,
      remoteUpdatedAt: null,
      remoteCounts: null,
      remoteDeviceId: null,
      remoteSyncReason: null,
      pendingConflict: getPendingLibrarySyncConflict(),
    };
  }

  const remotePayload = normalizeLibraryPayload(remoteRow.payload);
  return {
    localDeviceId,
    localMutationAt,
    localCounts,
    remoteAvailable: hasMeaningfulLibraryData(remotePayload),
    remoteUpdatedAt: remoteRow.updated_at,
    remoteCounts: getLibrarySnapshotCounts(remotePayload),
    remoteDeviceId: remotePayload.syncMeta?.deviceId ?? null,
    remoteSyncReason: remotePayload.syncMeta?.syncReason ?? null,
    pendingConflict: getPendingLibrarySyncConflict(),
  };
}

export async function resolvePendingLibrarySyncConflict(choice: 'use_remote' | 'use_local'): Promise<LibrarySyncOutcome> {
  if (!pendingLibrarySyncConflict) return 'noop';
  const conflict = pendingLibrarySyncConflict;
  pendingLibrarySyncConflict = null;

  if (choice === 'use_remote') {
    await applyRemoteLibrarySnapshotToLocal(conflict.remotePayload, conflict.remoteUpdatedAt);
    return 'pulled';
  }

  await pushLocalLibrarySnapshotWithReason(conflict.userId, 'post_login_conflict_local');
  await markLocalLibraryMutation(new Date().toISOString());
  return 'pushed';
}

export async function syncLibrarySnapshotAfterLogin(userId: string): Promise<LibrarySyncOutcome> {
  if (!isSupabaseConfigured()) return 'disabled';
  pendingLibrarySyncConflict = null;

  const localSnapshot = buildLocalLibrarySnapshot();
  const localHasData = hasMeaningfulLibraryData(localSnapshot);
  const localCounts = getLibrarySnapshotCounts(localSnapshot);
  const localMutationAt = await getLocalLibraryMutationAt();
  const localMutationTs = parseIsoDate(localMutationAt);

  const remoteRow = await fetchRemoteLibrarySnapshot(userId);
  if (!remoteRow) {
    if (!localHasData) return 'noop';
    await pushLocalLibrarySnapshotWithReason(userId, 'post_login_local_seed');
    await markLocalLibraryMutation(new Date().toISOString());
    return 'pushed';
  }

  const remotePayload = normalizeLibraryPayload(remoteRow.payload);
  const remoteHasData = hasMeaningfulLibraryData(remotePayload);
  const remoteCounts = getLibrarySnapshotCounts(remotePayload);
  const remoteUpdatedTs = parseIsoDate(remoteRow.updated_at);

  if (!remoteHasData) {
    if (!localHasData) return 'noop';
    await pushLocalLibrarySnapshotWithReason(userId, 'post_login_local_seed');
    await markLocalLibraryMutation(new Date().toISOString());
    return 'pushed';
  }

  if (!localHasData) {
    await applyRemoteLibrarySnapshotToLocal(remotePayload, remoteRow.updated_at);
    return 'pulled';
  }

  if (isSnapshotMuchRicher(remoteCounts, localCounts)) {
    pendingLibrarySyncConflict = {
      userId,
      localMutationAt,
      remoteUpdatedAt: remoteRow.updated_at,
      localCounts,
      remoteCounts,
      remotePayload,
    };
    return 'conflict_remote_richer';
  }

  if (isSnapshotMuchRicher(localCounts, remoteCounts)) {
    pendingLibrarySyncConflict = {
      userId,
      localMutationAt,
      remoteUpdatedAt: remoteRow.updated_at,
      localCounts,
      remoteCounts,
      remotePayload,
    };
    return 'conflict_local_richer';
  }

  // Proteção contra migrações antigas sem timestamp local: priorizar local para evitar perda de dados.
  if (Number.isNaN(localMutationTs)) {
    await pushLocalLibrarySnapshotWithReason(userId, 'post_login_local_seed');
    await markLocalLibraryMutation(new Date().toISOString());
    return 'pushed';
  }

  if (!Number.isNaN(localMutationTs) && !Number.isNaN(remoteUpdatedTs) && localMutationTs > remoteUpdatedTs + 1000) {
    await pushLocalLibrarySnapshotWithReason(userId, 'auto');
    await markLocalLibraryMutation(new Date().toISOString());
    return 'pushed';
  }

  if (!Number.isNaN(remoteUpdatedTs) && (Number.isNaN(localMutationTs) || remoteUpdatedTs > localMutationTs + 1000)) {
    await applyRemoteLibrarySnapshotToLocal(remotePayload, remoteRow.updated_at);
    return 'pulled';
  }

  return 'noop';
}
