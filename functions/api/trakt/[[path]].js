const TRAKT_BASE_URL = 'https://api.trakt.tv';
const TRAKT_API_VERSION = '2';
const PROXY_HEADER_EXPOSE = 'x-request-id, x-upstream-status, x-upstream-latency-ms';

const createRequestId = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `trakt_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
};

const getErrorMessage = (error) => (error instanceof Error ? error.message : String(error));

const addProxyHeaders = (response, { requestId, upstreamStatus, durationMs }) => {
  response.headers.set('x-request-id', requestId);
  response.headers.set('x-upstream-status', String(upstreamStatus));
  response.headers.set('x-upstream-latency-ms', String(durationMs));
  response.headers.set('Access-Control-Expose-Headers', PROXY_HEADER_EXPOSE);
  return response;
};

const addCorsHeaders = (response) => {
  response.headers.set('Access-Control-Allow-Origin', '*');
  response.headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, trakt-api-version, trakt-api-key');
  response.headers.set('Access-Control-Max-Age', '86400');
  response.headers.set('Access-Control-Expose-Headers', PROXY_HEADER_EXPOSE);
  return response;
};

const sanitizeOriginHeaders = (sourceHeaders) => {
  const headers = new Headers(sourceHeaders);
  headers.delete('content-encoding');
  headers.delete('content-length');
  headers.delete('Content-Encoding');
  headers.delete('Content-Length');
  return headers;
};

const resolveEndpointPath = (requestUrl) => {
  const url = new URL(requestUrl);
  let endpointPath = url.pathname;
  if (endpointPath.startsWith('/api/trakt')) {
    endpointPath = endpointPath.substring('/api/trakt'.length);
  }
  return endpointPath || '/';
};

export async function onRequest(context) {
  const { request, env } = context;
  const requestId = createRequestId();
  const startedAt = Date.now();

  if (request.method === 'OPTIONS') {
    const optionsResponse = addCorsHeaders(new Response(null, { status: 204 }));
    optionsResponse.headers.set('x-request-id', requestId);
    return optionsResponse;
  }

  try {
    const traktApiKey = env.TRAKT_API_KEY;
    if (!traktApiKey) {
      throw new Error('A chave da API do Trakt não está configurada no ambiente da Cloudflare.');
    }

    const userAgent = env.TRAKT_USER_AGENT || 'seriesBD/1.0 (+https://seriesbd.pages.dev)';
    const url = new URL(request.url);
    const endpointPath = resolveEndpointPath(request.url);
    const traktUrl = `${TRAKT_BASE_URL}${endpointPath}?${url.searchParams.toString()}`;

    console.log('[trakt function] Proxy request', {
      requestId,
      method: request.method,
      endpoint: endpointPath,
      target: traktUrl,
    });

    const apiResponse = await fetch(traktUrl, {
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
        console.error('[trakt function] Cloudflare block detected while calling Trakt.', {
          requestId,
          status: apiResponse.status,
          endpoint: endpointPath,
          durationMs,
        });
        const blockedResponse = new Response(
          JSON.stringify({
            error: 'Trakt blocked by Cloudflare',
            details: 'A chamada à Trakt foi bloqueada pelo Cloudflare.',
          }),
          { status: 502, headers: { 'Content-Type': 'application/json' } }
        );
        addProxyHeaders(blockedResponse, {
          requestId,
          upstreamStatus: apiResponse.status,
          durationMs,
        });
        return addCorsHeaders(blockedResponse);
      }

      console.error('[trakt function] Unexpected HTML response from upstream.', {
        requestId,
        status: apiResponse.status,
        endpoint: endpointPath,
        durationMs,
      });
      const unexpectedHtmlResponse = new Response(
        JSON.stringify({
          error: 'Unexpected HTML response from Trakt',
          details: 'A Trakt respondeu com HTML em vez de JSON.',
        }),
        { status: 502, headers: { 'Content-Type': 'application/json' } }
      );
      addProxyHeaders(unexpectedHtmlResponse, {
        requestId,
        upstreamStatus: apiResponse.status,
        durationMs,
      });
      return addCorsHeaders(unexpectedHtmlResponse);
    }

    if (!apiResponse.ok) {
      const errorBody = await apiResponse.text();
      console.error('[trakt function] Upstream error', {
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
      addProxyHeaders(errorResponse, {
        requestId,
        upstreamStatus: apiResponse.status,
        durationMs,
      });
      return addCorsHeaders(errorResponse);
    }

    const response = new Response(apiResponse.body, {
      status: apiResponse.status,
      statusText: apiResponse.statusText,
      headers: sanitizeOriginHeaders(apiResponse.headers),
    });
    addProxyHeaders(response, {
      requestId,
      upstreamStatus: apiResponse.status,
      durationMs,
    });

    return addCorsHeaders(response);
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const message = getErrorMessage(error);
    console.error('[trakt function] Unexpected error', {
      requestId,
      method: request.method,
      durationMs,
      error: message,
    });

    const errorResponse = new Response(
      JSON.stringify({ error: 'Falha ao processar o pedido na função trakt', details: message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
    addProxyHeaders(errorResponse, {
      requestId,
      upstreamStatus: 500,
      durationMs,
    });

    return addCorsHeaders(errorResponse);
  }
}
