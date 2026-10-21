import { beforeEach, describe, expect, it, vi } from 'vitest';
import { onRequest } from './[[path]].js';
import { resetRateLimitStore } from '../_shared/security.js';

describe('trakt proxy', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetRateLimitStore();
  });

  it('forwards the public movie catalogue endpoint with the Trakt key held server-side', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } })
    );

    const response = await onRequest({
      request: new Request('https://mediadex.app/api/trakt/search/tmdb/238?type=movie&extended=full', {
        headers: { 'cf-connecting-ip': '10.0.0.1' },
      }),
      env: { TRAKT_API_KEY: 'client-id' },
    });

    const upstreamUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(response.status).toBe(200);
    expect(upstreamUrl.origin).toBe('https://api.trakt.tv');
    expect(upstreamUrl.pathname).toBe('/search/tmdb/238');
    expect(upstreamUrl.searchParams.get('type')).toBe('movie');
    expect(fetchMock.mock.calls[0][1].headers['trakt-api-key']).toBe('client-id');
  });

  it('rejects unsupported Trakt endpoints before contacting the upstream API', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const response = await onRequest({
      request: new Request('https://mediadex.app/api/trakt/users/me', {
        headers: { 'cf-connecting-ip': '10.0.0.2' },
      }),
      env: { TRAKT_API_KEY: 'client-id' },
    });

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
