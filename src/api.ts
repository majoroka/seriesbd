import { db } from "./db";
import { SEASON_CACHE_DURATION } from "./constants";
import { fetchWithRetry } from "./utils";
import {
    Series,
    ExternalReview,
    DashboardNewsItem,
    DashboardNewsResponse,
    TMDbSeriesDetails,
    TMDbCredits,
    TraktData,
    TraktSeason,
    TMDbSeason,
    TVMazeResolveData,
    AggregatedSeriesMetadata,
    AggregatedOverviewCandidate,
    ProviderSource,
} from "./types";
import { fromScopedMovieId, normalizeSeries, normalizeSeriesCollection, toScopedBookId, toScopedMovieId } from "./media";

const API_BASE_TMDB = '/api/tmdb';
const API_BASE_TRAKT = '/api/trakt';
const API_BASE_TVMAZE = '/api/tvmaze';
const API_BASE_NEWS = '/api/news';
const RETRY_FAST = { retries: 2, backoff: 250 };
const RETRY_STANDARD = { retries: 2, backoff: 500 };
type DiscoverPremieresOptions = {
    fromDate?: string;
    sortBy?: string;
    genreIds?: number[];
    withOriginalLanguage?: boolean;
};

type DiscoverCatalogOptions = {
    sortBy?: string;
    genreIds?: number[];
    withOriginalLanguage?: boolean;
};

function extractStatusFromError(error: unknown): number | null {
    if (typeof error === 'object' && error !== null && 'status' in error) {
        const status = Number((error as { status?: unknown }).status);
        if (!Number.isNaN(status) && status > 0) return status;
    }

    const message = error instanceof Error ? error.message : String(error);
    const match = message.match(/(\d{3})/);
    if (!match) return null;
    const parsed = Number(match[1]);
    return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Pesquisa por séries no TMDb com base numa query.
 * @param {string} query - O termo de pesquisa.
 * @param {AbortSignal} signal - O sinal para abortar o pedido.
 */
export async function searchSeries(query: string, signal: AbortSignal): Promise<{ results: Series[] }> {
    const normalizedQuery = normalizeSearchToken(query);
    const searchUrl = `${API_BASE_TMDB}/search/tv?query=${encodeURIComponent(query)}&language=pt-PT`;
    const response = await fetchWithRetry(searchUrl, { signal }, RETRY_FAST.retries, RETRY_FAST.backoff);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const payload = await response.json() as { results: unknown };
    const titleResults = normalizeSeriesCollection(payload.results);

    if (normalizedQuery.length < 3) {
        return { results: titleResults };
    }

    try {
        const personResults = await searchPeople(query, signal);
        const relatedCandidates = personResults
            .map((person) => ({
                person,
                score: scorePersonSearchResult(person, query, 'series'),
            }))
            .filter((entry) => entry.score >= 1.85)
            .sort((left, right) => right.score - left.score)
            .slice(0, 2);

        if (relatedCandidates.length === 0) {
            return { results: titleResults };
        }

        const relatedEntries = (
            await Promise.all(
                relatedCandidates.map(async ({ person }) => fetchRelatedMediaByPerson(person.id, 'series', signal))
            )
        ).flat();

        return { results: mergeSearchResults(titleResults, relatedEntries, 'series') };
    } catch (error) {
        console.warn('[search] Falha no enriquecimento por pessoa para séries.', error);
        return { results: titleResults };
    }
}

function mapMovieSearchResult(rawMovie: any): Series {
    const tmdbId = Number(rawMovie?.id || 0);
    const safeTmdbId = Number.isNaN(tmdbId) ? 0 : tmdbId;
    const title = String(rawMovie?.title || rawMovie?.name || '').trim();
    const originalTitle = String(rawMovie?.original_title || rawMovie?.original_name || title).trim();

    return normalizeSeries({
        id: toScopedMovieId(safeTmdbId),
        media_type: 'movie',
        source_provider: 'tmdb_movie',
        source_id: String(safeTmdbId),
        name: title || 'Filme sem título',
        original_name: originalTitle || undefined,
        overview: String(rawMovie?.overview || ''),
        poster_path: rawMovie?.poster_path || null,
        backdrop_path: rawMovie?.backdrop_path || null,
        first_air_date: String(rawMovie?.release_date || ''),
        genres: [],
        vote_average: typeof rawMovie?.vote_average === 'number' ? rawMovie.vote_average : undefined,
    } as Series);
}

function normalizeSearchToken(value: string): string {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function scorePersonSearchResult(
    person: { name?: string | null; popularity?: number | null; known_for_department?: string | null },
    query: string,
    mediaType: 'series' | 'movie'
): number {
    const normalizedQuery = normalizeSearchToken(query);
    const normalizedName = normalizeSearchToken(person?.name || '');
    if (!normalizedQuery || !normalizedName) return -1;

    let score = 0;
    if (normalizedName === normalizedQuery) score += 3;
    else if (normalizedName.startsWith(normalizedQuery)) score += 2;
    else if (normalizedName.includes(normalizedQuery)) score += 1;
    else return -1;

    const department = String(person?.known_for_department || '').trim().toLowerCase();
    if (mediaType === 'movie') {
        if (department === 'directing') score += 1.25;
        else if (department === 'writing') score += 1;
        else if (department === 'acting') score += 0.75;
    } else {
        if (department === 'acting') score += 1;
        else if (department === 'writing' || department === 'production') score += 0.85;
        else if (department === 'directing') score += 0.65;
    }

    const popularity = Number(person?.popularity || 0);
    score += Math.min(1, popularity / 20);
    return Number(score.toFixed(3));
}

async function searchPeople(query: string, signal: AbortSignal): Promise<Array<{ id: number; name: string; popularity?: number; known_for_department?: string }>> {
    const searchUrl = `${API_BASE_TMDB}/search/person?query=${encodeURIComponent(query)}&language=pt-PT`;
    const response = await fetchWithRetry(searchUrl, { signal }, RETRY_FAST.retries, RETRY_FAST.backoff);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const payload = await response.json() as { results?: Array<{ id: number; name: string; popularity?: number; known_for_department?: string }> };
    return Array.isArray(payload.results) ? payload.results : [];
}

type PersonCreditEntry = {
    id: number;
    media_type?: 'tv' | 'movie' | string;
    name?: string;
    title?: string;
    original_name?: string;
    original_title?: string;
    overview?: string;
    poster_path?: string | null;
    backdrop_path?: string | null;
    first_air_date?: string;
    release_date?: string;
    vote_average?: number;
    popularity?: number;
    genre_ids?: number[];
    character?: string | null;
    job?: string | null;
};

type RelatedMediaEntry = {
    item: Series;
    relevance: number;
};

function scoreMovieCreditRelevance(entry: PersonCreditEntry): number {
    const job = String(entry.job || '').trim();
    if (job === 'Director') return 5;
    if (job === 'Writer' || job === 'Screenplay' || job === 'Story') return 4;
    if (job === 'Novel' || job === 'Characters') return 3;
    if (job === 'Producer' || job === 'Executive Producer') return 2;
    if (entry.character) return 1;
    return 0;
}

function scoreSeriesCreditRelevance(entry: PersonCreditEntry): number {
    const job = String(entry.job || '').trim();
    if (job === 'Creator') return 5;
    if (job === 'Writer' || job === 'Screenplay' || job === 'Story') return 4;
    if (job === 'Executive Producer' || job === 'Producer') return 3;
    if (job === 'Director') return 2;
    if (entry.character) return 1;
    return 0;
}

async function fetchRelatedMediaByPerson(
    personId: number,
    mediaType: 'series' | 'movie',
    signal: AbortSignal
): Promise<RelatedMediaEntry[]> {
    const url = `${API_BASE_TMDB}/person/${personId}/combined_credits?language=pt-PT`;
    const response = await fetchWithRetry(url, { signal }, RETRY_STANDARD.retries, RETRY_STANDARD.backoff);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const payload = await response.json() as { cast?: PersonCreditEntry[]; crew?: PersonCreditEntry[] };

    const relatedEntries: RelatedMediaEntry[] = [];
    const appendEntry = (entry: PersonCreditEntry, relevance: number) => {
        if (mediaType === 'movie') {
            relatedEntries.push({
                item: mapMovieSearchResult(entry),
                relevance: relevance + Math.min(1, Number(entry.popularity || 0) / 20),
            });
            return;
        }
        relatedEntries.push({
            item: normalizeSeries({
                ...entry,
                media_type: 'series',
                name: String(entry.name || entry.original_name || ''),
                original_name: String(entry.original_name || entry.name || ''),
                first_air_date: String(entry.first_air_date || ''),
                genres: [],
            } as Series),
            relevance: relevance + Math.min(1, Number(entry.popularity || 0) / 20),
        });
    };

    const castEntries = Array.isArray(payload.cast) ? payload.cast : [];
    const crewEntries = Array.isArray(payload.crew) ? payload.crew : [];

    castEntries.forEach((entry) => {
        if (mediaType === 'movie' && entry.media_type !== 'movie') return;
        if (mediaType === 'series' && entry.media_type !== 'tv') return;
        if (!entry.id) return;
        appendEntry(entry, mediaType === 'movie' ? scoreMovieCreditRelevance(entry) : scoreSeriesCreditRelevance(entry));
    });

    crewEntries.forEach((entry) => {
        if (mediaType === 'movie' && entry.media_type !== 'movie') return;
        if (mediaType === 'series' && entry.media_type !== 'tv') return;
        if (!entry.id) return;
        appendEntry(entry, mediaType === 'movie' ? scoreMovieCreditRelevance(entry) : scoreSeriesCreditRelevance(entry));
    });

    return relatedEntries
        .filter((entry) => entry.relevance > 0 && entry.item.id && entry.item.name)
        .sort((left, right) => {
            if (right.relevance !== left.relevance) return right.relevance - left.relevance;
            const ratingDiff = (Number(right.item.vote_average) || 0) - (Number(left.item.vote_average) || 0);
            if (ratingDiff !== 0) return ratingDiff;
            return left.item.name.localeCompare(right.item.name, 'pt-PT');
        });
}

function mergeSearchResults(
    primaryResults: Series[],
    relatedEntries: RelatedMediaEntry[],
    mediaType: 'series' | 'movie'
): Series[] {
    const merged = new Map<string, Series>();
    primaryResults.forEach((item) => {
        const key = `${item.media_type || mediaType}:${item.id}`;
        if (!merged.has(key)) merged.set(key, item);
    });

    relatedEntries.forEach((entry) => {
        const key = `${entry.item.media_type || mediaType}:${entry.item.id}`;
        if (!merged.has(key)) {
            merged.set(key, entry.item);
        }
    });

    return Array.from(merged.values()).slice(0, 24);
}

export async function searchMovies(query: string, signal: AbortSignal): Promise<{ results: Series[] }> {
    const normalizedQuery = normalizeSearchToken(query);
    const searchUrl = `${API_BASE_TMDB}/search/movie?query=${encodeURIComponent(query)}&language=pt-PT`;
    const response = await fetchWithRetry(searchUrl, { signal }, RETRY_FAST.retries, RETRY_FAST.backoff);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const payload = await response.json() as { results?: unknown[] };
    const titleResults = Array.isArray(payload.results) ? payload.results.map(mapMovieSearchResult) : [];

    if (normalizedQuery.length < 3) {
        return { results: titleResults };
    }

    try {
        const personResults = await searchPeople(query, signal);
        const relatedCandidates = personResults
            .map((person) => ({
                person,
                score: scorePersonSearchResult(person, query, 'movie'),
            }))
            .filter((entry) => entry.score >= 2)
            .sort((left, right) => right.score - left.score)
            .slice(0, 2);

        if (relatedCandidates.length === 0) {
            return { results: titleResults };
        }

        const relatedEntries = (
            await Promise.all(
                relatedCandidates.map(async ({ person }) => fetchRelatedMediaByPerson(person.id, 'movie', signal))
            )
        ).flat();

        return { results: mergeSearchResults(titleResults, relatedEntries, 'movie') };
    } catch (error) {
        console.warn('[search] Falha no enriquecimento por pessoa para filmes.', error);
        return { results: titleResults };
    }
}

export async function fetchMovieDetails(
    scopedMovieId: number,
    signal: AbortSignal | null,
    sourceId?: string
): Promise<Series> {
    const fallbackTmdbId = fromScopedMovieId(scopedMovieId);
    const parsedSourceId = Number(sourceId);
    const tmdbMovieId = Number.isFinite(parsedSourceId) ? Math.trunc(parsedSourceId) : fallbackTmdbId;
    const detailsUrl = `${API_BASE_TMDB}/movie/${tmdbMovieId}?append_to_response=videos&language=pt-PT`;
    const response = await fetchWithRetry(detailsUrl, { signal }, RETRY_STANDARD.retries, RETRY_STANDARD.backoff);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const payload = await response.json() as any;
    const initialVideos = Array.isArray(payload?.videos?.results) ? payload.videos.results : [];
    let mergedVideos = [...initialVideos];
    const hasYouTubeVideo = mergedVideos.some((video: any) => video?.site === 'YouTube');

    if (!hasYouTubeVideo) {
        try {
            const fallbackVideosResponse = await fetchWithRetry(
                `${API_BASE_TMDB}/movie/${tmdbMovieId}/videos?language=en-US`,
                { signal },
                RETRY_STANDARD.retries,
                RETRY_STANDARD.backoff
            );
            if (fallbackVideosResponse.ok) {
                const fallbackVideosPayload = await fallbackVideosResponse.json() as { results?: any[] };
                const fallbackVideos = Array.isArray(fallbackVideosPayload?.results) ? fallbackVideosPayload.results : [];
                mergedVideos = [...mergedVideos, ...fallbackVideos].filter((video, index, arr) =>
                    arr.findIndex((candidate) => candidate?.key === video?.key) === index
                );
            }
        } catch (error) {
            console.warn('[movies] Falha ao carregar vídeos fallback en-US.', error);
        }
    }

    return normalizeSeries({
        id: toScopedMovieId(tmdbMovieId),
        media_type: 'movie',
        source_provider: 'tmdb_movie',
        source_id: String(tmdbMovieId),
        name: String(payload?.title || payload?.name || 'Filme sem título'),
        original_name: String(payload?.original_title || payload?.original_name || payload?.title || ''),
        overview: String(payload?.overview || ''),
        poster_path: payload?.poster_path || null,
        backdrop_path: payload?.backdrop_path || null,
        first_air_date: String(payload?.release_date || ''),
        genres: Array.isArray(payload?.genres) ? payload.genres : [],
        vote_average: typeof payload?.vote_average === 'number' ? payload.vote_average : undefined,
        episode_run_time: typeof payload?.runtime === 'number' ? payload.runtime : undefined,
        production_companies: Array.isArray(payload?.production_companies) ? payload.production_companies : [],
        production_countries: Array.isArray(payload?.production_countries) ? payload.production_countries : [],
        videos: { results: mergedVideos },
    } as Series);
}

function mapTmdbReview(rawReview: any): ExternalReview | null {
    const content = String(rawReview?.content || '').trim();
    if (!content) return null;
    const authorDetails = rawReview?.author_details || {};
    const author = String(
        authorDetails?.name
        || authorDetails?.username
        || rawReview?.author
        || 'Utilizador anónimo'
    ).trim();
    const rating = typeof authorDetails?.rating === 'number' ? authorDetails.rating : null;
    return {
        id: String(rawReview?.id || `${author}-${rawReview?.created_at || rawReview?.updated_at || content.slice(0, 32)}`),
        source: 'TMDb',
        sourceKey: 'tmdb',
        author: author || 'Utilizador anónimo',
        authorUrl: rawReview?.url || null,
        rating,
        createdAt: typeof rawReview?.created_at === 'string' ? rawReview.created_at : null,
        updatedAt: typeof rawReview?.updated_at === 'string' ? rawReview.updated_at : null,
        content,
        url: rawReview?.url || null,
        language: typeof rawReview?.author_details?.language === 'string' ? rawReview.author_details.language : null,
    };
}

export async function fetchTmdbExternalReviews(
    mediaType: 'series' | 'movie',
    sourceId: number | string,
    signal: AbortSignal | null
): Promise<ExternalReview[]> {
    const tmdbMediaType = mediaType === 'movie' ? 'movie' : 'tv';
    const resolvedId = mediaType === 'movie'
        ? (() => {
            const parsedSourceId = Number(sourceId);
            return Number.isFinite(parsedSourceId) ? Math.trunc(parsedSourceId) : fromScopedMovieId(Number(sourceId));
        })()
        : Math.trunc(Number(sourceId));

    if (!Number.isFinite(resolvedId) || resolvedId <= 0) return [];

    const fetchReviewsForLanguage = async (language: string): Promise<ExternalReview[]> => {
        const url = `${API_BASE_TMDB}/${tmdbMediaType}/${resolvedId}/reviews?language=${language}&page=1`;
        const response = await fetchWithRetry(url, { signal }, RETRY_STANDARD.retries, RETRY_STANDARD.backoff);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const payload = await response.json() as { results?: any[] };
        return (Array.isArray(payload?.results) ? payload.results : [])
            .map(mapTmdbReview)
            .filter((review): review is ExternalReview => Boolean(review));
    };

    const ptReviews = await fetchReviewsForLanguage('pt-PT');
    if (ptReviews.length > 0) return ptReviews.slice(0, 15);

    const enReviews = await fetchReviewsForLanguage('en-US');
    return enReviews.slice(0, 15);
}

export async function searchBooks(query: string, signal: AbortSignal): Promise<{ results: Series[] }> {
    const searchUrl = `/api/books/search?query=${encodeURIComponent(query)}`;
    const response = await fetchWithRetry(searchUrl, { signal }, RETRY_FAST.retries, RETRY_FAST.backoff);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const payload = await response.json() as { results?: unknown[] };
    const normalizedResults = normalizeSeriesCollection(payload.results);
    const results = normalizedResults.map((item) => {
        if (item.media_type !== 'book') {
            return normalizeSeries({
                ...item,
                media_type: 'book',
                id: toScopedBookId(String(item.id)),
                overview: sanitizeOverview(item.overview),
            });
        }
        return normalizeSeries({
            ...item,
            id: toScopedBookId(String(item.source_id || item.id)),
            overview: sanitizeOverview(item.overview),
        });
    });
    return { results };
}

export async function fetchBookDetails(book: Series, signal: AbortSignal | null): Promise<Series> {
    const sourceId = String(book.source_id || '').trim();
    const provider = String(book.source_provider || '').trim();
    const isbn = String(book.isbn || book.isbn_13 || book.isbn_10 || '').trim();
    const params = new URLSearchParams();
    if (sourceId) params.set('source_id', sourceId);
    if (provider) params.set('provider', provider);
    if (book.name) params.set('query', book.name);
    if (isbn) params.set('isbn', isbn);
    const detailsUrl = `/api/books/details?${params.toString()}`;

    try {
        const response = await fetchWithRetry(detailsUrl, { signal }, RETRY_STANDARD.retries, RETRY_STANDARD.backoff);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const payload = await response.json() as { result?: unknown };
        const rawResult = payload?.result;
        if (rawResult && typeof rawResult === 'object') {
            const normalizedDetails = normalizeSeries(rawResult as Series);
            const normalizedSourceId = String((normalizedDetails.source_id || sourceId || book.id));
            return normalizeSeries({
                ...book,
                ...normalizedDetails,
                media_type: 'book',
                source_id: normalizedSourceId,
                id: book.id,
                author: normalizedDetails.author || book.author,
                overview: sanitizeOverview(normalizedDetails.overview || book.overview),
            });
        }
    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            throw error;
        }
        console.warn('[books] Falha ao carregar detalhe remoto. A usar dados locais.', error);
    }

    return normalizeSeries({
        ...book,
        media_type: 'book',
        source_id: sourceId || String(book.id),
        id: book.id,
        author: book.author,
        overview: sanitizeOverview(book.overview),
    });
}

export async function searchByMediaType(
    mediaType: 'series' | 'movie' | 'book',
    query: string,
    signal: AbortSignal
): Promise<{ results: Series[] }> {
    if (mediaType === 'movie') return searchMovies(query, signal);
    if (mediaType === 'book') return searchBooks(query, signal);
    return searchSeries(query, signal);
}

export async function fetchDashboardNews(
    limit = 8,
    type: 'all' | 'series' | 'movie' | 'book' = 'all',
    signal?: AbortSignal | null
): Promise<DashboardNewsItem[]> {
    const params = new URLSearchParams();
    params.set('limit', String(Math.max(1, Math.min(24, Math.trunc(limit) || 8))));
    params.set('type', type);
    const response = await fetchWithRetry(`${API_BASE_NEWS}?${params.toString()}`, { signal: signal || undefined }, RETRY_FAST.retries, RETRY_FAST.backoff);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const payload = await response.json() as DashboardNewsResponse;
    return Array.isArray(payload.items) ? payload.items : [];
}

/**
 * Busca as séries em tendência no TMDb.
 * @param {'day' | 'week'} timeWindow - O período de tempo.
 * @param {AbortSignal} signal - O sinal para abortar o pedido.
 */
export async function fetchTrending(
    timeWindow: 'day' | 'week',
    signal: AbortSignal,
    mediaType: 'series' | 'movie' = 'series'
): Promise<{ results: Series[] }> {
    const tmdbMediaType = mediaType === 'movie' ? 'movie' : 'tv';
    const url = `${API_BASE_TMDB}/trending/${tmdbMediaType}/${timeWindow}?language=pt-PT`;
    const response = await fetchWithRetry(url, { signal }, RETRY_FAST.retries, RETRY_FAST.backoff);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const payload = await response.json() as { results: unknown };
    const normalized = normalizeSeriesCollection(payload.results);
    if (mediaType === 'movie') {
        return { results: normalized.map((item) => mapMovieSearchResult(item)) };
    }
    return { results: normalized };
}

export async function fetchDiscoverCatalog(
    page: number,
    signal: AbortSignal | null = null,
    mediaType: 'series' | 'movie' = 'series',
    options: DiscoverCatalogOptions = {}
): Promise<{ results: Series[], page: number, total_pages: number }> {
    const tmdbMediaType = mediaType === 'movie' ? 'movie' : 'tv';
    const params = new URLSearchParams({
        language: 'pt-PT',
        page: String(page),
        sort_by: options.sortBy || 'popularity.desc',
    });
    if (Array.isArray(options.genreIds) && options.genreIds.length > 0) {
        params.set('with_genres', options.genreIds.join(','));
    }
    if (options.withOriginalLanguage === true) {
        params.set('with_original_language', 'en');
    }
    const url = `${API_BASE_TMDB}/discover/${tmdbMediaType}?${params.toString()}`;
    const response = await fetchWithRetry(url, { signal: signal || undefined }, RETRY_FAST.retries, RETRY_FAST.backoff);
    if (!response.ok) {
        throw new Error(mediaType === 'movie'
            ? 'Não foi possível buscar os filmes por género.'
            : 'Não foi possível buscar as séries por género.');
    }
    const payload = await response.json() as { results: unknown; page: number; total_pages: number };
    const normalized = normalizeSeriesCollection(payload.results);
    return {
        results: mediaType === 'movie' ? normalized.map((item) => mapMovieSearchResult(item)) : normalized,
        page: payload.page,
        total_pages: payload.total_pages,
    };
}

/**
 * Busca os detalhes completos de uma série na API.
 * @param {string} seriesId - O ID da série.
 * @param {AbortSignal} signal - O sinal para abortar o pedido.
 */
export async function fetchSeriesDetails(seriesId: number, signal: AbortSignal | null): Promise<TMDbSeriesDetails> {
    const url = `${API_BASE_TMDB}/tv/${seriesId}?append_to_response=videos,external_ids&language=pt-PT`;
    try {
        const response = await fetchWithRetry(url, { signal }, RETRY_STANDARD.retries, RETRY_STANDARD.backoff);
        if (response.ok) {
            const payload = await response.json() as TMDbSeriesDetails;
            return { ...payload, media_type: 'series' };
        }
        if (response.status < 500) throw new Error(`HTTP error! status: ${response.status}`);
    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') throw error;
        const status = extractStatusFromError(error);
        if (status && status < 500) throw new Error(`HTTP error! status: ${status}`);

        // Fallback de robustez: em erro transitório no payload agregado, tenta o detalhe base e
        // busca vídeos/external_ids separadamente para não bloquear a vista.
        const baseUrl = `${API_BASE_TMDB}/tv/${seriesId}?language=pt-PT`;
        const baseResponse = await fetchWithRetry(baseUrl, { signal }, RETRY_STANDARD.retries, RETRY_STANDARD.backoff);
        if (!baseResponse.ok) {
            throw new Error(`HTTP error! status: ${baseResponse.status}`);
        }

        const basePayload = await baseResponse.json() as TMDbSeriesDetails;
        const baseData: TMDbSeriesDetails = { ...basePayload, media_type: 'series' };
        const [videosResult, externalIdsResult] = await Promise.allSettled([
            fetchWithRetry(`${API_BASE_TMDB}/tv/${seriesId}/videos?language=pt-PT`, { signal }, RETRY_STANDARD.retries, RETRY_STANDARD.backoff),
            fetchWithRetry(`${API_BASE_TMDB}/tv/${seriesId}/external_ids`, { signal }, RETRY_STANDARD.retries, RETRY_STANDARD.backoff),
        ]);

        if (videosResult.status === 'fulfilled' && videosResult.value.ok) {
            baseData.videos = await videosResult.value.json();
        } else if (!baseData.videos) {
            baseData.videos = { results: [] };
        }

        if (externalIdsResult.status === 'fulfilled' && externalIdsResult.value.ok) {
            baseData.external_ids = await externalIdsResult.value.json();
        }

        return baseData;
    }
    throw new Error('Falha ao carregar detalhes da série.');
}

/**
 * Busca os créditos (elenco) de uma série na API.
 * @param {string} seriesId - O ID da série.
 * @param {AbortSignal} signal - O sinal para abortar o pedido.
 */
export async function fetchSeriesCredits(seriesId: number, signal: AbortSignal | null): Promise<TMDbCredits> {
    const url = `${API_BASE_TMDB}/tv/${seriesId}/aggregate_credits?language=pt-PT`;
    try {
        const response = await fetchWithRetry(url, { signal }, RETRY_STANDARD.retries, RETRY_STANDARD.backoff);
        if (response.ok) return await response.json();
    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') throw error;
        console.warn(`[api] aggregate_credits falhou para série ${seriesId}. A tentar fallback /credits.`, error);
    }

    // Alguns títulos falham em aggregate_credits (503). Fallback para /credits.
    const fallbackUrl = `${API_BASE_TMDB}/tv/${seriesId}/credits?language=pt-PT`;
    const fallbackResponse = await fetchWithRetry(fallbackUrl, { signal }, RETRY_STANDARD.retries, RETRY_STANDARD.backoff);
    if (!fallbackResponse.ok) {
        throw new Error(`HTTP error! status: ${fallbackResponse.status}`);
    }

    const fallbackPayload = await fallbackResponse.json() as {
        cast?: Array<{ id: number; name: string; profile_path: string | null; character?: string | null }>;
    };

    return {
        cast: (fallbackPayload.cast || []).map((person) => ({
            id: person.id,
            name: person.name,
            profile_path: person.profile_path,
            roles: [{ character: person.character || '' }],
        })),
    };
}

export async function fetchMovieCredits(movieId: number | string, signal: AbortSignal | null): Promise<TMDbCredits> {
    const resolvedId = Math.trunc(Number(movieId));
    if (!Number.isFinite(resolvedId) || resolvedId <= 0) {
        return { cast: [], crew: [] };
    }

    const url = `${API_BASE_TMDB}/movie/${resolvedId}/credits?language=pt-PT`;
    const response = await fetchWithRetry(url, { signal }, RETRY_STANDARD.retries, RETRY_STANDARD.backoff);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    const payload = await response.json() as {
        cast?: Array<{ id: number; name: string; profile_path: string | null; character?: string | null }>;
        crew?: Array<{ id: number; name: string; profile_path: string | null; job?: string | null }>;
    };

    const prioritizedJobs = new Set([
        'Director',
        'Writer',
        'Screenplay',
        'Story',
        'Novel',
        'Characters',
        'Creator',
        'Producer',
        'Executive Producer',
    ]);

    const crewById = new Map<number, { id: number; name: string; profile_path: string | null; jobs: string[] }>();
    (payload.crew || []).forEach((person) => {
        if (!person?.id || !person?.name) return;
        const rawJob = String(person.job || '').trim();
        if (!rawJob || !prioritizedJobs.has(rawJob)) return;
        const current = crewById.get(person.id);
        if (current) {
            if (!current.jobs.includes(rawJob)) current.jobs.push(rawJob);
            return;
        }
        crewById.set(person.id, {
            id: person.id,
            name: person.name,
            profile_path: person.profile_path,
            jobs: [rawJob],
        });
    });

    return {
        cast: (payload.cast || []).map((person) => ({
            id: person.id,
            name: person.name,
            profile_path: person.profile_path,
            roles: [{ character: person.character || '' }],
        })),
        crew: Array.from(crewById.values()),
    };
}

/**
 * Busca os vídeos de uma série no TMDb (trailers/teasers).
 * @param seriesId - O ID da série.
 * @param signal - O sinal para abortar o pedido.
 * @param language - Idioma preferencial dos vídeos (ex.: en-US).
 */
export async function fetchSeriesVideos(
    seriesId: number,
    signal: AbortSignal | null,
    language: string = 'en-US'
): Promise<TMDbSeriesDetails['videos']> {
    const query = language ? `?language=${encodeURIComponent(language)}` : '';
    const url = `${API_BASE_TMDB}/tv/${seriesId}/videos${query}`;
    const response = await fetchWithRetry(url, { signal }, RETRY_STANDARD.retries, RETRY_STANDARD.backoff);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    return await response.json();
}

const TRAKT_NAME_YEAR_MIN_SCORE = 0.95;

function normalizeMatchText(value: string | null | undefined): string {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
}

function scoreTraktNameYearCandidate(
    item: any,
    query: string,
    expectedYear: number | undefined,
    expectedTmdbId: number,
    expectedImdbId: string | null | undefined
): number {
    const show = item?.show;
    if (!show) return -1;

    const ids = show?.ids || {};
    const normalizedQuery = normalizeMatchText(query);
    const normalizedTitle = normalizeMatchText(show?.title || show?.name);
    const showYear = typeof show?.year === 'number' ? show.year : undefined;

    let score = Math.max(0, Math.min(1, Number(item?.score || 0)));

    if (ids?.tmdb && Number(ids.tmdb) === expectedTmdbId) {
        score += 0.95;
    } else if (ids?.tmdb && Number(ids.tmdb) !== expectedTmdbId) {
        score -= 0.4;
    }

    const normalizedExpectedImdb = normalizeMatchText(expectedImdbId || '');
    const normalizedShowImdb = normalizeMatchText(ids?.imdb || '');
    if (normalizedExpectedImdb && normalizedShowImdb) {
        if (normalizedShowImdb === normalizedExpectedImdb) score += 1.2;
        else score -= 0.6;
    }

    if (normalizedQuery && normalizedTitle === normalizedQuery) score += 0.75;
    else if (normalizedQuery && normalizedTitle.startsWith(normalizedQuery)) score += 0.45;
    else if (normalizedQuery && normalizedTitle.includes(normalizedQuery)) score += 0.3;
    else score -= 0.25;

    if (typeof expectedYear === 'number') {
        if (typeof showYear === 'number') {
            const diff = Math.abs(showYear - expectedYear);
            if (diff === 0) score += 0.45;
            else if (diff === 1) score += 0.2;
            else if (diff === 2) score += 0.05;
            else score -= 0.45;
        } else {
            score -= 0.05;
        }
    }

    if (!ids?.trakt) score -= 0.2;

    return Number(score.toFixed(3));
}

/**
 * Fetches rich data (ratings, trailer) for a show from Trakt.tv using its TMDb ID.
 * @param {string} tmdbId - The TMDb ID of the series.
 * @param {AbortSignal} signal - O sinal para abortar o pedido.
 * @param fallbackTitle - Título da série para fallback de pesquisa textual.
 * @param fallbackYear - Ano da série para melhorar o match no fallback.
 * @returns {Promise<object|null>} A promise that resolves to an object with ratings and trailerKey, or null.
 */
export async function fetchTraktData(
    tmdbId: number,
    signal: AbortSignal | null,
    fallbackTitle?: string,
    fallbackYear?: number,
    fallbackOriginalTitle?: string,
    fallbackImdbId?: string | null
): Promise<TraktData | null> {
    const parseYouTubeKey = (trailerUrl: string | null | undefined): string | null => {
        if (!trailerUrl) return null;
        if (!trailerUrl.includes('youtube.com') && !trailerUrl.includes('youtu.be')) return null;
        try {
            const url = new URL(trailerUrl);
            if (url.hostname.includes('youtu.be')) {
                return url.pathname.replace('/', '').trim() || null;
            }
            const fromQuery = url.searchParams.get('v');
            if (fromQuery) return fromQuery;
            if (url.pathname.includes('/shorts/')) {
                return url.pathname.split('/shorts/')[1]?.split('/')[0] || null;
            }
            return null;
        } catch (e) {
            console.warn('Could not parse Trakt trailer URL:', trailerUrl);
            return null;
        }
    };

    try {
        let selectedShow: any = null;
        let selectedMethod: 'imdb' | 'tmdb' | 'name-year' | null = null;
        let selectedScore = 0;
        let selectedQuery: string | null = null;

        if (fallbackImdbId) {
            try {
                const imdbSearchUrl = `${API_BASE_TRAKT}/search/imdb/${encodeURIComponent(fallbackImdbId)}?type=show&extended=full`;
                const imdbResponse = await fetch(imdbSearchUrl, { signal });
                if (imdbResponse.ok) {
                    const imdbResults = await imdbResponse.json() as any[];
                    if (imdbResults[0]?.show) {
                        selectedShow = imdbResults[0].show;
                        selectedMethod = 'imdb';
                        selectedScore = 2;
                    }
                } else if (imdbResponse.status !== 404) {
                    console.warn(`[match][trakt] IMDb lookup returned status ${imdbResponse.status}`, { tmdbId, fallbackImdbId });
                }
            } catch (error) {
                console.warn('[match][trakt] Fallback por IMDb falhou.', { tmdbId, fallbackImdbId, error });
            }
        }

        if (!selectedShow) {
            try {
                const tmdbSearchUrl = `${API_BASE_TRAKT}/search/tmdb/${tmdbId}?type=show&extended=full`;
                const tmdbResponse = await fetch(tmdbSearchUrl, { signal });
                if (tmdbResponse.ok) {
                    const tmdbResults = await tmdbResponse.json() as any[];
                    const matchByTmdb = tmdbResults.find((item) => Number(item?.show?.ids?.tmdb) === tmdbId);
                    const selectedResult = matchByTmdb || tmdbResults[0];
                    if (selectedResult?.show) {
                        selectedShow = selectedResult.show;
                        selectedMethod = 'tmdb';
                        selectedScore = matchByTmdb ? 1.8 : 1.1;
                    }
                } else if (tmdbResponse.status !== 404) {
                    console.warn(`[match][trakt] TMDb lookup returned status ${tmdbResponse.status}`, { tmdbId });
                }
            } catch (error) {
                console.warn('[match][trakt] Lookup por TMDb falhou.', { tmdbId, error });
            }
        }

        if (!selectedShow && (fallbackOriginalTitle || fallbackTitle)) {
            const candidateQueries = Array.from(new Set([fallbackOriginalTitle, fallbackTitle].filter(Boolean))) as string[];
            let bestCandidate: { show: any; score: number; query: string } | null = null;

            for (const query of candidateQueries) {
                try {
                    const queryUrl = `${API_BASE_TRAKT}/search/show?query=${encodeURIComponent(query)}&extended=full`;
                    const queryResponse = await fetch(queryUrl, { signal });
                    if (!queryResponse.ok) continue;
                    const queryResults = await queryResponse.json() as any[];
                    if (!Array.isArray(queryResults) || queryResults.length === 0) continue;

                    const ranked = queryResults
                        .map((item) => ({
                            show: item?.show,
                            score: scoreTraktNameYearCandidate(item, query, fallbackYear, tmdbId, fallbackImdbId),
                            query,
                        }))
                        .filter((entry) => entry.show && entry.score >= 0)
                        .sort((a, b) => b.score - a.score);

                    if (!ranked[0]) continue;
                    if (!bestCandidate || ranked[0].score > bestCandidate.score) {
                        bestCandidate = ranked[0];
                    }
                } catch (error) {
                    console.warn('[match][trakt] Fallback por nome/ano falhou.', { tmdbId, query, error });
                }
            }

            if (bestCandidate) {
                if (bestCandidate.score >= TRAKT_NAME_YEAR_MIN_SCORE) {
                    selectedShow = bestCandidate.show;
                    selectedMethod = 'name-year';
                    selectedScore = bestCandidate.score;
                    selectedQuery = bestCandidate.query;
                } else {
                    console.warn('[match][trakt] Match por nome/ano descartado por score fraco.', {
                        tmdbId,
                        threshold: TRAKT_NAME_YEAR_MIN_SCORE,
                        bestScore: bestCandidate.score,
                        query: bestCandidate.query,
                        fallbackYear: fallbackYear ?? null,
                    });
                    return null;
                }
            }
        }

        if (!selectedShow) {
            console.warn('[match][trakt] Sem match confiável após fallbacks.', {
                tmdbId,
                fallbackImdbId: fallbackImdbId || null,
                fallbackYear: fallbackYear ?? null,
            });
            return null;
        }

        let traktId = selectedShow?.ids?.trakt as number | undefined;
        if (!traktId) {
            console.warn('[match][trakt] Match descartado por falta de traktId.', {
                tmdbId,
                method: selectedMethod,
                score: selectedScore,
                query: selectedQuery,
            });
            return null;
        }

        console.info('[match][trakt] Match selecionado.', {
            tmdbId,
            traktId,
            method: selectedMethod,
            score: Number(selectedScore.toFixed(3)),
            query: selectedQuery,
        });

        let fullShowData = selectedShow;
        if (traktId) {
            const showDetailsUrl = `${API_BASE_TRAKT}/shows/${traktId}?extended=full`;
            const showDetailsResponse = await fetch(showDetailsUrl, { signal });
            if (showDetailsResponse.ok) {
                fullShowData = await showDetailsResponse.json();
            } else {
                console.warn(`Trakt show details returned status ${showDetailsResponse.status}. Using fallback show data.`, {
                    tmdbId,
                    traktId,
                    method: selectedMethod,
                });
            }
        }
        
        const sourceData = fullShowData || selectedShow;
        const traktOverview = sourceData?.overview || null;
        const trailerKey = parseYouTubeKey(sourceData?.trailer);

        let ratings = null;
        if (traktId) {
            try {
                const ratingsUrl = `${API_BASE_TRAKT}/shows/${traktId}/ratings`;
                const ratingsResponse = await fetch(ratingsUrl, { signal });
                ratings = ratingsResponse.ok ? await ratingsResponse.json() : null;
            } catch (e) {
                console.warn('Could not fetch Trakt ratings endpoint, using show details fallback if available.');
            }
        }
        if (!ratings && typeof sourceData?.rating === 'number') {
            ratings = {
                rating: sourceData.rating,
                votes: typeof sourceData.votes === 'number' ? sourceData.votes : 0,
            };
        }

        return { ratings, trailerKey, traktId, overview: traktOverview, certification: sourceData?.certification };
    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            throw error;
        }
        console.error('Error fetching Trakt data:', error);
        return null;
    }
}

/**
 * Resolve dados de uma série no TVMaze com lookup por IMDb e fallback por nome/ano.
 * @param signal - O sinal para abortar o pedido.
 * @param fallbackTitle - Título da série para fallback de pesquisa textual.
 * @param fallbackYear - Ano da série para melhorar o match no fallback.
 * @param fallbackImdbId - IMDb ID, quando disponível.
 * @returns Dados normalizados da TVMaze ou null quando não houver match.
 */
export async function fetchTVMazeResolvedShow(
    signal: AbortSignal | null,
    fallbackTitle?: string,
    fallbackYear?: number,
    fallbackImdbId?: string | null
): Promise<TVMazeResolveData | null> {
    const params = new URLSearchParams();
    if (fallbackImdbId) params.set('imdb', fallbackImdbId);
    if (fallbackTitle) params.set('query', fallbackTitle);
    if (typeof fallbackYear === 'number' && Number.isFinite(fallbackYear)) params.set('year', String(fallbackYear));

    if (!params.has('imdb') && !params.has('query')) return null;

    const url = `${API_BASE_TVMAZE}/resolve/show?${params.toString()}`;
    const response = await fetchWithRetry(url, { signal }, RETRY_STANDARD.retries, RETRY_STANDARD.backoff);

    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    return response.json();
}

const PLACEHOLDER_OVERVIEWS = new Set([
    '',
    'sinopse não disponível.',
    'sinopse nao disponivel.',
    'overview not available.',
    'no overview available.',
    'n/a',
]);

function normalizeLanguageTag(language: string | null | undefined): string {
    const raw = String(language || '').trim().toLowerCase().replace('_', '-');
    if (!raw) return 'und';
    if (raw === 'portuguese') return 'pt';
    if (raw === 'english') return 'en';
    if (raw.startsWith('pt-pt')) return 'pt-PT';
    if (raw.startsWith('pt')) return 'pt';
    if (raw.startsWith('en')) return 'en';
    return raw;
}

function sanitizeOverview(value: unknown): string {
    const raw = String(value || '');
    if (!raw) return '';
    const withoutTags = raw
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<\/p>/gi, ' ')
        .replace(/<[^>]*>/g, ' ');
    const decoded = withoutTags.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entityRaw) => {
        const entity = String(entityRaw || '').toLowerCase();
        if (!entity) return match;
        if (entity.startsWith('#x')) {
            const code = Number.parseInt(entity.slice(2), 16);
            return Number.isFinite(code) ? String.fromCodePoint(code) : match;
        }
        if (entity.startsWith('#')) {
            const code = Number.parseInt(entity.slice(1), 10);
            return Number.isFinite(code) ? String.fromCodePoint(code) : match;
        }
        const map: Record<string, string> = {
            amp: '&',
            lt: '<',
            gt: '>',
            quot: '"',
            apos: "'",
            nbsp: ' ',
        };
        return map[entity] ?? match;
    });
    return decoded.replace(/\s+/g, ' ').trim();
}

function isMeaningfulOverview(value: unknown): boolean {
    const text = sanitizeOverview(value);
    if (!text) return false;
    return !PLACEHOLDER_OVERVIEWS.has(text.toLowerCase());
}

function scoreOverviewCompleteness(value: string): number {
    const text = sanitizeOverview(value);
    if (!text) return 0;
    const sentenceCount = text.split(/[.!?]+/).map((segment) => segment.trim()).filter(Boolean).length;
    return text.length + Math.min(sentenceCount, 8) * 20;
}

function languagePriority(language: string): number {
    const normalized = normalizeLanguageTag(language);
    if (normalized === 'pt-PT') return 0;
    if (normalized === 'pt') return 1;
    if (normalized === 'en') return 2;
    return 3;
}

function createOverviewCandidate(source: ProviderSource, language: string, text: string): AggregatedOverviewCandidate {
    const normalizedText = sanitizeOverview(text);
    return {
        source,
        language,
        text: normalizedText,
        score: scoreOverviewCompleteness(normalizedText),
    };
}

function pickBestOverviewCandidate(candidates: AggregatedOverviewCandidate[]): AggregatedOverviewCandidate | null {
    if (candidates.length === 0) return null;
    const sorted = [...candidates].sort((a, b) => {
        const priorityDiff = languagePriority(a.language) - languagePriority(b.language);
        if (priorityDiff !== 0) return priorityDiff;
        if (b.score !== a.score) return b.score - a.score;
        return b.text.length - a.text.length;
    });
    return sorted[0] || null;
}

async function fetchTMDbOverviewByLanguage(
    seriesId: number,
    language: string,
    signal: AbortSignal | null
): Promise<string | null> {
    const url = `${API_BASE_TMDB}/tv/${seriesId}?language=${encodeURIComponent(language)}`;
    const response = await fetchWithRetry(url, { signal }, RETRY_STANDARD.retries, RETRY_STANDARD.backoff);
    if (!response.ok) return null;
    const data = await response.json() as { overview?: string | null };
    return isMeaningfulOverview(data?.overview) ? sanitizeOverview(data?.overview) : null;
}

async function fetchTraktTranslationOverview(
    traktId: number,
    language: 'pt' | 'en',
    signal: AbortSignal | null
): Promise<string | null> {
    const url = `${API_BASE_TRAKT}/shows/${traktId}/translations/${language}`;
    const response = await fetchWithRetry(url, { signal }, RETRY_STANDARD.retries, RETRY_STANDARD.backoff);
    if (!response.ok) return null;
    const payload = await response.json() as Array<{ overview?: string | null }> | { overview?: string | null };
    if (Array.isArray(payload)) {
        const entryWithOverview = payload.find((item) => isMeaningfulOverview(item?.overview));
        return entryWithOverview?.overview ? sanitizeOverview(entryWithOverview.overview) : null;
    }
    return isMeaningfulOverview(payload?.overview) ? sanitizeOverview(payload.overview) : null;
}

async function safeOptionalRequest<T>(label: string, request: () => Promise<T>): Promise<T | null> {
    try {
        return await request();
    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') throw error;
        console.warn(`[aggregation] ${label} falhou. A continuar com fontes disponíveis.`, error);
        return null;
    }
}

/**
 * Agrega metadados de série entre TMDb/Trakt/TVMaze com prioridade de idioma:
 * pt-PT -> pt -> en (escolhendo o texto EN mais completo quando PT faltar).
 */
export async function fetchAggregatedSeriesMetadata({
    seriesId,
    signal,
    tmdbOverviewPt,
    traktData,
    fallbackTitle,
    fallbackYear,
    fallbackImdbId,
}: {
    seriesId: number;
    signal: AbortSignal | null;
    tmdbOverviewPt?: string | null;
    traktData?: TraktData | null;
    fallbackTitle?: string;
    fallbackYear?: number;
    fallbackImdbId?: string | null;
}): Promise<AggregatedSeriesMetadata> {
    const overviewCandidates: AggregatedOverviewCandidate[] = [];

    if (isMeaningfulOverview(tmdbOverviewPt)) {
        overviewCandidates.push(createOverviewCandidate('tmdb', 'pt-PT', tmdbOverviewPt as string));
    }

    const traktId = traktData?.traktId;
    const [
        tmdbOverviewEn,
        traktOverviewPt,
        traktOverviewEn,
        tvmazeData,
    ] = await Promise.all([
        safeOptionalRequest('TMDb EN overview', () => fetchTMDbOverviewByLanguage(seriesId, 'en-US', signal)),
        traktId
            ? safeOptionalRequest('Trakt PT translation', () => fetchTraktTranslationOverview(traktId, 'pt', signal))
            : Promise.resolve(null),
        traktId
            ? safeOptionalRequest('Trakt EN translation', () => fetchTraktTranslationOverview(traktId, 'en', signal))
            : Promise.resolve(null),
        safeOptionalRequest('TVMaze resolve show', () => fetchTVMazeResolvedShow(signal, fallbackTitle, fallbackYear, fallbackImdbId)),
    ]);

    if (isMeaningfulOverview(tmdbOverviewEn)) {
        overviewCandidates.push(createOverviewCandidate('tmdb', 'en', tmdbOverviewEn as string));
    }

    if (isMeaningfulOverview(traktOverviewPt)) {
        overviewCandidates.push(createOverviewCandidate('trakt', 'pt', traktOverviewPt as string));
    }

    if (isMeaningfulOverview(traktOverviewEn)) {
        overviewCandidates.push(createOverviewCandidate('trakt', 'en', traktOverviewEn as string));
    } else if (isMeaningfulOverview(traktData?.overview)) {
        overviewCandidates.push(createOverviewCandidate('trakt', 'en', traktData?.overview as string));
    }

    const tvmazeOverview = tvmazeData?.show?.summaryText || tvmazeData?.show?.summaryHtml || '';
    if (isMeaningfulOverview(tvmazeOverview)) {
        overviewCandidates.push(
            createOverviewCandidate('tvmaze', normalizeLanguageTag(tvmazeData?.show?.language), tvmazeOverview)
        );
    }

    const selectedOverview = pickBestOverviewCandidate(overviewCandidates);
    const certification = typeof traktData?.certification === 'string' && traktData.certification.trim()
        ? traktData.certification.trim()
        : null;

    return {
        overview: selectedOverview?.text || null,
        overviewSource: selectedOverview?.source || null,
        overviewLanguage: selectedOverview?.language || null,
        certification,
        certificationSource: certification ? 'trakt' : null,
        overviewCandidates,
        tvmazeData: tvmazeData || null,
    };
}

/**
 * Fetches season data (with images) from Trakt.
 * @param {number|string} traktId The Trakt ID of the series.
 * @param {AbortSignal} signal - O sinal para abortar o pedido.
 * @returns {Promise<Array|null>} A promise that resolves to an array of season objects or null.
 */
export async function fetchTraktSeasonsData(traktId: number | undefined, signal: AbortSignal | null): Promise<TraktSeason[] | null> {
    if (!traktId) return null;
    try { 
        const url = `${API_BASE_TRAKT}/shows/${traktId}/seasons?extended=full,episodes,images`;
        const response = await fetchWithRetry(url, { signal }, RETRY_STANDARD.retries, RETRY_STANDARD.backoff);
        if (!response.ok) return null;
        return await response.json();
    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            throw error;
        }
        console.error('Error fetching Trakt seasons data:', error);
        return null;
    }
}

/**
 * Gets season details, using a cache to avoid redundant API calls.
 * @param {number} seriesId 
 * @param {number} seasonNumber 
 * @param {AbortSignal} signal 
 * @returns {Promise<object>}
 */
export async function getSeasonDetailsWithCache(seriesId: number, seasonNumber: number, signal: AbortSignal | null): Promise<TMDbSeason> {
    const cacheKey = [seriesId, seasonNumber];
    const cachedSeason = await db.seasonCache.get(cacheKey);

    if (cachedSeason && (Date.now() - cachedSeason.cachedAt < SEASON_CACHE_DURATION)) {
        return cachedSeason.data;
    }

    const url = `${API_BASE_TMDB}/tv/${seriesId}/season/${seasonNumber}`;
    const seasonResponse = await fetchWithRetry(url, { signal }, RETRY_STANDARD.retries, RETRY_STANDARD.backoff);
    if (!seasonResponse.ok) {
        throw new Error(`HTTP error! status: ${seasonResponse.status}`);
    }
    const seasonData = await seasonResponse.json() as TMDbSeason;
    
    await db.seasonCache.put({
        seriesId: seriesId,
        seasonNumber: seasonNumber,
        data: seasonData,
        cachedAt: Date.now()
    });

    return seasonData;
}

/**
 * Busca as séries mais bem avaliadas (top rated) do TMDb.
 * @param page - O número da página a ser buscada.
 * @returns Uma promessa que resolve com os dados das séries top rated.
 */
export async function fetchPopularSeries(
    page: number,
    mediaType: 'series' | 'movie' = 'series'
): Promise<{ results: Series[], page: number, total_pages: number }> {
    const tmdbMediaType = mediaType === 'movie' ? 'movie' : 'tv';
    const url = `${API_BASE_TMDB}/${tmdbMediaType}/top_rated?language=pt-PT&page=${page}`;
    const response = await fetchWithRetry(url, {}, RETRY_FAST.retries, RETRY_FAST.backoff);
    if (!response.ok) {
        throw new Error(mediaType === 'movie'
            ? 'Não foi possível buscar os filmes top rated.'
            : 'Não foi possível buscar as séries top rated.');
    }
    const payload = await response.json() as { results: unknown; page: number; total_pages: number };
    const normalized = normalizeSeriesCollection(payload.results);
    return {
        results: mediaType === 'movie' ? normalized.map((item) => mapMovieSearchResult(item)) : normalized,
        page: payload.page,
        total_pages: payload.total_pages,
    };
}

/**
 * Busca as séries que estrearam recentemente no TMDb.
 * @param page - O número da página a ser buscada.
 * @returns Uma promessa que resolve com os dados das séries em exibição.
 */
export async function fetchNewPremieres(
    page: number,
    signal: AbortSignal | null = null,
    mediaType: 'series' | 'movie' = 'series',
    options: DiscoverPremieresOptions = {}
): Promise<{ results: Series[], page: number, total_pages: number }> {
    const today = new Date();
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(today.getMonth() - 1);
    const gteDate = options.fromDate || oneMonthAgo.toISOString().split('T')[0]; // Formato YYYY-MM-DD

    const tmdbMediaType = mediaType === 'movie' ? 'movie' : 'tv';
    const dateKey = mediaType === 'movie' ? 'primary_release_date.gte' : 'first_air_date.gte';
    const params = new URLSearchParams({
        language: 'pt-PT',
        page: String(page),
        sort_by: options.sortBy || 'popularity.desc',
    });
    params.set(dateKey, gteDate);
    if (Array.isArray(options.genreIds) && options.genreIds.length > 0) {
        params.set('with_genres', options.genreIds.join(','));
    }
    if (options.withOriginalLanguage !== false) {
        params.set('with_original_language', 'en');
    }
    const url = `${API_BASE_TMDB}/discover/${tmdbMediaType}?${params.toString()}`;
    const response = await fetchWithRetry(url, { signal }, RETRY_FAST.retries, RETRY_FAST.backoff);
    if (!response.ok) {
        throw new Error(mediaType === 'movie'
            ? 'Não foi possível buscar os filmes em estreia.'
            : 'Não foi possível buscar as séries em exibição.');
    }
    const payload = await response.json() as { results: unknown; page: number; total_pages: number };
    const normalized = normalizeSeriesCollection(payload.results);
    return {
        results: mediaType === 'movie' ? normalized.map((item) => mapMovieSearchResult(item)) : normalized,
        page: payload.page,
        total_pages: payload.total_pages,
    };
}
