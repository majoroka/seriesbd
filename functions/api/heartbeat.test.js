import { beforeEach, describe, expect, it, vi } from 'vitest';
import { onRequest } from './heartbeat.js';
import { resetRateLimitStore } from './_shared/security.js';

describe('heartbeat function', () => {
  beforeEach(() => {
    resetRateLimitStore();
    vi.restoreAllMocks();
  });

  it('returns superficial health on GET without persisting', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const response = await onRequest({
      request: new Request('https://example.com/api/heartbeat', { method: 'GET' }),
      env: {},
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      method: 'GET',
      persisted: false,
      health: 'ok',
      tokenConfigured: false,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fails closed for POST when token is missing', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const response = await onRequest({
      request: new Request('https://example.com/api/heartbeat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ trigger: 'manual' }),
      }),
      env: {},
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: 'Heartbeat token is not configured',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
