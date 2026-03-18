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

const isAllowedProtocol = (url) => url.protocol === 'https:' || url.protocol === 'http:';

const isBlockedHostname = (hostname) => {
  const normalized = String(hostname || '').toLowerCase();
  return (
    normalized === 'localhost'
    || normalized.endsWith('.localhost')
    || normalized === '127.0.0.1'
    || normalized === '0.0.0.0'
    || normalized.endsWith('.internal')
  );
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
    const upstreamResponse = await fetch(targetUrl.toString(), {
      method: 'GET',
      headers: {
        Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      },
      redirect: 'follow',
      signal: controller.signal,
    });

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
