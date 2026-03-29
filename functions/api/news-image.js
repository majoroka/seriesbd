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
  sanitizeOriginHeaders,
} from './_shared/security.js';

const ROUTE_KEY = 'news-image';
const IMAGE_FETCH_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;
const ALLOWED_IMAGE_HOST_PATTERNS = [
  /(^|\.)image\.tmdb\.org$/i,
  /(^|\.)trakt\.tv$/i,
  /^covers\.openlibrary\.org$/i,
  /(^|\.)archive\.org$/i,
  /^books\.google\.[a-z.]+$/i,
  /^books\.googleusercontent\.com$/i,
  /(^|\.)googleusercontent\.com$/i,
  /(^|\.)gstatic\.com$/i,
  /(^|\.)presenca\.pt$/i,
  /(^|\.)shopify\.com$/i,
  /(^|\.)shopifycdn\.com$/i,
  /(^|\.)vtexassets\.com$/i,
  /(^|\.)media-amazon\.com$/i,
  /(^|\.)ssl-images-amazon\.com$/i,
  /(^|\.)images-amazon\.com$/i,
  /(^|\.)gr-assets\.com$/i,
  /(^|\.)goodreads\.com$/i,
  /(^|\.)screenrant\.com$/i,
  /(^|\.)srcdn\.com$/i,
  /(^|\.)movieweb\.com$/i,
  /(^|\.)moviewebimages\.com$/i,
  /(^|\.)deadline\.com$/i,
  /(^|\.)bookriot\.com$/i,
  /(^|\.)publishersweekly\.com$/i,
];

const isAllowedProtocol = (url) => url.protocol === 'https:' || url.protocol === 'http:';

const normalizeHostname = (hostname) => String(hostname || '')
  .trim()
  .replace(/^\[(.*)\]$/, '$1')
  .replace(/\.$/, '')
  .toLowerCase();

const parseIpv4Literal = (hostname) => {
  const normalized = normalizeHostname(hostname);
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(normalized)) return null;
  const parts = normalized.split('.').map((part) => Number.parseInt(part, 10));
  if (parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) return null;
  return parts;
};

const isBlockedIpv4Literal = (hostname) => {
  const parts = parseIpv4Literal(hostname);
  if (!parts) return false;
  const [a, b] = parts;
  return (
    a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || a >= 224
  );
};

const isBlockedIpv6Literal = (hostname) => {
  const normalized = normalizeHostname(hostname);
  if (!normalized.includes(':')) return false;
  if (normalized === '::' || normalized === '::1') return true;
  if (normalized.startsWith('::ffff:')) {
    return isBlockedIpv4Literal(normalized.slice('::ffff:'.length));
  }
  return (
    /^fc/i.test(normalized)
    || /^fd/i.test(normalized)
    || /^fe[89ab]/i.test(normalized)
  );
};

const isBlockedHostname = (hostname) => {
  const normalized = normalizeHostname(hostname);
  return (
    normalized === 'localhost'
    || normalized.endsWith('.localhost')
    || normalized.endsWith('.internal')
    || isBlockedIpv4Literal(normalized)
    || isBlockedIpv6Literal(normalized)
  );
};

const isAllowlistedHostname = (hostname) => {
  const normalized = normalizeHostname(hostname);
  return ALLOWED_IMAGE_HOST_PATTERNS.some((pattern) => pattern.test(normalized));
};

class BlockedImageUrlError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BlockedImageUrlError';
  }
}

const assertAllowedTargetUrl = (targetUrl, errorMessage = 'Blocked image url') => {
  if (!isAllowedProtocol(targetUrl) || isBlockedHostname(targetUrl.hostname) || !isAllowlistedHostname(targetUrl.hostname)) {
    throw new BlockedImageUrlError(errorMessage);
  }
};

const fetchWithValidatedRedirects = async (targetUrl, controller) => {
  let currentUrl = new URL(targetUrl.toString());

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const response = await fetch(currentUrl.toString(), {
      method: 'GET',
      headers: {
        Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      },
      redirect: 'manual',
      signal: controller.signal,
    });

    if (![301, 302, 303, 307, 308].includes(response.status)) {
      return response;
    }

    if (redirectCount === MAX_REDIRECTS) {
      throw new Error('Too many image redirects');
    }

    const location = response.headers.get('location');
    if (!location) {
      throw new Error('Redirected image response is missing a location header');
    }

    let redirectUrl;
    try {
      redirectUrl = new URL(location, currentUrl);
    } catch {
      throw new Error('Redirected image location is invalid');
    }

    assertAllowedTargetUrl(redirectUrl, 'Blocked image redirect');
    currentUrl = redirectUrl;
  }

  throw new Error('Too many image redirects');
};

export async function onRequest(context) {
  const { request } = context;
  const requestId = createRequestId(ROUTE_KEY);
  const startedAt = Date.now();
  const corsConfig = { origin: 'https://mediadex.app', methods: 'GET, OPTIONS', headers: 'Content-Type' };

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

  const rateLimit = enforceRateLimit(request, { routeKey: ROUTE_KEY, limit: 180, windowMs: 60_000 });
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
  const rawImageUrl = String(url.searchParams.get('url') || '').trim();
  if (!rawImageUrl) {
    const response = addCorsHeaders(jsonResponse({ ok: false, error: 'Missing image url' }, 400), corsConfig);
    return applyRateLimitHeaders(addProxyHeaders(response, {
      requestId,
      upstreamStatus: 400,
      durationMs: Date.now() - startedAt,
    }), rateLimit);
  }

  let targetUrl;
  try {
    targetUrl = new URL(rawImageUrl);
  } catch {
    const response = addCorsHeaders(jsonResponse({ ok: false, error: 'Invalid image url' }, 400), corsConfig);
    return applyRateLimitHeaders(addProxyHeaders(response, {
      requestId,
      upstreamStatus: 400,
      durationMs: Date.now() - startedAt,
    }), rateLimit);
  }

  if (!isAllowedProtocol(targetUrl) || isBlockedHostname(targetUrl.hostname)) {
    const response = addCorsHeaders(jsonResponse({ ok: false, error: 'Blocked image url' }, 400), corsConfig);
    return applyRateLimitHeaders(addProxyHeaders(response, {
      requestId,
      upstreamStatus: 400,
      durationMs: Date.now() - startedAt,
    }), rateLimit);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS);

  try {
    assertAllowedTargetUrl(targetUrl);
    const upstreamResponse = await fetchWithValidatedRedirects(targetUrl, controller);

    const durationMs = Date.now() - startedAt;
    if (!upstreamResponse.ok) {
      logEvent('warn', 'news.image.error', {
        requestId,
        status: upstreamResponse.status,
        url: targetUrl.toString(),
      });
      const response = addCorsHeaders(jsonResponse({ ok: false, error: `Image responded with status ${upstreamResponse.status}` }, upstreamResponse.status), corsConfig);
      return applyRateLimitHeaders(addProxyHeaders(response, {
        requestId,
        upstreamStatus: upstreamResponse.status,
        durationMs,
      }), rateLimit);
    }

    const contentType = upstreamResponse.headers.get('content-type') || '';
    if (!contentType.toLowerCase().startsWith('image/')) {
      const response = addCorsHeaders(jsonResponse({ ok: false, error: 'Upstream resource is not an image' }, 415), corsConfig);
      return applyRateLimitHeaders(addProxyHeaders(response, {
        requestId,
        upstreamStatus: 415,
        durationMs,
      }), rateLimit);
    }

    const headers = sanitizeOriginHeaders(upstreamResponse.headers);
    headers.set('Cache-Control', 'public, max-age=86400');
    const response = new Response(upstreamResponse.body, {
      status: 200,
      headers,
    });
    addCorsHeaders(response, corsConfig);
    applyRateLimitHeaders(response, rateLimit);
    return addProxyHeaders(response, {
      requestId,
      upstreamStatus: upstreamResponse.status,
      durationMs,
    });
  } catch (error) {
    if (error instanceof BlockedImageUrlError) {
      const response = addCorsHeaders(jsonResponse({ ok: false, error: error.message }, 400), corsConfig);
      return applyRateLimitHeaders(addProxyHeaders(response, {
        requestId,
        upstreamStatus: 400,
        durationMs: Date.now() - startedAt,
      }), rateLimit);
    }
    const response = addCorsHeaders(jsonResponse({ ok: false, error: 'Unable to fetch image' }, 502), corsConfig);
    logEvent('warn', 'news.image.fetch_failed', {
      requestId,
      error: getErrorMessage(error),
      url: targetUrl.toString(),
    });
    return applyRateLimitHeaders(addProxyHeaders(response, {
      requestId,
      upstreamStatus: 502,
      durationMs: Date.now() - startedAt,
    }), rateLimit);
  } finally {
    clearTimeout(timeoutId);
  }
}
