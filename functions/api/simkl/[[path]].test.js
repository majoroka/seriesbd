import { beforeEach, describe, expect, it, vi } from 'vitest';
import { onRequest } from './[[path]].js';
import { resetRateLimitStore } from '../_shared/security.js';

describe('simkl proxy', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetRateLimitStore();
  });

  it('adds Simkl application parameters server-side for allowed catalog lookups', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } })
    );

    const response = await onRequest({
      request: new Request('https://mediadex.app/api/simkl/search/id?imdb=tt123', {
        headers: { 'cf-connecting-ip': '10.0.0.1' },
      }),
      env: { SIMKL_CLIENT_ID: 'client-id' },
    });

    const upstreamUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(response.status).toBe(200);
    expect(upstreamUrl.origin).toBe('https://api.simkl.com');
    expect(upstreamUrl.pathname).toBe('/search/id');
    expect(upstreamUrl.searchParams.get('imdb')).toBe('tt123');
    expect(upstreamUrl.searchParams.get('client_id')).toBe('client-id');
    expect(upstreamUrl.searchParams.get('app-name')).toBe('mediadex');
    expect(upstreamUrl.searchParams.get('app-version')).toBe('1.0.0');
    expect(fetchMock.mock.calls[0][1].headers['User-Agent']).toContain('MediaDex/');
  });

  it('rejects sync endpoints before contacting Simkl', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const response = await onRequest({
      request: new Request('https://mediadex.app/api/simkl/sync/all-items', {
        headers: { 'cf-connecting-ip': '10.0.0.2' },
      }),
      env: { SIMKL_CLIENT_ID: 'client-id' },
    });

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns a safe upstream error without copying Simkl response content', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('secret upstream body', { status: 429 }));
    const response = await onRequest({
      request: new Request('https://mediadex.app/api/simkl/tv/10', {
        headers: { 'cf-connecting-ip': '10.0.0.3' },
      }),
      env: { SIMKL_CLIENT_ID: 'client-id' },
    });

    expect(response.status).toBe(429);
    expect(response.headers.get('x-upstream-status')).toBe('429');
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'Simkl upstream request failed' });
  });
});
