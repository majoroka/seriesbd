import type { Series } from './types';
import { toScopedBookId, toScopedMovieId } from './media';

export type PublicShareRoute =
  | { mediaType: 'series'; tmdbId: number }
  | { mediaType: 'movie'; tmdbId: number }
  | { mediaType: 'book'; provider: BookShareProvider; sourceId: string };

export type BookShareProvider = 'google_books' | 'open_library' | 'goodreads';

const SHARE_ROOT_SEGMENT = 'partilhar';
const BOOK_PROVIDERS = new Set<BookShareProvider>(['google_books', 'open_library', 'goodreads']);

function decodePathSegment(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value).trim();
    return decoded && !/[\u0000-\u001f]/.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

function parsePositiveId(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function isPublicSharePath(pathname: string): boolean {
  const segments = String(pathname || '').split('/').filter(Boolean);
  return segments[0] === SHARE_ROOT_SEGMENT;
}

export function parsePublicShareRoute(pathname: string): PublicShareRoute | null {
  const segments = String(pathname || '').split('/').filter(Boolean);
  if (segments[0] !== SHARE_ROOT_SEGMENT) return null;

  const mediaType = segments[1];
  if ((mediaType === 'serie' || mediaType === 'filme') && segments.length === 3) {
    const tmdbId = parsePositiveId(segments[2]);
    if (!tmdbId) return null;
    return mediaType === 'serie'
      ? { mediaType: 'series', tmdbId }
      : { mediaType: 'movie', tmdbId };
  }

  if (mediaType !== 'livro' || segments.length !== 4) return null;
  const provider = decodePathSegment(segments[2]) as BookShareProvider | null;
  const sourceId = decodePathSegment(segments[3]);
  if (!provider || !BOOK_PROVIDERS.has(provider) || !sourceId || sourceId.length > 500) return null;
  return { mediaType: 'book', provider, sourceId };
}

export function createPublicShareMedia(route: Exclude<PublicShareRoute, { mediaType: 'series' }>): Series {
  if (route.mediaType === 'movie') {
    return {
      id: toScopedMovieId(route.tmdbId),
      media_type: 'movie',
      source_provider: 'tmdb_movie',
      source_id: String(route.tmdbId),
      name: 'Filme partilhado',
      overview: '',
      poster_path: null,
      backdrop_path: null,
      first_air_date: '',
      genres: [],
    };
  }

  return {
    id: toScopedBookId(route.sourceId),
    media_type: 'book',
    source_provider: route.provider,
    source_id: route.sourceId,
    name: 'Livro partilhado',
    overview: '',
    poster_path: null,
    backdrop_path: null,
    first_air_date: '',
    genres: [],
  };
}
