import {
  addCorsHeaders,
  addProxyHeaders,
  applyRateLimitHeaders,
  createRequestId,
  enforceRateLimit,
  getErrorMessage,
  handleOptions,
  isPathSafe,
  jsonResponse,
  logEvent,
  resolveEndpointPath,
  sanitizeOriginHeaders,
  sanitizeSearchParams,
} from '../_shared/security.js';

const TRAKT_BASE_URL = 'https://api.trakt.tv';
const TRAKT_API_VERSION = '2';
const ROUTE_KEY = 'trakt';

export async function onRequest(context) {
  const { request, env } = context;
  const requestId = createRequestId(ROUTE_KEY);
  const startedAt = Date.now();
  const corsConfig = {
    methods: 'GET, OPTIONS',
    headers: 'Content-Type, trakt-api-version, trakt-api-key',
  };

  const optionsResponse = handleOptions(request, requestId, corsConfig);
  if (optionsResponse) return optionsResponse;

  if (request.method.toUpperCase() !== 'GET') {
    const response = addCorsHeaders(jsonResponse({ ok: false, error: 'Method not allowed' }, 405, { Allow: 'GET, OPTIONS' }), corsConfig);
    return addProxyHeaders(response, {
      requestId,
      upstreamStatus: 405,
      durationMs: Date.now() - startedAt,
    });
  }

  const rateLimit = enforceRateLimit(request, { routeKey: ROUTE_KEY, limit: 90, windowMs: 60_000 });
  if (!rateLimit.allowed) {
    const response = addCorsHeaders(jsonResponse({ ok: false, error: 'Rate limit exceeded' }, 429), corsConfig);
    addProxyHeaders(response, {
      requestId,
      upstreamStatus: 429,
      durationMs: Date.now() - startedAt,
    });
    return applyRateLimitHeaders(response, rateLimit);
  }

  try {
    const traktApiKey = env.TRAKT_API_KEY;
    if (!traktApiKey) {
      throw new Error('A chave da API do Trakt não está configurada no ambiente da Cloudflare.');
    }

    const userAgent = env.TRAKT_USER_AGENT || 'seriesBD/1.0 (+https://seriesbd.pages.dev)';
    const url = new URL(request.url);
    const endpointPath = resolveEndpointPath(request.url, '/api/trakt');
    if (!isPathSafe(endpointPath)) {
      const badPath = addCorsHeaders(jsonResponse({ ok: false, error: 'Invalid endpoint path' }, 400), corsConfig);
      addProxyHeaders(badPath, {
        requestId,
        upstreamStatus: 400,
        durationMs: Date.now() - startedAt,
      });
      return applyRateLimitHeaders(badPath, rateLimit);
    }

    const safeParams = sanitizeSearchParams(url.searchParams, { maxParams: 25, maxValueLength: 700 });
    const traktUrl = new URL(`${TRAKT_BASE_URL}${endpointPath}`);
    safeParams.forEach((value, key) => {
      traktUrl.searchParams.set(key, value);
    });

    logEvent('info', 'proxy.request', {
      route: ROUTE_KEY,
      requestId,
      method: request.method.toUpperCase(),
      endpoint: endpointPath,
      target: traktUrl.toString(),
    });

    const apiResponse = await fetch(traktUrl.toString(), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'trakt-api-version': TRAKT_API_VERSION,
        'trakt-api-key': traktApiKey,
        'User-Agent': userAgent,
      },
    });

    const durationMs = Date.now() - startedAt;
    const contentType = apiResponse.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
      const htmlBody = await apiResponse.text();
      const cloudflareBlocked = /cloudflare|you have been blocked|attention required/i.test(htmlBody);
      if (cloudflareBlocked) {
        logEvent('error', 'proxy.cloudflare_block', {
          route: ROUTE_KEY,
          requestId,
          status: apiResponse.status,
          endpoint: endpointPath,
          durationMs,
        });
        const blockedResponse = addCorsHeaders(
          jsonResponse(
            {
              ok: false,
              error: 'Trakt blocked by Cloudflare',
              details: 'A chamada à Trakt foi bloqueada pelo Cloudflare.',
            },
            502
          ),
          corsConfig
        );
        addProxyHeaders(blockedResponse, {
          requestId,
          upstreamStatus: apiResponse.status,
          durationMs,
        });
        return applyRateLimitHeaders(blockedResponse, rateLimit);
      }

      logEvent('error', 'proxy.unexpected_html', {
        route: ROUTE_KEY,
        requestId,
        status: apiResponse.status,
        endpoint: endpointPath,
        durationMs,
      });
      const unexpectedHtml = addCorsHeaders(
        jsonResponse(
          {
            ok: false,
            error: 'Unexpected HTML response from Trakt',
            details: 'A Trakt respondeu com HTML em vez de JSON.',
          },
          502
        ),
        corsConfig
      );
      addProxyHeaders(unexpectedHtml, {
        requestId,
        upstreamStatus: apiResponse.status,
        durationMs,
      });
      return applyRateLimitHeaders(unexpectedHtml, rateLimit);
    }

    if (!apiResponse.ok) {
      const errorBody = await apiResponse.text();
      logEvent('warn', 'proxy.upstream_error', {
        route: ROUTE_KEY,
        requestId,
        endpoint: endpointPath,
        status: apiResponse.status,
        durationMs,
        bodyPreview: errorBody.slice(0, 300),
      });

      const errorResponse = new Response(errorBody, {
        status: apiResponse.status,
        statusText: apiResponse.statusText,
        headers: sanitizeOriginHeaders(apiResponse.headers),
      });
      addCorsHeaders(errorResponse, corsConfig);
      addProxyHeaders(errorResponse, {
        requestId,
        upstreamStatus: apiResponse.status,
        durationMs,
      });
      return applyRateLimitHeaders(errorResponse, rateLimit);
    }

    const response = new Response(apiResponse.body, {
      status: apiResponse.status,
      statusText: apiResponse.statusText,
      headers: sanitizeOriginHeaders(apiResponse.headers),
    });
    addCorsHeaders(response, corsConfig);
    addProxyHeaders(response, {
      requestId,
      upstreamStatus: apiResponse.status,
      durationMs,
    });

    return applyRateLimitHeaders(response, rateLimit);
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const message = getErrorMessage(error);
    logEvent('error', 'proxy.unexpected_error', {
      route: ROUTE_KEY,
      requestId,
      method: request.method.toUpperCase(),
      durationMs,
      error: message,
    });

    const errorResponse = addCorsHeaders(
      jsonResponse({ ok: false, error: 'Falha ao processar o pedido na função trakt', details: message }, 500),
      corsConfig
    );
    addProxyHeaders(errorResponse, {
      requestId,
      upstreamStatus: 500,
      durationMs,
    });

    return applyRateLimitHeaders(errorResponse, rateLimit);
  }
}
