// Ficheiro: api/trakt/[...path].ts

export const config = {
  runtime: 'edge',
};

export default async function handler(request: Request) {
  const requestUrl = new URL(request.url);
  const path = requestUrl.pathname.replace('/api/trakt', '');
  const traktApiKey = process.env.VITE_TRAKT_API_KEY;

  if (!traktApiKey) {
    return new Response('Trakt API key is not configured.', { status: 500 });
  }

  const targetUrl = `https://api.trakt.tv${path}${requestUrl.search}`;

  // Cria novos cabeçalhos para adicionar as chaves da API da Trakt
  const headers = new Headers(request.headers);
  headers.set('trakt-api-version', '2');
  headers.set('trakt-api-key', traktApiKey);

  // Faz o pedido para a API da Trakt com os novos cabeçalhos
  return fetch(targetUrl, {
    method: request.method,
    headers: headers,
    body: request.body,
  });
}
