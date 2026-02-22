import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./db', () => ({
  db: {
    seasonCache: {
      get: vi.fn(),
      put: vi.fn(),
    },
  },
}));

import { fetchTraktData } from './api';

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
