import {
  addCorsHeaders,
  addProxyHeaders,
  applyRateLimitHeaders,
  createRequestId,
  enforceRateLimit,
  handleOptions,
  jsonResponse,
  logEvent,
} from '../_shared/security.js';

const ROUTE_KEY = 'auth.display_name_available';

function normalizeDisplayName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function resolveRequestedName(url) {
  return url.searchParams.get('name') || url.searchParams.get('display_name') || '';
}

async function fetchMatchingProfiles(env, normalizedName) {
  const supabaseUrl = env.SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase server credentials are missing.');
  }

  const baseUrl = supabaseUrl.replace(/\/$/, '');
  const queryUrl = new URL(`${baseUrl}/rest/v1/profiles`);
  queryUrl.searchParams.set('select', 'id,display_name');
  queryUrl.searchParams.set('display_name', `ilike.${normalizedName}`);
  queryUrl.searchParams.set('limit', '1');

  const response = await fetch(queryUrl.toString(), {
    method: 'GET',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Supabase select failed (${response.status}): ${errorBody.slice(0, 300)}`);
  }

  const rows = await response.json();
  return Array.isArray(rows) ? rows : [];
}

export async function onRequest(context) {
  const { request, env } = context;
  const method = request.method.toUpperCase();
  const requestId = createRequestId('auth');
  const startedAt = Date.now();
  const corsConfig = { methods: 'GET, OPTIONS', headers: 'Content-Type' };

  const optionsResponse = handleOptions(request, requestId, corsConfig);
  if (optionsResponse) return optionsResponse;

  if (method !== 'GET') {
    const response = addCorsHeaders(jsonResponse({ ok: false, error: 'Method not allowed' }, 405, {
      Allow: 'GET, OPTIONS',
    }), corsConfig);
    return addProxyHeaders(response, {
      requestId,
      upstreamStatus: 405,
      durationMs: Date.now() - startedAt,
    });
  }

  const rateLimit = enforceRateLimit(request, { routeKey: ROUTE_KEY, limit: 20, windowMs: 60_000 });
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
  const normalizedName = normalizeDisplayName(resolveRequestedName(url));

  if (!normalizedName) {
    const response = addCorsHeaders(jsonResponse({ ok: false, error: 'Missing name parameter' }, 400), corsConfig);
    addProxyHeaders(response, {
      requestId,
      upstreamStatus: 400,
      durationMs: Date.now() - startedAt,
    });
    return applyRateLimitHeaders(response, rateLimit);
  }

  if (normalizedName.length < 3) {
    const response = addCorsHeaders(jsonResponse({ ok: false, error: 'Display name must have at least 3 characters' }, 400), corsConfig);
    addProxyHeaders(response, {
      requestId,
      upstreamStatus: 400,
      durationMs: Date.now() - startedAt,
    });
    return applyRateLimitHeaders(response, rateLimit);
  }

  if (normalizedName.length > 80) {
    const response = addCorsHeaders(jsonResponse({ ok: false, error: 'Display name exceeds 80 characters' }, 400), corsConfig);
    addProxyHeaders(response, {
      requestId,
      upstreamStatus: 400,
      durationMs: Date.now() - startedAt,
    });
    return applyRateLimitHeaders(response, rateLimit);
  }

  try {
    const rows = await fetchMatchingProfiles(env, normalizedName);
    const response = addCorsHeaders(jsonResponse({
      ok: true,
      normalizedName,
      available: rows.length === 0,
    }), corsConfig);
    addProxyHeaders(response, {
      requestId,
      upstreamStatus: 200,
      durationMs: Date.now() - startedAt,
    });
    return applyRateLimitHeaders(response, rateLimit);
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    logEvent('error', 'auth.display_name_available.error', {
      requestId,
      error: details,
    });
    const response = addCorsHeaders(jsonResponse(
      {
        ok: false,
        error: 'Failed to validate display name',
      },
      500
    ), corsConfig);
    addProxyHeaders(response, {
      requestId,
      upstreamStatus: 500,
      durationMs: Date.now() - startedAt,
    });
    return applyRateLimitHeaders(response, rateLimit);
  }
}
