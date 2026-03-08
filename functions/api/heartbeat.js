import {
  addCorsHeaders,
  addProxyHeaders,
  applyRateLimitHeaders,
  createRequestId,
  enforceRateLimit,
  handleOptions,
  jsonResponse,
  logEvent,
} from './_shared/security.js';

const HEARTBEAT_TABLE = 'system_heartbeat';
const ROUTE_KEY = 'heartbeat';

function isAuthorized(request, expectedToken) {
  if (!expectedToken) return true;
  const receivedToken = request.headers.get('x-heartbeat-token');
  return Boolean(receivedToken) && receivedToken === expectedToken;
}

async function readRequestBody(request) {
  if (request.method.toUpperCase() !== 'POST') return {};
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) return {};
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function createHeartbeatRecord(request, body) {
  const nowIso = new Date().toISOString();
  const userAgent = request.headers.get('user-agent');
  const cfRay = request.headers.get('cf-ray');
  const trigger = typeof body?.trigger === 'string' ? body.trigger : 'manual';
  const externalTimestamp = typeof body?.timestamp === 'string' ? body.timestamp : null;
  const triggeredAt = externalTimestamp || nowIso;

  return {
    source: 'cloudflare-pages-heartbeat',
    status: 'ok',
    triggered_at: triggeredAt,
    details: {
      trigger,
      method: request.method.toUpperCase(),
      requestTimestamp: nowIso,
      externalTimestamp,
      cfRay,
      userAgent,
    },
  };
}

async function persistHeartbeatRecord(env, record) {
  const supabaseUrl = env.SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return {
      persisted: false,
      reason: 'missing_supabase_credentials',
    };
  }

  const normalizedBaseUrl = supabaseUrl.replace(/\/$/, '');
  const response = await fetch(`${normalizedBaseUrl}/rest/v1/${HEARTBEAT_TABLE}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(record),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Supabase insert failed (${response.status}): ${errorBody.slice(0, 300)}`);
  }

  return { persisted: true };
}

export async function onRequest(context) {
  const { request, env } = context;
  const method = request.method.toUpperCase();
  const requestId = createRequestId(ROUTE_KEY);
  const startedAt = Date.now();
  const corsConfig = {
    methods: 'GET, POST, OPTIONS',
    headers: 'Content-Type, x-heartbeat-token',
  };

  const optionsResponse = handleOptions(request, requestId, corsConfig);
  if (optionsResponse) return optionsResponse;

  if (method !== 'GET' && method !== 'POST') {
    const response = addCorsHeaders(jsonResponse({ ok: false, error: 'Method not allowed' }, 405, {
      Allow: 'GET, POST, OPTIONS',
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

  const expectedToken = env.HEARTBEAT_TOKEN;
  if (!isAuthorized(request, expectedToken)) {
    const response = addCorsHeaders(jsonResponse({ ok: false, error: 'Unauthorized heartbeat request' }, 401), corsConfig);
    addProxyHeaders(response, {
      requestId,
      upstreamStatus: 401,
      durationMs: Date.now() - startedAt,
    });
    return applyRateLimitHeaders(response, rateLimit);
  }

  const body = await readRequestBody(request);
  const record = createHeartbeatRecord(request, body);

  try {
    const persistence = await persistHeartbeatRecord(env, record);
    const response = addCorsHeaders(jsonResponse({
      ok: true,
      source: 'cloudflare-pages-function',
      timestamp: new Date().toISOString(),
      method,
      ...persistence,
    }), corsConfig);
    addProxyHeaders(response, {
      requestId,
      upstreamStatus: 200,
      durationMs: Date.now() - startedAt,
    });
    return applyRateLimitHeaders(response, rateLimit);
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    logEvent('error', 'heartbeat.persist.error', { requestId, error: details });
    const response = addCorsHeaders(jsonResponse(
      {
        ok: false,
        source: 'cloudflare-pages-function',
        error: 'Failed to persist heartbeat',
        details,
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
