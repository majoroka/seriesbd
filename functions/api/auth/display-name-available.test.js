import { beforeEach, describe, expect, it, vi } from 'vitest';
import { onRequest } from './display-name-available.js';
import { resetRateLimitStore } from '../_shared/security.js';

describe('display-name-available function', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetRateLimitStore();
  });

  it('returns availability when Supabase query succeeds', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response('[]', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const request = new Request('https://example.com/api/auth/display-name-available?name=Majoroka', {
      method: 'GET',
      headers: { 'cf-connecting-ip': '10.0.0.1' },
    });

    const response = await onRequest({
      request,
      env: {
        SUPABASE_URL: 'https://example.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'service-key',
      },
    });

    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.available).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const requestUrl = fetchSpy.mock.calls[0][0];
    expect(String(requestUrl)).toContain('display_name_normalized=eq.majoroka');
  });

  it('returns 429 when per-IP rate limit is exceeded', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response('[]', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const env = {
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-key',
    };

    let response = null;
    for (let i = 0; i < 21; i += 1) {
      response = await onRequest({
        request: new Request(`https://example.com/api/auth/display-name-available?name=User${i}`, {
          method: 'GET',
          headers: { 'cf-connecting-ip': '10.0.0.2' },
        }),
        env,
      });
    }

    expect(response.status).toBe(429);
    const body = await response.json();
    expect(body.error).toBe('Rate limit exceeded');
  });
});
