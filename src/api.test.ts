import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./db', () => ({
  db: {
    seasonCache: {
      get: vi.fn(),
      put: vi.fn(),
    },
  },
}));

import { fetchAggregatedSeriesMetadata, fetchSeriesCredits, fetchSeriesDetails, fetchTraktData } from './api';

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('fetchTraktData', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('falls back from TMDb search to IMDb search and uses show rating fallback', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);

      if (url.includes('/api/trakt/search/tmdb/123')) {
        return jsonResponse([], 404);
      }

      if (url.includes('/api/trakt/search/imdb/tt123')) {
        return jsonResponse([
          {
            show: {
              ids: { trakt: 999 },
            },
          },
        ]);
      }

      if (url.includes('/api/trakt/shows/999?extended=full')) {
        return jsonResponse({
          rating: 8.7,
          votes: 1200,
          trailer: 'https://youtu.be/abc123',
          certification: 'PG-13',
          overview: 'Overview from Trakt',
        });
      }

      if (url.includes('/api/trakt/shows/999/ratings')) {
        return jsonResponse({ error: 'temporary' }, 502);
      }

      throw new Error(`Unexpected URL in test: ${url}`);
    });

    const data = await fetchTraktData(123, null, 'Show', 2020, 'Show', 'tt123');

    expect(data).not.toBeNull();
    expect(data?.traktId).toBe(999);
    expect(data?.trailerKey).toBe('abc123');
    expect(data?.ratings).toEqual({ rating: 8.7, votes: 1200 });
    expect(data?.certification).toBe('PG-13');
    expect(fetchMock).toHaveBeenCalled();
  });

  it('returns null when no trakt match is found in any fallback', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);

      if (url.includes('/api/trakt/search/tmdb/321')) {
        return jsonResponse([], 404);
      }

      if (url.includes('/api/trakt/search/imdb/tt321')) {
        return jsonResponse([], 200);
      }

      if (url.includes('/api/trakt/search/show?query=')) {
        return jsonResponse([], 200);
      }

      throw new Error(`Unexpected URL in test: ${url}`);
    });

    const data = await fetchTraktData(321, null, 'Unknown', 2021, 'Unknown', 'tt321');
    expect(data).toBeNull();
  });
});

describe('TMDb detail fallbacks', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('falls back to /credits when aggregate_credits fails with 503', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);

      if (url.includes('/api/tmdb/tv/1705/aggregate_credits')) {
        return jsonResponse({ status_message: 'temporarily unavailable' }, 503);
      }

      if (url.includes('/api/tmdb/tv/1705/credits')) {
        return jsonResponse({
          cast: [
            { id: 1, name: 'Actor One', profile_path: '/a.jpg', character: 'Character A' },
          ],
        });
      }

      throw new Error(`Unexpected URL in test: ${url}`);
    });

    const credits = await fetchSeriesCredits(1705, null);
    expect(credits.cast).toHaveLength(1);
    expect(credits.cast[0].name).toBe('Actor One');
    expect(credits.cast[0].roles[0].character).toBe('Character A');
  });

  it('falls back to base detail endpoints when append_to_response fails with 503', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);

      if (url.includes('/api/tmdb/tv/1705?append_to_response=videos,external_ids')) {
        return jsonResponse({ status_message: 'temporarily unavailable' }, 503);
      }

      if (url.includes('/api/tmdb/tv/1705?language=pt-PT')) {
        return jsonResponse({
          id: 1705,
          name: 'Fallback Show',
          overview: 'Overview PT',
          poster_path: null,
          backdrop_path: null,
          first_air_date: '2010-01-01',
          genres: [],
          created_by: [],
          next_episode_to_air: null,
          episode_run_time: [45],
          networks: [],
          production_companies: [],
          production_countries: [],
          seasons: [],
          spoken_languages: [],
          status: 'Ended',
          vote_average: 7.1,
        });
      }

      if (url.includes('/api/tmdb/tv/1705/videos?language=pt-PT')) {
        return jsonResponse({ results: [{ key: 'abc', site: 'YouTube', type: 'Trailer', official: true }] });
      }

      if (url.includes('/api/tmdb/tv/1705/external_ids')) {
        return jsonResponse({ imdb_id: 'tt1705' });
      }

      throw new Error(`Unexpected URL in test: ${url}`);
    });

    const details = await fetchSeriesDetails(1705, null);
    expect(details.id).toBe(1705);
    expect(details.name).toBe('Fallback Show');
    expect(details.videos.results).toHaveLength(1);
    expect(details.external_ids?.imdb_id).toBe('tt1705');
  });
});

describe('fetchAggregatedSeriesMetadata', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('prioritizes pt-PT overview over pt/en candidates', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);

      if (url.includes('/api/tmdb/tv/42?language=en-US')) {
        return jsonResponse({ overview: 'A long english overview from TMDb.' });
      }

      if (url.includes('/api/trakt/shows/10/translations/pt')) {
        return jsonResponse([{ overview: 'Resumo PT vindo da Trakt.' }]);
      }

      if (url.includes('/api/trakt/shows/10/translations/en')) {
        return jsonResponse([{ overview: 'A very complete english overview from Trakt with lots of context.' }]);
      }

      if (url.includes('/api/tvmaze/resolve/show?')) {
        return jsonResponse({
          source: 'tvmaze',
          match: { method: 'imdb', score: 1 },
          show: {
            id: 100,
            language: 'English',
            summaryText: 'TVMaze english summary',
            summaryHtml: null,
            rating: { average: 8.2 },
          },
        });
      }

      throw new Error(`Unexpected URL in test: ${url}`);
    });

    const aggregated = await fetchAggregatedSeriesMetadata({
      seriesId: 42,
      signal: null,
      tmdbOverviewPt: 'Sinopse em português do TMDb.',
      traktData: { traktId: 10, ratings: null, trailerKey: null, overview: null, certification: null },
      fallbackTitle: 'Show',
      fallbackYear: 2015,
      fallbackImdbId: 'tt123',
    });

    expect(aggregated.overview).toBe('Sinopse em português do TMDb.');
    expect(aggregated.overviewLanguage).toBe('pt-PT');
    expect(aggregated.overviewSource).toBe('tmdb');
    expect(aggregated.tvmazeData?.source).toBe('tvmaze');
  });

  it('uses the most complete english text when no portuguese text exists', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);

      if (url.includes('/api/tmdb/tv/77?language=en-US')) {
        return jsonResponse({ overview: 'Short english text.' });
      }

      if (url.includes('/api/trakt/shows/77/translations/pt')) {
        return jsonResponse([]);
      }

      if (url.includes('/api/trakt/shows/77/translations/en')) {
        return jsonResponse([{ overview: 'This english overview from Trakt is much more complete and descriptive than the others.' }]);
      }

      if (url.includes('/api/tvmaze/resolve/show?')) {
        return jsonResponse({
          source: 'tvmaze',
          match: { method: 'search', score: 0.8 },
          show: {
            id: 200,
            language: 'English',
            summaryText: 'Medium english summary from TVMaze.',
            summaryHtml: null,
            rating: { average: 7.9 },
          },
        });
      }

      throw new Error(`Unexpected URL in test: ${url}`);
    });

    const aggregated = await fetchAggregatedSeriesMetadata({
      seriesId: 77,
      signal: null,
      tmdbOverviewPt: '',
      traktData: { traktId: 77, ratings: null, trailerKey: null, overview: 'Tiny', certification: 'TV-MA' },
      fallbackTitle: 'Another Show',
      fallbackYear: 2011,
      fallbackImdbId: 'tt777',
    });

    expect(aggregated.overviewSource).toBe('trakt');
    expect(aggregated.overviewLanguage).toBe('en');
    expect(aggregated.overview).toContain('much more complete');
    expect(aggregated.certification).toBe('TV-MA');
    expect(aggregated.certificationSource).toBe('trakt');
  });

  it('keeps rendering metadata when optional providers fail', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('network down');
    });

    const aggregated = await fetchAggregatedSeriesMetadata({
      seriesId: 999,
      signal: null,
      tmdbOverviewPt: 'Sinopse local em PT.',
      traktData: null,
      fallbackTitle: 'Fallback',
      fallbackYear: 2020,
      fallbackImdbId: 'tt999',
    });

    expect(aggregated.overview).toBe('Sinopse local em PT.');
    expect(aggregated.overviewLanguage).toBe('pt-PT');
    expect(aggregated.overviewSource).toBe('tmdb');
  });
});
