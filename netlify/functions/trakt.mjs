const TRAKT_API_KEY = process.env.TRAKT_API_KEY;
const TRAKT_BASE_URL = 'https://api.trakt.tv';
const TRAKT_API_VERSION = '2';
const TRAKT_USER_AGENT = process.env.TRAKT_USER_AGENT || 'seriesBD/1.0 (+https://seriesbd.netlify.app)';

/**
 * Adiciona os cabeçalhos CORS a uma resposta.
 * @param {Response} response A resposta à qual adicionar os cabeçalhos.
 */
const addCorsHeaders = (response) => {
  response.headers.set('Access-Control-Allow-Origin', '*');
  response.headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, trakt-api-version, trakt-api-key');
  response.headers.set('Access-Control-Max-Age', '86400'); // 24 horas
  return response;
};

/**
 * Clona e sanitiza headers vindos da origem para evitar inconsistências no browser.
 * @param {HeadersInit} sourceHeaders
 * @returns {Headers}
 */
const sanitizeOriginHeaders = (sourceHeaders) => {
  const headers = new Headers(sourceHeaders);
  headers.delete('content-encoding');
  headers.delete('content-length');
  return headers;
};

export default async (req) => {
  // Handler para OPTIONS requests (CORS preflight)
  if (req.method === 'OPTIONS') {
    return addCorsHeaders(new Response(null, { status: 204 })); // No Content
  }

  try {
    if (!TRAKT_API_KEY) {
      throw new Error('A chave da API do Trakt não está configurada.');
    }

    const url = new URL(req.url);
    let endpointPath = url.pathname;

    const functionPrefix = '/.netlify/functions/trakt';
    if (endpointPath.startsWith(functionPrefix)) {
      endpointPath = endpointPath.substring(functionPrefix.length);
    } else if (endpointPath.startsWith('/api/trakt')) {
      endpointPath = endpointPath.substring('/api/trakt'.length);
    }

    const searchParams = url.searchParams;
    const traktUrl = `${TRAKT_BASE_URL}${endpointPath}?${searchParams.toString()}`;

    console.log(`[trakt function] Proxying request to: ${traktUrl}`);

    const apiResponse = await fetch(traktUrl, {
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'trakt-api-version': TRAKT_API_VERSION,
        'trakt-api-key': TRAKT_API_KEY,
        'User-Agent': TRAKT_USER_AGENT,
      },
    });

    const contentType = apiResponse.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
      const htmlBody = await apiResponse.text();
      const cloudflareBlocked = /cloudflare|you have been blocked|attention required/i.test(htmlBody);
      if (cloudflareBlocked) {
        console.error('[trakt function] Cloudflare block detected while calling Trakt.', {
          status: apiResponse.status,
          url: traktUrl,
        });
        const blockedResponse = new Response(
          JSON.stringify({
            error: 'Trakt blocked by Cloudflare',
            details: 'A chamada à Trakt foi bloqueada pelo Cloudflare.',
          }),
          { status: 502, headers: { 'Content-Type': 'application/json' } }
        );
        return addCorsHeaders(blockedResponse);
      }
      const unexpectedHtmlResponse = new Response(
        JSON.stringify({
          error: 'Unexpected HTML response from Trakt',
          details: 'A Trakt respondeu com HTML em vez de JSON.',
        }),
        { status: 502, headers: { 'Content-Type': 'application/json' } }
      );
      return addCorsHeaders(unexpectedHtmlResponse);
    }

    // Se a resposta da API do Trakt não for bem-sucedida, propaga o erro.
    if (!apiResponse.ok) {
      const errorBody = await apiResponse.text();
      console.error(`[trakt function] Erro da API do Trakt: ${apiResponse.status}`, errorBody);
      const errorResponse = new Response(errorBody, {
        status: apiResponse.status,
        statusText: apiResponse.statusText,
        headers: sanitizeOriginHeaders(apiResponse.headers),
      });
      return addCorsHeaders(errorResponse);
    }

    // Cria uma nova resposta para evitar problemas com headers imutáveis.
    const response = new Response(apiResponse.body, {
      status: apiResponse.status,
      statusText: apiResponse.statusText,
      headers: sanitizeOriginHeaders(apiResponse.headers),
    });

    return addCorsHeaders(response);
  } catch (error) {
    console.error('[trakt function] Erro inesperado:', error);
    const errorResponse = new Response(JSON.stringify({ error: 'Falha ao processar o pedido na função trakt', details: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    return addCorsHeaders(errorResponse);
  }
};
