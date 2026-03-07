const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
};
const HEARTBEAT_TABLE = 'system_heartbeat';

function jsonResponse(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...JSON_HEADERS,
      ...extraHeaders,
    },
  });
}

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

  if (method !== 'GET' && method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed' }, 405, {
      Allow: 'GET, POST',
    });
  }

  const expectedToken = env.HEARTBEAT_TOKEN;
  if (!isAuthorized(request, expectedToken)) {
    return jsonResponse({ ok: false, error: 'Unauthorized heartbeat request' }, 401);
  }

  const body = await readRequestBody(request);
  const record = createHeartbeatRecord(request, body);

  try {
    const persistence = await persistHeartbeatRecord(env, record);
    return jsonResponse({
      ok: true,
      source: 'cloudflare-pages-function',
      timestamp: new Date().toISOString(),
      method,
      ...persistence,
    });
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    return jsonResponse(
      {
        ok: false,
        source: 'cloudflare-pages-function',
        error: 'Failed to persist heartbeat',
        details,
      },
      500
    );
  }

}
