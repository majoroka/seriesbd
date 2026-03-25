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
  maskApiKeyFromUrl,
  resolveEndpointPath,
  sanitizeOriginHeaders,
  sanitizeSearchParams,
} from '../_shared/security.js';

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const ROUTE_KEY = 'tmdb';

export async function onRequest(context) {
  const { request, env } = context;
  const requestId = createRequestId(ROUTE_KEY);
  const startedAt = Date.now();
  const corsConfig = { methods: 'GET, OPTIONS', headers: 'Content-Type' };
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

  const rateLimit = enforceRateLimit(request, { routeKey: ROUTE_KEY, limit: 120, windowMs: 60_000 });
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
    const tmdbApiKey = env.TMDB_API_KEY;
    if (!tmdbApiKey) {
      throw new Error('A chave da API do TMDb não está configurada no ambiente da Cloudflare.');
    }

    const url = new URL(request.url);
    const endpointPath = resolveEndpointPath(request.url, '/api/tmdb');
    if (!isPathSafe(endpointPath)) {
      const badPathResponse = addCorsHeaders(jsonResponse({ ok: false, error: 'Invalid endpoint path' }, 400), corsConfig);
      addProxyHeaders(badPathResponse, {
        requestId,
        upstreamStatus: 400,
        durationMs: Date.now() - startedAt,
      });
      return applyRateLimitHeaders(badPathResponse, rateLimit);
    }

    const safeParams = sanitizeSearchParams(url.searchParams, { maxParams: 30, maxValueLength: 800 });
    const tmdbUrl = new URL(`${TMDB_BASE_URL}${endpointPath}`);
    safeParams.forEach((value, key) => {
      tmdbUrl.searchParams.set(key, value);
    });
    tmdbUrl.searchParams.set('api_key', tmdbApiKey);
    if (!tmdbUrl.searchParams.has('language')) {
      tmdbUrl.searchParams.set('language', 'pt-PT');
    }

    logEvent('info', 'proxy.request', {
      route: ROUTE_KEY,
      requestId,
      method: request.method.toUpperCase(),
      endpoint: endpointPath,
      target: maskApiKeyFromUrl(tmdbUrl.toString()),
    });

    const apiResponse = await fetch(tmdbUrl.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    const durationMs = Date.now() - startedAt;
    if (!apiResponse.ok) {
      logEvent('warn', 'proxy.upstream_error', {
        route: ROUTE_KEY,
        requestId,
        endpoint: endpointPath,
        status: apiResponse.status,
        durationMs,
      });
    }

    const response = new Response(apiResponse.body, {
      status: apiResponse.status,
      statusText: apiResponse.statusText,
      headers: sanitizeOriginHeaders(apiResponse.headers),
    });

    response.headers.set('Cache-Control', 'public, max-age=3600');
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

    const response = addCorsHeaders(
      jsonResponse({ ok: false, error: 'Falha ao processar o pedido na função tmdb' }, 500),
      corsConfig
    );

    addProxyHeaders(response, {
      requestId,
      upstreamStatus: 500,
      durationMs,
    });

    return applyRateLimitHeaders(response, rateLimit);
  }
}
