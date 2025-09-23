const TMDB_API_KEY = process.env.TMDB_API_KEY;
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

export default async (req) => {
  try {
    // No Netlify, `req` é um objeto Request padrão. `req.url` contém o URL completo.
    const url = new URL(req.url);
    
    // Extrai o caminho do endpoint da API de forma robusta para produção e desenvolvimento local.
    let endpointPath = url.pathname;
    if (endpointPath.startsWith('/api/tmdb')) {
      // Ex: /api/tmdb/search/tv -> /search/tv
      endpointPath = endpointPath.substring('/api/tmdb'.length);
    } else if (endpointPath.includes('/.netlify/functions/tmdb')) {
      // Ex: /.netlify/functions/tmdb/search/tv -> /search/tv (devido ao proxy do Vite)
      endpointPath = endpointPath.substring(endpointPath.indexOf('/.netlify/functions/tmdb') + '/.netlify/functions/tmdb'.length);
    }

    // Verifica se a chave da API está configurada no ambiente da Netlify.
    if (!TMDB_API_KEY) {
      throw new Error('A chave da API do TMDb não está configurada.');
    }

    const searchParams = url.searchParams;
    searchParams.set('api_key', TMDB_API_KEY);
    searchParams.set('language', 'pt-PT');

    const tmdbUrl = `${TMDB_BASE_URL}${endpointPath}?${searchParams.toString()}`;

    const apiResponse = await fetch(tmdbUrl);

    // Clona a resposta para poder modificar os cabeçalhos (adicionar cache).
    const response = new Response(apiResponse.body, apiResponse);
    response.headers.set('Cache-Control', 'public, max-age=3600'); // Cache de 1 hora

    return response;

  } catch (error) {
    // Regista o erro nos logs da função na Netlify para depuração.
    console.error('Erro na função tmdb:', error);
    return new Response(
      JSON.stringify({ error: 'Falha ao buscar dados do TMDb', details: error.message }),
      { 
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
