// Conteúdo para netlify/functions/trakt.mjs
const TRAKT_API_KEY = process.env.TRAKT_API_KEY;
const TRAKT_BASE_URL = 'https://api.trakt.tv';
const TRAKT_API_VERSION = '2';

export default async (req) => {
  try {
    const url = new URL(req.url);
    
    let endpointPath = url.pathname;
    if (endpointPath.startsWith('/api/trakt')) {
      endpointPath = endpointPath.substring('/api/trakt'.length);
    } else if (endpointPath.includes('/.netlify/functions/trakt')) {
      endpointPath = endpointPath.substring(endpointPath.indexOf('/.netlify/functions/trakt') + '/.netlify/functions/trakt'.length);
    }
    
    if (!TRAKT_API_KEY) {
      throw new Error('A chave da API do Trakt não está configurada.');
    }
    
    const searchParams = url.searchParams;
    const traktUrl = `${TRAKT_BASE_URL}${endpointPath}?${searchParams.toString()}`;
    
    const apiResponse = await fetch(traktUrl, {
      headers: {
        'Content-Type': 'application/json',
        'trakt-api-version': TRAKT_API_VERSION,
        'trakt-api-key': TRAKT_API_KEY,
      },
    });
    
    // Simplesmente encaminha a resposta da API do Trakt.
    return new Response(apiResponse.body, apiResponse);
    
  } catch (error) {
    // Regista o erro nos logs da função na Netlify para depuração.
    console.error('Erro na função trakt:', error);
    return new Response(
      JSON.stringify({ error: 'Falha ao buscar dados do Trakt', details: error.message }),
      { 
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
