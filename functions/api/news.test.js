import { beforeEach, describe, expect, it, vi } from 'vitest';
import { onRequest, resetNewsCache } from './news.js';
import { resetRateLimitStore } from './_shared/security.js';

const RSS_WITH_MEDIA = `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <item>
      <title><![CDATA[New TV Series Trailer Released]]></title>
      <link>https://example.com/news/tv-trailer</link>
      <guid>tv-trailer-1</guid>
      <pubDate>Tue, 18 Mar 2026 18:00:00 GMT</pubDate>
      <description><![CDATA[<p>The new series trailer is finally here.</p>]]></description>
      <media:content url="https://cdn.example.com/posters/tv.jpg" medium="image" />
    </item>
    <item>
      <title><![CDATA[Duplicate news item]]></title>
      <link>https://example.com/news/duplicate</link>
      <guid>dup-1</guid>
      <pubDate>Tue, 18 Mar 2026 17:00:00 GMT</pubDate>
      <description><![CDATA[Duplicate body]]></description>
    </item>
  </channel>
</rss>`;

const RSS_WITH_CONTENT_IMAGE = `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <item>
      <title><![CDATA[Big Movie Box Office Update]]></title>
      <link>https://example.com/news/movie-box-office</link>
      <guid>movie-1</guid>
      <pubDate>Tue, 18 Mar 2026 19:00:00 GMT</pubDate>
      <content:encoded><![CDATA[<p>Movie news body.</p><img src="https://cdn.example.com/posters/movie.jpg" />]]></content:encoded>
    </item>
    <item>
      <title><![CDATA[Duplicate news item]]></title>
      <link>https://example.com/news/duplicate</link>
      <guid>dup-2</guid>
      <pubDate>Tue, 18 Mar 2026 16:00:00 GMT</pubDate>
      <description><![CDATA[Duplicate body 2]]></description>
    </item>
  </channel>
</rss>`;

const RSS_BOOK = `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0">
  <channel>
    <item>
      <title><![CDATA[New Book From Famous Author]]></title>
      <link>https://example.com/news/book-launch</link>
      <guid>book-1</guid>
      <pubDate>Tue, 18 Mar 2026 20:00:00 GMT</pubDate>
      <description><![CDATA[<p>A literary release with <strong>HTML</strong>.</p>]]></description>
    </item>
  </channel>
</rss>`;

describe('news function', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetNewsCache();
    resetRateLimitStore();
  });

  it('aggregates, normalizes, deduplicates and sorts RSS items', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('screenrant.com/feed')) return new Response(RSS_WITH_MEDIA, { status: 200 });
      if (url.includes('movieweb.com/feed')) return new Response(RSS_WITH_CONTENT_IMAGE, { status: 200 });
      if (url.includes('bookriot.com/feed')) return new Response(RSS_BOOK, { status: 200 });
      return new Response('upstream error', { status: 503 });
    });

    const response = await onRequest({
      request: new Request('https://example.com/api/news?limit=10', {
        method: 'GET',
        headers: { 'cf-connecting-ip': '10.0.0.10' },
      }),
    });

    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.items).toHaveLength(4);
    expect(body.items[0].title).toBe('New Book From Famous Author');
    expect(body.items[0].mediaTypeHint).toBe('book');
    expect(body.items[1].imageUrl).toBe('https://cdn.example.com/posters/movie.jpg');
    expect(body.items[1].mediaTypeHint).toBe('movie');
    expect(body.items[2].imageUrl).toBe('https://cdn.example.com/posters/tv.jpg');
    expect(body.items[2].summary).toBe('The new series trailer is finally here.');
    expect(body.meta.partialFailure).toBe(true);
  });

  it('returns 502 when every feed fails and there is no cache', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('failure', { status: 500 }));

    const response = await onRequest({
      request: new Request('https://example.com/api/news', {
        method: 'GET',
        headers: { 'cf-connecting-ip': '10.0.0.11' },
      }),
    });

    const body = await response.json();
    expect(response.status).toBe(502);
    expect(body.ok).toBe(false);
    expect(body.items).toHaveLength(0);
    expect(body.meta.partialFailure).toBe(true);
  });

  it('serves stale cache when a previously successful feed later fails', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock.mockImplementationOnce(async (input) => {
      const url = String(input);
      if (url.includes('screenrant.com/feed')) return new Response(RSS_WITH_MEDIA, { status: 200 });
      return new Response('failure', { status: 500 });
    });
    fetchMock.mockImplementationOnce(async () => new Response('failure', { status: 500 }));
    fetchMock.mockImplementationOnce(async () => new Response('failure', { status: 500 }));
    fetchMock.mockImplementationOnce(async () => new Response('failure', { status: 500 }));
    fetchMock.mockImplementationOnce(async () => new Response('failure', { status: 500 }));

    let response = await onRequest({
      request: new Request('https://example.com/api/news?limit=5', {
        method: 'GET',
        headers: { 'cf-connecting-ip': '10.0.0.12' },
      }),
    });

    expect(response.status).toBe(200);

    fetchMock.mockClear();
    fetchMock.mockImplementation(async () => new Response('failure', { status: 500 }));

    response = await onRequest({
      request: new Request('https://example.com/api/news?limit=5', {
        method: 'GET',
        headers: { 'cf-connecting-ip': '10.0.0.13' },
      }),
    });

    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.items).toHaveLength(2);
    expect(body.meta.sources.some((source) => source.source === 'ScreenRant' && source.fromCache)).toBe(true);
  });
});
