import { API_KEY, TRAKT_API_KEY, TRAKT_API_URL, SEASON_CACHE_DURATION } from './config.js';
import { fetchWithRetry } from './utils.js';
import { db } from './db.js';
import { Series, TMDbSeriesDetails, TMDbCredits, TraktData, TraktSeason, TMDbSeason } from './types.js';

/**
 * Pesquisa por séries no TMDb com base numa query.
 * @param {string} query - O termo de pesquisa.
 * @param {AbortSignal} signal - O sinal para abortar o pedido.
 */
export async function searchSeries(query: string, signal: AbortSignal): Promise<{ results: Series[] }> {
    const searchUrl = `https://api.themoviedb.org/3/search/tv?api_key=${API_KEY}&language=pt-PT&query=${encodeURIComponent(query)}`;
    const response = await fetchWithRetry(searchUrl, { signal });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    return await response.json();
}

/**
 * Busca os detalhes completos de uma série na API.
 * @param {string} seriesId - O ID da série.
 * @param {AbortSignal} signal - O sinal para abortar o pedido.
 */
export async function fetchSeriesDetails(seriesId: number, signal: AbortSignal | null): Promise<TMDbSeriesDetails> {
    const url = `https://api.themoviedb.org/3/tv/${seriesId}?api_key=${API_KEY}&language=pt-PT&append_to_response=videos`;
    const response = await fetchWithRetry(url, { signal });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    return await response.json();
}

/**
 * Busca os créditos (elenco) de uma série na API.
 * @param {string} seriesId - O ID da série.
 * @param {AbortSignal} signal - O sinal para abortar o pedido.
 */
export async function fetchSeriesCredits(seriesId: number, signal: AbortSignal | null): Promise<TMDbCredits> {
    const url = `https://api.themoviedb.org/3/tv/${seriesId}/aggregate_credits?api_key=${API_KEY}&language=pt-PT`;
    const response = await fetchWithRetry(url, { signal });
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
        const searchUrl = `${TRAKT_API_URL}/search/tmdb/${tmdbId}?type=show`;
        const searchResponse = await fetchWithRetry(searchUrl, {
            headers: {
                'Content-Type': 'application/json',
                'trakt-api-version': '2',
                'trakt-api-key': TRAKT_API_KEY,
                'Accept-Language': 'pt'
            },
            signal
        });
        if (!searchResponse.ok) {
            if (searchResponse.status === 404) return null;
            throw new Error(`Trakt search API error! status: ${searchResponse.status}`);
        }
        const searchResult = await searchResponse.json();
        const traktId = searchResult[0]?.show?.ids?.trakt;

        if (!traktId) return null;

        const showDetailsUrl = `${TRAKT_API_URL}/shows/${traktId}?extended=full`;
        const showDetailsResponse = await fetchWithRetry(showDetailsUrl, {
            headers: { 'Content-Type': 'application/json', 'trakt-api-version': '2', 'trakt-api-key': TRAKT_API_KEY, 'Accept-Language': 'pt' },
            signal
        });
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

        const ratingsUrl = `${TRAKT_API_URL}/shows/${traktId}/ratings`;
        const ratingsResponse = await fetchWithRetry(ratingsUrl, {
            headers: { 'Content-Type': 'application/json', 'trakt-api-version': '2', 'trakt-api-key': TRAKT_API_KEY, 'Accept-Language': 'pt' },
            signal
        });
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
        const url = `${TRAKT_API_URL}/shows/${traktId}/seasons?extended=full,episodes,images`;
        const response = await fetchWithRetry(url, {
            headers: { 'Content-Type': 'application/json', 'trakt-api-version': '2', 'trakt-api-key': TRAKT_API_KEY, 'Accept-Language': 'pt' },
            signal
        });
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

    const url = `https://api.themoviedb.org/3/tv/${seriesId}/season/${seasonNumber}?api_key=${API_KEY}&language=pt-PT`;
    const seasonData = await fetchWithRetry(url, { signal }).then(res => res.json());
    
    await db.seasonCache.put({
        seriesId: seriesId,
        seasonNumber: seasonNumber,
        data: seasonData,
        cachedAt: Date.now()
    });

    return seasonData;
}