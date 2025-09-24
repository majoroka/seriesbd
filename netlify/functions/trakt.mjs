const TRAKT_API_KEY = process.env.TRAKT_API_KEY;
const TRAKT_BASE_URL = 'https://api.trakt.tv';
const TRAKT_API_VERSION = '2';

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
        'Content-Type': 'application/json',
        'trakt-api-version': TRAKT_API_VERSION,
        'trakt-api-key': TRAKT_API_KEY,
      },
    });

    // Se a resposta da API do Trakt não for bem-sucedida, propaga o erro.
    if (!apiResponse.ok) {
      const errorBody = await apiResponse.text();
      console.error(`[trakt function] Erro da API do Trakt: ${apiResponse.status}`, errorBody);
      const errorResponse = new Response(errorBody, {
        status: apiResponse.status,
        statusText: apiResponse.statusText,
        headers: apiResponse.headers,
      });
      return addCorsHeaders(errorResponse);
    }

    // Cria uma nova resposta para evitar problemas com headers imutáveis.
    const response = new Response(apiResponse.body, {
      status: apiResponse.status,
      statusText: apiResponse.statusText,
      headers: apiResponse.headers,
    });

    // O browser falhará se passarmos o header Content-Encoding da API de origem,
    // uma vez que o corpo já foi descomprimido pelo fetch().
    response.headers.delete('content-encoding');
    response.headers.delete('content-length');

    return addCorsHeaders(response);
  } catch (error) {
    console.error('[trakt function] Erro inesperado:', error);
    const errorResponse = new Response(JSON.stringify({ error: 'Falha ao processar o pedido na função trakt', details: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    return addCorsHeaders(errorResponse);
  }
};
