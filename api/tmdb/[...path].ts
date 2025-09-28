// @ts-ignore

// Ficheiro: api/tmdb/[...path].ts

export const config = {
  runtime: 'edge',
};

export default async function handler(request: Request) {
  const requestUrl = new URL(request.url);
  const path = requestUrl.pathname.replace('/api/tmdb', '');
  const tmdbApiKey = process.env.VITE_TMDB_API_KEY;

  if (!tmdbApiKey) {
    return new Response('TMDB API key is not configured.', { status: 500 });
  }

  // Constrói a URL final para a API da TMDb
  const targetUrl = `https://api.themoviedb.org/3${path}${requestUrl.search ? `${requestUrl.search}&` : '?'}api_key=${tmdbApiKey}`;

  // Faz o pedido para a API da TMDb e retorna a sua resposta
  return fetch(targetUrl, {
    method: request.method,
    headers: request.headers,
    body: request.body,
  });
}
