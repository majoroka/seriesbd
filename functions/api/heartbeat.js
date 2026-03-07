const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
};

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

  return jsonResponse({
    ok: true,
    source: 'cloudflare-pages-function',
    timestamp: new Date().toISOString(),
    method,
  });
}
