const TMDB_API_KEY = process.env.TMDB_API_KEY;
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

// Handler for OPTIONS requests (CORS preflight)
const handleOptions = (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204, // No Content
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400', // 24 hours
      },
    });
  }
};

export default async (req) => {
  const optionsResponse = handleOptions(req);
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
    
    console.log(`[tmdb function] Proxying request to: ${tmdbUrl}`);

    const apiResponse = await fetch(tmdbUrl);

    // Clone the response to make headers mutable.
    const response = new Response(apiResponse.body, apiResponse);

    // The browser will fail if we pass through the Content-Encoding header
    // from the origin API, since the body has already been decompressed by fetch().
    response.headers.delete('Content-Encoding');
    response.headers.delete('Content-Length');

    // Set our own headers for caching and CORS.
    response.headers.set('Cache-Control', 'public, max-age=3600');
    response.headers.set('Access-Control-Allow-Origin', '*');

    return response;

  } catch (error) {
    console.error('[tmdb function] Erro inesperado:', error);
    return new Response(
      JSON.stringify({ error: 'Falha ao processar o pedido na função tmdb', details: error.message }),
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
