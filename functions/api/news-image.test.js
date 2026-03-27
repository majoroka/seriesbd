import { beforeEach, describe, expect, it, vi } from 'vitest';
import { onRequest } from './news-image.js';
import { resetRateLimitStore } from './_shared/security.js';

describe('news-image function', () => {
  beforeEach(() => {
    resetRateLimitStore();
    vi.restoreAllMocks();
  });

  it('blocks private IPv4 image targets before fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const response = await onRequest({
      request: new Request('https://example.com/api/news-image?url=http://10.0.0.5/poster.jpg', {
        method: 'GET',
        headers: { 'cf-connecting-ip': '1.1.1.1' },
      }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: 'Blocked image url',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('blocks loopback IPv6 image targets before fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const response = await onRequest({
      request: new Request('https://example.com/api/news-image?url=http://[::1]/poster.jpg', {
        method: 'GET',
        headers: { 'cf-connecting-ip': '1.1.1.2' },
      }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: 'Blocked image url',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('blocks redirects to private targets', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null, {
      status: 302,
      headers: { location: 'http://192.168.1.25/internal.jpg' },
    }));

    const response = await onRequest({
      request: new Request('https://example.com/api/news-image?url=https://cdn.example.com/poster.jpg', {
        method: 'GET',
        headers: { 'cf-connecting-ip': '1.1.1.3' },
      }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: 'Blocked image redirect',
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('follows safe redirects and returns the final image', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, {
        status: 302,
        headers: { location: 'https://images.examplecdn.com/poster-final.jpg' },
      }))
      .mockResolvedValueOnce(new Response('image-bytes', {
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
      }));

    const response = await onRequest({
      request: new Request('https://example.com/api/news-image?url=https://cdn.example.com/poster.jpg', {
        method: 'GET',
        headers: { 'cf-connecting-ip': '1.1.1.4' },
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(await response.text()).toBe('image-bytes');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
