import { beforeEach, describe, expect, it, vi } from 'vitest';
import { onRequestGet } from './[[path]].js';

const APP_HTML = '<!doctype html><html><head><title>MediaDex</title></head><body><main>App</main></body></html>';

function createContext(path, env = {}) {
  return {
    request: new Request(`https://staging.seriesbd.pages.dev${path}`),
    env,
    next: vi.fn().mockResolvedValue(new Response(APP_HTML, {
      headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'self'" },
    })),
  };
}

describe('public share Open Graph function', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('injects escaped canonical metadata for a shared series', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      name: 'A Série <segura>',
      overview: 'Uma descrição pública.',
      poster_path: '/poster.jpg',
    }), { status: 200 }));
    const context = createContext('/partilhar/serie/1396?ignored=true', { TMDB_API_KEY: 'secret' });

    const response = await onRequestGet(context);
    const html = await response.text();
    const upstreamUrl = new URL(String(fetchMock.mock.calls[0][0]));

    expect(response.status).toBe(200);
    expect(upstreamUrl.pathname).toBe('/3/tv/1396');
    expect(upstreamUrl.searchParams.get('api_key')).toBe('secret');
    expect(html).toContain('<meta property="og:title" content="A Série &lt;segura&gt; | MediaDex">');
    expect(html).toContain('<meta property="og:url" content="https://staging.seriesbd.pages.dev/partilhar/serie/1396">');
    expect(html).toContain('https://image.tmdb.org/t/p/w780/poster.jpg');
    expect(html).not.toContain('<title>MediaDex</title>');
    expect(html).not.toContain('ignored=true');
    expect(response.headers.get('content-security-policy')).toBe("default-src 'self'");
  });

  it('generates public book metadata without reading user or library data', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      title: 'Livro Público',
      description: { value: 'Sinopse pública do catálogo.' },
      covers: [12345],
    }), { status: 200 }));
    const context = createContext('/partilhar/livro/open_library/works%2FOL45804W');

    const response = await onRequestGet(context);
    const html = await response.text();

    expect(html).toContain('Livro Público | MediaDex');
    expect(html).toContain('https://covers.openlibrary.org/b/id/12345-L.jpg');
    expect(html).not.toContain('watchlist');
    expect(html).not.toContain('user_id');
  });

  it('passes through invalid paths without catalog requests or metadata injection', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const context = createContext('/partilhar/serie/not-valid');

    const response = await onRequestGet(context);

    expect(await response.text()).toBe(APP_HTML);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(context.next).toHaveBeenCalledTimes(1);
  });

  it('keeps a safe generic card when the catalog provider is unavailable', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('unavailable', { status: 503 }));
    const context = createContext('/partilhar/filme/550', { TMDB_API_KEY: 'secret' });

    const response = await onRequestGet(context);
    const html = await response.text();

    expect(html).toContain('Filme partilhado | MediaDex');
    expect(html).toContain('android-chrome-512x512.png');
  });
});
