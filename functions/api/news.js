import {
  addCorsHeaders,
  addProxyHeaders,
  applyRateLimitHeaders,
  createRequestId,
  enforceRateLimit,
  getErrorMessage,
  handleOptions,
  jsonResponse,
  logEvent,
} from './_shared/security.js';

const ROUTE_KEY = 'news';
const CACHE_TTL_MS = 15 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8_000;
const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 60;

const NEWS_FEEDS = [
  {
    key: 'screenrant',
    source: 'ScreenRant',
    url: 'https://screenrant.com/feed/',
    defaultMediaType: 'general',
  },
  {
    key: 'movieweb',
    source: 'MovieWeb',
    url: 'https://movieweb.com/feed/',
    defaultMediaType: 'movie',
  },
  {
    key: 'deadline',
    source: 'Deadline',
    url: 'https://deadline.com/feed/',
    defaultMediaType: 'general',
  },
  {
    key: 'bookriot',
    source: 'Book Riot',
    url: 'https://bookriot.com/feed/',
    defaultMediaType: 'book',
  },
  {
    key: 'publishersweekly',
    source: 'Publishers Weekly',
    url: 'https://www.publishersweekly.com/pw/feeds/recent/index.xml',
    defaultMediaType: 'book',
  },
];

const getNewsCacheStore = () => {
  if (!globalThis.__seriesbdNewsCacheStore) {
    globalThis.__seriesbdNewsCacheStore = new Map();
  }
  return globalThis.__seriesbdNewsCacheStore;
};

const decodeHtmlEntities = (value) => String(value || '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
  .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
  .replace(/&amp;/gi, '&')
  .replace(/&quot;/gi, '"')
  .replace(/&#39;/gi, '\'')
  .replace(/&apos;/gi, '\'')
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')
  .replace(/&nbsp;/gi, ' ');

const stripHtml = (value) => decodeHtmlEntities(String(value || ''))
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<br\s*\/?>/gi, ' ')
  .replace(/<\/p>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const truncateText = (value, maxLength = 320) => {
  const normalized = String(value || '').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trim()}...`;
};

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const extractTagValue = (input, tagNames) => {
  const names = Array.isArray(tagNames) ? tagNames : [tagNames];
  for (const rawTag of names) {
    const tag = escapeRegex(rawTag);
    const match = input.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
    if (match?.[1]) return match[1].trim();
  }
  return '';
};

const extractAttributeFromTag = (input, tagName, attributeName, requiredSnippet = '') => {
  const tag = escapeRegex(tagName);
  const attribute = escapeRegex(attributeName);
  const matches = input.match(new RegExp(`<${tag}\\b[^>]*>`, 'gi')) || [];

  for (const match of matches) {
    if (requiredSnippet && !match.toLowerCase().includes(requiredSnippet.toLowerCase())) continue;
    const attributeMatch = match.match(new RegExp(`${attribute}=["']([^"']+)["']`, 'i'));
    if (attributeMatch?.[1]) return decodeHtmlEntities(attributeMatch[1].trim());
  }

  return '';
};

const extractImageUrl = (itemXml) => {
  const candidates = [
    extractAttributeFromTag(itemXml, 'media:content', 'url', 'medium="image'),
    extractAttributeFromTag(itemXml, 'media:content', 'url'),
    extractAttributeFromTag(itemXml, 'media:thumbnail', 'url'),
    extractAttributeFromTag(itemXml, 'enclosure', 'url', 'type="image/'),
    extractAttributeFromTag(itemXml, 'enclosure', 'url', 'type=\'image/'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (/^https?:\/\//i.test(candidate)) return candidate;
  }

  const richContent = [
    extractTagValue(itemXml, ['content:encoded', 'content']),
    extractTagValue(itemXml, 'description'),
  ].join(' ');
  const imgMatch = richContent.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (imgMatch?.[1] && /^https?:\/\//i.test(imgMatch[1])) return decodeHtmlEntities(imgMatch[1]);

  return null;
};

const normalizeUrl = (value) => {
  const raw = decodeHtmlEntities(String(value || '').trim());
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (!/^https?:$/i.test(parsed.protocol)) return '';
    return parsed.toString();
  } catch {
    return '';
  }
};

const normalizeDate = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
};

const slugify = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 80);

const classifyMediaType = (feedConfig, title, summary) => {
  if (feedConfig.defaultMediaType === 'book') return 'book';
  if (feedConfig.defaultMediaType === 'movie') return 'movie';

  const haystack = `${title} ${summary}`.toLowerCase();
  const bookScore = [
    /\bbook\b/g,
    /\bnovel\b/g,
    /\bauthor\b/g,
    /\bpublishing\b/g,
    /\bpublisher\b/g,
    /\bliterary\b/g,
    /\bmemoir\b/g,
  ].reduce((score, regex) => score + (regex.test(haystack) ? 1 : 0), 0);

  const seriesScore = [
    /\bseason\b/g,
    /\bepisode\b/g,
    /\bseries\b/g,
    /\bshowrunner\b/g,
    /\btv\b/g,
    /\bstreaming\b/g,
  ].reduce((score, regex) => score + (regex.test(haystack) ? 1 : 0), 0);

  const movieScore = [
    /\bmovie\b/g,
    /\bfilm\b/g,
    /\bbox office\b/g,
    /\bdirector\b/g,
    /\btheatrical\b/g,
    /\bcinema\b/g,
  ].reduce((score, regex) => score + (regex.test(haystack) ? 1 : 0), 0);

  if (bookScore > movieScore && bookScore > seriesScore) return 'book';
  if (seriesScore > movieScore && seriesScore > 0) return 'series';
  if (movieScore > 0) return 'movie';
  return 'general';
};

const parseFeedItems = (xml, feedConfig) => {
  const itemMatches = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
  return itemMatches.map((itemXml, index) => {
    const title = stripHtml(extractTagValue(itemXml, 'title'));
    const url = normalizeUrl(extractTagValue(itemXml, 'link'));
    const guid = stripHtml(extractTagValue(itemXml, 'guid'));
    const publishedAt = normalizeDate(extractTagValue(itemXml, ['pubDate', 'dc:date']));
    const rawSummary = extractTagValue(itemXml, ['content:encoded', 'description', 'content']);
    const summary = truncateText(stripHtml(rawSummary), 420);
    const imageUrl = normalizeUrl(extractImageUrl(itemXml));
    const mediaTypeHint = classifyMediaType(feedConfig, title, summary);
    const idSeed = guid || url || `${feedConfig.key}-${index}-${title}`;

    if (!title || !url) return null;

    return {
      id: `${feedConfig.key}-${slugify(idSeed) || index}`,
      title,
      url,
      source: feedConfig.source,
      sourceKey: feedConfig.key,
      publishedAt,
      mediaTypeHint,
      imageUrl: imageUrl || null,
      summary,
    };
  }).filter(Boolean);
};

const dedupeNewsItems = (items) => {
  const seen = new Set();
  return items.filter((item) => {
    const key = [item.url, slugify(item.title)].filter(Boolean).join('|');
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const fetchFeedXml = async (feedConfig) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(feedConfig.url, {
      method: 'GET',
      headers: {
        Accept: 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.1',
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Feed responded with status ${response.status}`);
    }

    const xml = await response.text();
    if (!xml.includes('<rss') && !xml.includes('<feed')) {
      throw new Error('Feed response is not valid RSS/XML');
    }

    return xml;
  } finally {
    clearTimeout(timeoutId);
  }
};

const getCachedFeed = (feedConfig) => {
  const store = getNewsCacheStore();
  const entry = store.get(feedConfig.key);
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) return entry.staleValue || null;
  return entry.value;
};

const setCachedFeed = (feedConfig, value) => {
  const store = getNewsCacheStore();
  const previous = store.get(feedConfig.key);
  store.set(feedConfig.key, {
    value,
    staleValue: previous?.value || value,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
};

const fetchNewsFromFeed = async (feedConfig, requestId) => {
  const startedAt = Date.now();
  const cached = getCachedFeed(feedConfig);

  try {
    const xml = await fetchFeedXml(feedConfig);
    const items = parseFeedItems(xml, feedConfig);
    const result = {
      ok: true,
      source: feedConfig.source,
      sourceKey: feedConfig.key,
      items,
      durationMs: Date.now() - startedAt,
      fromCache: false,
    };
    setCachedFeed(feedConfig, result);
    logEvent('info', 'news.feed.success', {
      requestId,
      source: feedConfig.key,
      count: items.length,
      durationMs: result.durationMs,
    });
    return result;
  } catch (error) {
    const details = getErrorMessage(error);
    if (cached) {
      logEvent('warn', 'news.feed.stale_cache', {
        requestId,
        source: feedConfig.key,
        error: details,
      });
      return {
        ...cached,
        fromCache: true,
        stale: true,
        error: details,
      };
    }

    logEvent('warn', 'news.feed.error', {
      requestId,
      source: feedConfig.key,
      durationMs: Date.now() - startedAt,
      error: details,
    });
    return {
      ok: false,
      source: feedConfig.source,
      sourceKey: feedConfig.key,
      items: [],
      durationMs: Date.now() - startedAt,
      error: details,
      fromCache: false,
    };
  }
};

const parseLimit = (url) => {
  const raw = Number(url.searchParams.get('limit') || DEFAULT_LIMIT);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.round(raw)));
};

const filterItemsByType = (items, requestedType) => {
  if (!requestedType || requestedType === 'all') return items;
  return items.filter((item) => item.mediaTypeHint === requestedType);
};

export const resetNewsCache = () => {
  getNewsCacheStore().clear();
};

export async function onRequest(context) {
  const { request } = context;
  const requestId = createRequestId(ROUTE_KEY);
  const startedAt = Date.now();
  const corsConfig = { methods: 'GET, OPTIONS', headers: 'Content-Type' };

  const optionsResponse = handleOptions(request, requestId, corsConfig);
  if (optionsResponse) return optionsResponse;

  if (request.method.toUpperCase() !== 'GET') {
    const response = addCorsHeaders(jsonResponse({ ok: false, error: 'Method not allowed' }, 405, {
      Allow: 'GET, OPTIONS',
    }), corsConfig);
    return addProxyHeaders(response, {
      requestId,
      upstreamStatus: 405,
      durationMs: Date.now() - startedAt,
    });
  }

  const rateLimit = enforceRateLimit(request, { routeKey: ROUTE_KEY, limit: 30, windowMs: 60_000 });
  if (!rateLimit.allowed) {
    const response = addCorsHeaders(jsonResponse({ ok: false, error: 'Rate limit exceeded' }, 429), corsConfig);
    addProxyHeaders(response, {
      requestId,
      upstreamStatus: 429,
      durationMs: Date.now() - startedAt,
    });
    return applyRateLimitHeaders(response, rateLimit);
  }

  const url = new URL(request.url);
  const limit = parseLimit(url);
  const requestedType = String(url.searchParams.get('type') || 'all').toLowerCase();

  try {
    const feedResults = await Promise.all(NEWS_FEEDS.map((feedConfig) => fetchNewsFromFeed(feedConfig, requestId)));
    const allItems = dedupeNewsItems(feedResults.flatMap((result) => result.items || []))
      .sort((a, b) => {
        const aTs = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
        const bTs = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
        return bTs - aTs;
      });

    const filteredItems = filterItemsByType(allItems, requestedType).slice(0, limit);
    const successfulSources = feedResults.filter((result) => result.ok).length;
    const hadPartialFailure = successfulSources < NEWS_FEEDS.length;
    const upstreamStatus = successfulSources > 0 ? 200 : 502;

    const response = addCorsHeaders(jsonResponse({
      ok: successfulSources > 0,
      items: filteredItems,
      meta: {
        total: filteredItems.length,
        requestedType,
        limit,
        generatedAt: new Date().toISOString(),
        partialFailure: hadPartialFailure,
        sources: feedResults.map((result) => ({
          key: result.sourceKey,
          source: result.source,
          ok: result.ok,
          itemCount: result.items.length,
          durationMs: result.durationMs,
          fromCache: Boolean(result.fromCache),
          stale: Boolean(result.stale),
          error: result.ok ? undefined : result.error,
        })),
      },
    }, upstreamStatus, {
      'Cache-Control': 'public, max-age=300',
    }), corsConfig);

    addProxyHeaders(response, {
      requestId,
      upstreamStatus,
      durationMs: Date.now() - startedAt,
    });
    return applyRateLimitHeaders(response, rateLimit);
  } catch (error) {
    const details = getErrorMessage(error);
    logEvent('error', 'news.aggregate.error', {
      requestId,
      error: details,
      durationMs: Date.now() - startedAt,
    });
    const response = addCorsHeaders(jsonResponse({
      ok: false,
      error: 'Failed to aggregate news feeds',
      details,
    }, 500), corsConfig);
    addProxyHeaders(response, {
      requestId,
      upstreamStatus: 500,
      durationMs: Date.now() - startedAt,
    });
    return applyRateLimitHeaders(response, rateLimit);
  }
}
