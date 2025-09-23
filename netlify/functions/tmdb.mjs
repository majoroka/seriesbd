const TMDB_API_KEY = process.env.TMDB_API_KEY;
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

export default async (req) => {
  // Extrai o caminho do URL de uma forma que funciona tanto em produção como em desenvolvimento local.
  // Remove o prefixo da API e da função para obter o caminho real do endpoint.
  const path = req.path.replace(/^\/api\/tmdb/, '').replace(/^\/tmdb/, '');
  
  // Adiciona a API key e o idioma aos parâmetros de busca
  const searchParams = new URL(req.url).searchParams;
  searchParams.set('api_key', TMDB_API_KEY);
  searchParams.set('language', 'pt-PT');

  const tmdbUrl = `${TMDB_BASE_URL}${path}?${searchParams.toString()}`;

  try {
    const response = await fetch(tmdbUrl);

    if (!response.ok) {
      // Tenta passar a mensagem de erro da API original
      const errorBody = await response.text();
      return {
        statusCode: response.status,
        body: errorBody || response.statusText,
      };
    }

    const data = await response.json();
    return {
      statusCode: 200,
      body: JSON.stringify(data),
      headers: {
        'Content-Type': 'application/json',
        // Adiciona um cabeçalho de cache para as respostas da API
        'Cache-Control': 'public, max-age=3600', // Cache de 1 hora
      },
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to fetch data from TMDb' }),
    };
  }
};
