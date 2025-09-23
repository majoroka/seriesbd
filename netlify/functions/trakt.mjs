const TRAKT_API_KEY = process.env.TRAKT_API_KEY;
const TRAKT_BASE_URL = 'https://api.trakt.tv';
const TRAKT_API_VERSION = '2';

// Handler for OPTIONS requests (CORS preflight)
const handleOptions = (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204, // No Content
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, trakt-api-version, trakt-api-key',
        'Access-Control-Max-Age': '86400', // 24 hours
      },
    });
  }
};

export default async (req) => {
  const optionsResponse = handleOptions(req);
  if (optionsResponse) return optionsResponse;

  try {
    if (!TRAKT_API_KEY) {
      throw new Error('A chave da API do Trakt não está configurada no ambiente da Netlify.');
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
    
    const response = new Response(apiResponse.body, apiResponse);

    // The browser will fail if we pass through the Content-Encoding header
    // from the origin API, since the body has already been decompressed by fetch().
    response.headers.delete('Content-Encoding');
    response.headers.delete('Content-Length');

    response.headers.set('Access-Control-Allow-Origin', '*');

    return response;

  } catch (error) {
    console.error('[trakt function] Erro inesperado:', error);
    return new Response(
      JSON.stringify({ error: 'Falha ao processar o pedido na função trakt', details: error.message }),
      { 
        status: 500,
        headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
        },
      }
    );
  }
};
