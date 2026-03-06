const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const PROXY_HEADER_EXPOSE = 'x-request-id, x-upstream-status, x-upstream-latency-ms';

const createRequestId = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `tmdb_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
};

const getErrorMessage = (error) => (error instanceof Error ? error.message : String(error));

const maskApiKey = (rawUrl) => {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.searchParams.has('api_key')) parsed.searchParams.set('api_key', '***');
    return parsed.toString();
  } catch {
    return rawUrl.replace(/api_key=[^&]+/g, 'api_key=***');
  }
};

const addProxyHeaders = (response, { requestId, upstreamStatus, durationMs }) => {
  response.headers.set('x-request-id', requestId);
  response.headers.set('x-upstream-status', String(upstreamStatus));
  response.headers.set('x-upstream-latency-ms', String(durationMs));
  response.headers.set('Access-Control-Expose-Headers', PROXY_HEADER_EXPOSE);
  return response;
};

const handleOptions = (req, requestId) => {
  if (req.method === 'OPTIONS') {
    const response = new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
        'Access-Control-Expose-Headers': PROXY_HEADER_EXPOSE,
      },
    });
    response.headers.set('x-request-id', requestId);
    return response;
  }
  return null;
};

const resolveEndpointPath = (requestUrl) => {
  const url = new URL(requestUrl);
  let endpointPath = url.pathname;
  if (endpointPath.startsWith('/api/tmdb')) {
    endpointPath = endpointPath.substring('/api/tmdb'.length);
  }
  return endpointPath || '/';
};

export async function onRequest(context) {
  const { request, env } = context;
  const requestId = createRequestId();
  const startedAt = Date.now();
  const optionsResponse = handleOptions(request, requestId);
  if (optionsResponse) return optionsResponse;

  try {
    const tmdbApiKey = env.TMDB_API_KEY;
    if (!tmdbApiKey) {
      throw new Error('A chave da API do TMDb não está configurada no ambiente da Cloudflare.');
    }

    const url = new URL(request.url);
    const endpointPath = resolveEndpointPath(request.url);

    const tmdbUrl = new URL(`${TMDB_BASE_URL}${endpointPath.startsWith('/') ? endpointPath : `/${endpointPath}`}`);
    url.searchParams.forEach((value, key) => {
      tmdbUrl.searchParams.set(key, value);
    });
    tmdbUrl.searchParams.set('api_key', tmdbApiKey);
    if (!tmdbUrl.searchParams.has('language')) {
      tmdbUrl.searchParams.set('language', 'pt-PT');
    }

    console.log('[tmdb function] Proxy request', {
      requestId,
      method: request.method,
      endpoint: endpointPath,
      target: maskApiKey(tmdbUrl.toString()),
    });

    const apiResponse = await fetch(tmdbUrl.toString());
    const durationMs = Date.now() - startedAt;
    if (!apiResponse.ok) {
      console.error('[tmdb function] Upstream error', {
        requestId,
        endpoint: endpointPath,
        status: apiResponse.status,
        durationMs,
      });
    }

    const response = new Response(apiResponse.body, apiResponse);
    response.headers.delete('Content-Encoding');
    response.headers.delete('Content-Length');
    response.headers.delete('content-encoding');
    response.headers.delete('content-length');

    response.headers.set('Cache-Control', 'public, max-age=3600');
    response.headers.set('Access-Control-Allow-Origin', '*');
    addProxyHeaders(response, {
      requestId,
      upstreamStatus: apiResponse.status,
      durationMs,
    });

    return response;
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const message = getErrorMessage(error);
    console.error('[tmdb function] Unexpected error', {
      requestId,
      method: request.method,
      durationMs,
      error: message,
    });

    const response = new Response(
      JSON.stringify({ error: 'Falha ao processar o pedido na função tmdb', details: message }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Expose-Headers': PROXY_HEADER_EXPOSE,
        },
      }
    );

    addProxyHeaders(response, {
      requestId,
      upstreamStatus: 500,
      durationMs,
    });

    return response;
  }
}
