import { MediaType, Series } from './types';

type SeriesLike = Omit<Series, 'media_type'> & { media_type?: MediaType | null };
export type MediaKeyParts = { media_type: MediaType; media_id: number };
const SCOPED_ID_RANGE = 1_000_000_000;
const MOVIE_ID_OFFSET = 1_000_000_000;
const BOOK_ID_OFFSET = 2_000_000_000;

function isSeriesLike(value: unknown): value is SeriesLike {
  return typeof value === 'object' && value !== null;
}

function normalizeMediaType(value: MediaType | null | undefined): MediaType {
  if (value === 'series' || value === 'movie' || value === 'book') return value;
  return 'series';
}

function normalizeMediaId(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function hashStringToPositiveInt(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function toScopedMovieId(tmdbMovieId: number): number {
  const raw = Math.abs(Math.trunc(Number(tmdbMovieId) || 0));
  return MOVIE_ID_OFFSET + (raw % SCOPED_ID_RANGE);
}

export function fromScopedMovieId(scopedMovieId: number): number {
  const raw = Math.abs(Math.trunc(Number(scopedMovieId) || 0));
  return raw >= MOVIE_ID_OFFSET ? raw - MOVIE_ID_OFFSET : raw;
}

export function toScopedBookId(sourceId: string): number {
  const hash = hashStringToPositiveInt(String(sourceId || 'unknown'));
  return BOOK_ID_OFFSET + (hash % SCOPED_ID_RANGE);
}

export function createMediaKey(mediaType: MediaType, mediaId: number): string {
  return `${normalizeMediaType(mediaType)}:${mediaId}`;
}

export function getSeriesMediaKey(seriesId: number): string {
  return createMediaKey('series', seriesId);
}

export function parseMediaKey(value: unknown): MediaKeyParts | null {
  if (typeof value === 'number') {
    const mediaId = normalizeMediaId(value);
    if (mediaId === null) return null;
    return { media_type: 'series', media_id: mediaId };
  }

  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (!trimmed.includes(':')) {
    const mediaId = normalizeMediaId(trimmed);
    if (mediaId === null) return null;
    return { media_type: 'series', media_id: mediaId };
  }

  const [rawType, rawId] = trimmed.split(':', 2);
  const mediaType = normalizeMediaType(rawType as MediaType);
  const mediaId = normalizeMediaId(rawId);
  if (mediaId === null) return null;
  return { media_type: mediaType, media_id: mediaId };
}

export function normalizeSeries<T extends SeriesLike>(series: T): T & { media_type: MediaType } {
  return {
    ...series,
    media_type: normalizeMediaType(series.media_type),
  };
}

export function normalizeSeriesCollection(input: unknown): Series[] {
  if (!Array.isArray(input)) return [];
  return input.filter(isSeriesLike).map((entry) => normalizeSeries(entry));
}
