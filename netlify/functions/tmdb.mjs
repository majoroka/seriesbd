const TMDB_API_KEY = process.env.TMDB_API_KEY;
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

// Handler for OPTIONS requests (CORS preflight)
const handleOptions = (req, requestId) => {
  if (req.method === 'OPTIONS') {
    const response = new Response(null, {
      status: 204, // No Content
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400', // 24 hours
        'Access-Control-Expose-Headers': PROXY_HEADER_EXPOSE,
      },
    });
    response.headers.set('x-request-id', requestId);
    return response;
  }
};

export default async (req) => {
  const requestId = createRequestId();
  const startedAt = Date.now();
  const optionsResponse = handleOptions(req, requestId);
  if (optionsResponse) return optionsResponse;

  try {
    if (!TMDB_API_KEY) {
      throw new Error('A chave da API do TMDb não está configurada no ambiente da Netlify.');
    }

    const url = new URL(req.url);
    let endpointPath = url.pathname;

    // This logic handles both production and local dev with `netlify dev`
    const functionPrefix = '/.netlify/functions/tmdb';
    if (endpointPath.startsWith(functionPrefix)) {
      endpointPath = endpointPath.substring(functionPrefix.length);
    } else if (endpointPath.startsWith('/api/tmdb')) {
      // This is a fallback for local dev if the rewrite isn't happening as expected
      endpointPath = endpointPath.substring('/api/tmdb'.length);
    }

    const searchParams = url.searchParams;
    searchParams.set('api_key', TMDB_API_KEY);
    // Mantém pt-PT por defeito, mas respeita idioma explícito (ex.: fallback de trailers en-US).
    if (!searchParams.has('language')) {
      searchParams.set('language', 'pt-PT');
    }

    const tmdbUrl = `${TMDB_BASE_URL}${endpointPath}?${searchParams.toString()}`;

    console.log('[tmdb function] Proxy request', {
      requestId,
      method: req.method,
      endpoint: endpointPath,
      target: maskApiKey(tmdbUrl),
    });

    const apiResponse = await fetch(tmdbUrl);
    const durationMs = Date.now() - startedAt;
    if (!apiResponse.ok) {
      console.error('[tmdb function] Upstream error', {
        requestId,
        endpoint: endpointPath,
        status: apiResponse.status,
        durationMs,
      });
    }

    // Clone the response to make headers mutable.
    const response = new Response(apiResponse.body, apiResponse);

    // The browser will fail if we pass through the Content-Encoding header
    // from the origin API, since the body has already been decompressed by fetch().
    response.headers.delete('Content-Encoding');
    response.headers.delete('Content-Length');

    // Set our own headers for caching and CORS.
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
      method: req.method,
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
};
