import { db } from "./db";
import { Series, TMDbSeriesDetails, TMDbCredits, TraktData, TraktSeason, TMDbSeason } from "./types";

const API_BASE_TMDB = '/api/tmdb';
const API_BASE_TRAKT = '/api/trakt';

/**
 * Pesquisa por séries no TMDb com base numa query.
 * @param {string} query - O termo de pesquisa.
 * @param {AbortSignal} signal - O sinal para abortar o pedido.
 */
export async function searchSeries(query: string, signal: AbortSignal): Promise<{ results: Series[] }> {
    const searchUrl = `${API_BASE_TMDB}/search/tv?query=${encodeURIComponent(query)}&language=pt-PT`;
    const response = await fetch(searchUrl, { signal });
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
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    return await response.json();
}

/**
 * Busca os detalhes completos de uma série na API.
 * @param {string} seriesId - O ID da série.
 * @param {AbortSignal} signal - O sinal para abortar o pedido.
 */
export async function fetchSeriesDetails(seriesId: number, signal: AbortSignal | null): Promise<TMDbSeriesDetails> {
    const url = `${API_BASE_TMDB}/tv/${seriesId}?append_to_response=videos&language=pt-PT`;
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    return await response.json();
}

/**
 * Busca os créditos (elenco) de uma série na API.
 * @param {string} seriesId - O ID da série.
 * @param {AbortSignal} signal - O sinal para abortar o pedido.
 */
export async function fetchSeriesCredits(seriesId: number, signal: AbortSignal | null): Promise<TMDbCredits> {
    const url = `${API_BASE_TMDB}/tv/${seriesId}/aggregate_credits?language=pt-PT`;
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    return await response.json();
}

/**
 * Fetches rich data (ratings, trailer) for a show from Trakt.tv using its TMDb ID.
 * @param {string} tmdbId - The TMDb ID of the series.
 * @param {AbortSignal} signal - O sinal para abortar o pedido.
 * @returns {Promise<object|null>} A promise that resolves to an object with ratings and trailerKey, or null.
 */
export async function fetchTraktData(tmdbId: number, signal: AbortSignal | null): Promise<TraktData | null> {
    try {
        const searchUrl = `${API_BASE_TRAKT}/search/tmdb/${tmdbId}?type=show`;
        const searchResponse = await fetch(searchUrl, { signal });
        if (!searchResponse.ok) {
            if (searchResponse.status === 404) return null;
            throw new Error(`Trakt search API error! status: ${searchResponse.status}`);
        }
        const searchResult = await searchResponse.json();
        const traktId = searchResult[0]?.show?.ids?.trakt;

        if (!traktId) return null;

        const showDetailsUrl = `${API_BASE_TRAKT}/shows/${traktId}?extended=full`;
        const showDetailsResponse = await fetch(showDetailsUrl, { signal });
        const fullShowData = showDetailsResponse.ok ? await showDetailsResponse.json() : null;

        const traktOverview = fullShowData?.overview;
        let trailerKey = null;
        if (fullShowData?.trailer && fullShowData.trailer.includes('youtube.com')) {
            try {
                const url = new URL(fullShowData.trailer);
                trailerKey = url.searchParams.get('v');
            } catch (e) {
                console.warn('Could not parse Trakt trailer URL:', fullShowData.trailer);
            }
        }

        const ratingsUrl = `${API_BASE_TRAKT}/shows/${traktId}/ratings`;
        const ratingsResponse = await fetch(ratingsUrl, { signal });
        const ratings = ratingsResponse.ok ? await ratingsResponse.json() : null;

        return { ratings, trailerKey, traktId, overview: traktOverview, certification: fullShowData?.certification };

    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            throw error;
        }
        console.error('Error fetching Trakt data:', error);
        return null;
    }
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
        const response = await fetch(url, { signal });
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
    const SEASON_CACHE_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 dias
    const cachedSeason = await db.seasonCache.get(cacheKey);

    if (cachedSeason && (Date.now() - cachedSeason.cachedAt < SEASON_CACHE_DURATION)) {
        return cachedSeason.data;
    }

    const url = `${API_BASE_TMDB}/tv/${seriesId}/season/${seasonNumber}`;
    const seasonData = await fetch(url, { signal }).then(res => res.json());
    
    await db.seasonCache.put({
        seriesId: seriesId,
        seasonNumber: seasonNumber,
        data: seasonData,
        cachedAt: Date.now()
    });

    return seasonData as TMDbSeason;
}

/**
 * Busca as séries mais populares do TMDb.
 * @param page - O número da página a ser buscada.
 * @returns Uma promessa que resolve com os dados das séries populares.
 */
export async function fetchPopularSeries(page: number): Promise<{ results: Series[], page: number, total_pages: number }> {
    const url = `${API_BASE_TMDB}/tv/popular?language=pt-PT&page=${page}`;
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error('Não foi possível buscar as séries populares.');
    }
    return response.json();
}

/**
 * Busca as séries mais populares da Trakt.
 * @param page - O número da página a ser buscada.
 * @returns Uma promessa que resolve com os dados das séries populares da Trakt.
 */
export async function fetchTraktPopularSeries(page: number, limit: number = 50): Promise<any[]> {
    const url = `${API_BASE_TRAKT}/shows/popular?page=${page}&limit=${limit}&extended=full`;
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error('Não foi possível buscar as séries populares da Trakt.');
    }
    return response.json();
}

/**
 * Busca as séries que estrearam recentemente no TMDb.
 * @param page - O número da página a ser buscada.
 * @returns Uma promessa que resolve com os dados das séries em exibição.
 */
export async function fetchNewPremieres(page: number): Promise<{ results: Series[], page: number, total_pages: number }> {
    const today = new Date();
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(today.getMonth() - 1);
    const gteDate = oneMonthAgo.toISOString().split('T')[0]; // Formato YYYY-MM-DD

    const url = `${API_BASE_TMDB}/discover/tv?language=pt-PT&page=${page}&sort_by=popularity.desc&first_air_date.gte=${gteDate}&with_original_language=en`;
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error('Não foi possível buscar as séries em exibição.');
    }
    return response.json();
}