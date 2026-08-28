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

const SIMKL_BASE_URL = 'https://api.simkl.com';
const ROUTE_KEY = 'simkl';
const ALLOWED_SEARCH_PARAMS = new Set(['imdb', 'tmdb', 'type', 'title', 'year']);

function isAllowedEndpoint(path) {
  return path === '/search/id'
    || /^\/tv\/\d+$/.test(path)
    || /^\/movies\/\d+$/.test(path);
}

export async function onRequest(context) {
  const { request, env } = context;
  const requestId = createRequestId(ROUTE_KEY);
  const startedAt = Date.now();
  const corsConfig = { methods: 'GET, OPTIONS', headers: 'Content-Type' };
  const optionsResponse = handleOptions(request, requestId, corsConfig);
  if (optionsResponse) return optionsResponse;

  if (request.method.toUpperCase() !== 'GET') {
    const response = addCorsHeaders(jsonResponse({ ok: false, error: 'Method not allowed' }, 405, { Allow: 'GET, OPTIONS' }), corsConfig);
    addProxyHeaders(response, { requestId, upstreamStatus: 405, durationMs: Date.now() - startedAt });
    return response;
  }

  const rateLimit = enforceRateLimit(request, { routeKey: ROUTE_KEY, limit: 60, windowMs: 60_000 });
  if (!rateLimit.allowed) {
    const response = addCorsHeaders(jsonResponse({ ok: false, error: 'Rate limit exceeded' }, 429), corsConfig);
    addProxyHeaders(response, { requestId, upstreamStatus: 429, durationMs: Date.now() - startedAt });
    return applyRateLimitHeaders(response, rateLimit);
  }

  try {
    const clientId = String(env.SIMKL_CLIENT_ID || '').trim();
    if (!clientId) throw new Error('SIMKL_CLIENT_ID is not configured.');

    const endpointPath = resolveEndpointPath(request.url, '/api/simkl');
    if (!isPathSafe(endpointPath) || !isAllowedEndpoint(endpointPath)) {
      const response = addCorsHeaders(jsonResponse({ ok: false, error: 'Unsupported Simkl endpoint' }, 400), corsConfig);
      addProxyHeaders(response, { requestId, upstreamStatus: 400, durationMs: Date.now() - startedAt });
      return applyRateLimitHeaders(response, rateLimit);
    }

    const requestUrl = new URL(request.url);
    const safeParams = sanitizeSearchParams(requestUrl.searchParams, { maxParams: 5, maxValueLength: 300 });
    for (const key of safeParams.keys()) {
      if (!ALLOWED_SEARCH_PARAMS.has(key)) {
        const response = addCorsHeaders(jsonResponse({ ok: false, error: 'Unsupported Simkl query parameter' }, 400), corsConfig);
        addProxyHeaders(response, { requestId, upstreamStatus: 400, durationMs: Date.now() - startedAt });
        return applyRateLimitHeaders(response, rateLimit);
      }
    }

    const simklUrl = new URL(`${SIMKL_BASE_URL}${endpointPath}`);
    safeParams.forEach((value, key) => simklUrl.searchParams.set(key, value));
    simklUrl.searchParams.set('client_id', clientId);
    simklUrl.searchParams.set('app-name', String(env.SIMKL_APP_NAME || 'mediadex'));
    simklUrl.searchParams.set('app-version', String(env.SIMKL_APP_VERSION || '1.0.0'));

    logEvent('info', 'proxy.request', {
      route: ROUTE_KEY,
      requestId,
      method: 'GET',
      endpoint: endpointPath,
    });

    const apiResponse = await fetch(simklUrl.toString(), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': String(env.SIMKL_USER_AGENT || 'MediaDex/1.0 (+https://mediadex.app)'),
      },
    });
    const durationMs = Date.now() - startedAt;
    const contentType = apiResponse.headers.get('content-type') || '';

    if (!apiResponse.ok || contentType.includes('text/html')) {
      logEvent('warn', 'proxy.upstream_error', {
        route: ROUTE_KEY,
        requestId,
        endpoint: endpointPath,
        status: apiResponse.status,
        durationMs,
      });
      const response = addCorsHeaders(jsonResponse({ ok: false, error: 'Simkl upstream request failed' }, apiResponse.ok ? 502 : apiResponse.status), corsConfig);
      addProxyHeaders(response, { requestId, upstreamStatus: apiResponse.status, durationMs });
      return applyRateLimitHeaders(response, rateLimit);
    }

    const response = new Response(apiResponse.body, {
      status: apiResponse.status,
      statusText: apiResponse.statusText,
      headers: sanitizeOriginHeaders(apiResponse.headers),
    });
    addCorsHeaders(response, corsConfig);
    addProxyHeaders(response, { requestId, upstreamStatus: apiResponse.status, durationMs });
    return applyRateLimitHeaders(response, rateLimit);
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    logEvent('error', 'proxy.unexpected_error', {
      route: ROUTE_KEY,
      requestId,
      durationMs,
      error: getErrorMessage(error),
    });
    const response = addCorsHeaders(jsonResponse({ ok: false, error: 'Falha ao processar o pedido na função Simkl' }, 500), corsConfig);
    addProxyHeaders(response, { requestId, upstreamStatus: 500, durationMs });
    return applyRateLimitHeaders(response, rateLimit);
  }
}
