import { db } from "./db";
import { SEASON_CACHE_DURATION } from "./constants";
import { fetchWithRetry } from "./utils";
import {
    Series,
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

const API_BASE_TMDB = '/api/tmdb';
const API_BASE_TRAKT = '/api/trakt';
const API_BASE_TVMAZE = '/api/tvmaze';
const RETRY_FAST = { retries: 2, backoff: 250 };
const RETRY_STANDARD = { retries: 2, backoff: 500 };

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
    const searchUrl = `${API_BASE_TMDB}/search/tv?query=${encodeURIComponent(query)}&language=pt-PT`;
    const response = await fetchWithRetry(searchUrl, { signal }, RETRY_FAST.retries, RETRY_FAST.backoff);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    return await response.json();
}

/**
 * Busca as séries em tendência no TMDb.
 * @param {'day' | 'week'} timeWindow - O período de tempo.
 * @param {AbortSignal} signal - O sinal para abortar o pedido.
 */
export async function fetchTrending(timeWindow: 'day' | 'week', signal: AbortSignal): Promise<{ results: Series[] }> {
    const url = `${API_BASE_TMDB}/trending/tv/${timeWindow}?language=pt-PT`;
    const response = await fetchWithRetry(url, { signal }, RETRY_FAST.retries, RETRY_FAST.backoff);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    return await response.json();
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
        if (response.ok) return await response.json();
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

        const baseData = await baseResponse.json() as TMDbSeriesDetails;
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
        const searchUrl = `${API_BASE_TRAKT}/search/tmdb/${tmdbId}?type=show&extended=full`;
        const searchResponse = await fetch(searchUrl, { signal });
        let searchResult: any[] = [];
        if (searchResponse.ok) {
            searchResult = await searchResponse.json();
        } else if (searchResponse.status !== 404) {
            console.warn(`Trakt search by TMDb returned status ${searchResponse.status}. Trying fallback search.`);
        }

        let traktId = searchResult[0]?.show?.ids?.trakt as number | undefined;
        let fallbackShow: any = searchResult[0]?.show || null;

        if (!traktId && fallbackImdbId) {
            try {
                const imdbSearchUrl = `${API_BASE_TRAKT}/search/imdb/${encodeURIComponent(fallbackImdbId)}?type=show&extended=full`;
                const imdbResponse = await fetch(imdbSearchUrl, { signal });
                if (imdbResponse.ok) {
                    const imdbResults = await imdbResponse.json() as any[];
                    fallbackShow = imdbResults[0]?.show || null;
                    traktId = fallbackShow?.ids?.trakt as number | undefined;
                }
            } catch (error) {
                console.warn('Trakt fallback search by IMDb ID failed:', error);
            }
        }

        if (!traktId && (fallbackOriginalTitle || fallbackTitle)) {
            const candidateQueries = Array.from(new Set([fallbackOriginalTitle, fallbackTitle].filter(Boolean))) as string[];
            for (const query of candidateQueries) {
                if (traktId) break;
                try {
                    const queryUrl = `${API_BASE_TRAKT}/search/show?query=${encodeURIComponent(query)}&extended=full`;
                    const fallbackResponse = await fetch(queryUrl, { signal });
                    if (!fallbackResponse.ok) continue;
                    const fallbackResults = await fallbackResponse.json() as any[];
                    const matchByTmdb = fallbackResults.find(item => Number(item?.show?.ids?.tmdb) === tmdbId);
                    const matchByYear = typeof fallbackYear === 'number'
                        ? fallbackResults.find(item => item?.show?.year === fallbackYear)
                        : null;
                    fallbackShow = matchByTmdb?.show || matchByYear?.show || fallbackResults[0]?.show || null;
                    traktId = fallbackShow?.ids?.trakt as number | undefined;
                } catch (error) {
                    console.warn('Trakt fallback search by show name failed:', error);
                }
            }
        }

        if (!traktId && !fallbackShow) return null;

        let fullShowData = fallbackShow;
        if (traktId) {
            const showDetailsUrl = `${API_BASE_TRAKT}/shows/${traktId}?extended=full`;
            const showDetailsResponse = await fetch(showDetailsUrl, { signal });
            if (showDetailsResponse.ok) {
                fullShowData = await showDetailsResponse.json();
            } else {
                console.warn(`Trakt show details returned status ${showDetailsResponse.status}. Using fallback show data.`);
            }
        }
        
        const sourceData = fullShowData || fallbackShow;
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
    return String(value || '').replace(/\s+/g, ' ').trim();
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
export async function fetchPopularSeries(page: number): Promise<{ results: Series[], page: number, total_pages: number }> {
    const url = `${API_BASE_TMDB}/tv/top_rated?language=pt-PT&page=${page}`;
    const response = await fetchWithRetry(url, {}, RETRY_FAST.retries, RETRY_FAST.backoff);
    if (!response.ok) {
        throw new Error('Não foi possível buscar as séries top rated.');
    }
    return response.json();
}

/**
 * Busca as séries que estrearam recentemente no TMDb.
 * @param page - O número da página a ser buscada.
 * @returns Uma promessa que resolve com os dados das séries em exibição.
 */
export async function fetchNewPremieres(
    page: number,
    signal: AbortSignal | null = null
): Promise<{ results: Series[], page: number, total_pages: number }> {
    const today = new Date();
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(today.getMonth() - 1);
    const gteDate = oneMonthAgo.toISOString().split('T')[0]; // Formato YYYY-MM-DD

    const url = `${API_BASE_TMDB}/discover/tv?language=pt-PT&page=${page}&sort_by=popularity.desc&first_air_date.gte=${gteDate}&with_original_language=en`;
    const response = await fetchWithRetry(url, { signal }, RETRY_FAST.retries, RETRY_FAST.backoff);
    if (!response.ok) {
        throw new Error('Não foi possível buscar as séries em exibição.');
    }
    return response.json();
}
