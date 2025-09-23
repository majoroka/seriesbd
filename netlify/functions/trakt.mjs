// Conteúdo para netlify/functions/trakt.mjs
const TRAKT_API_KEY = process.env.TRAKT_API_KEY;
const TRAKT_BASE_URL = 'https://api.trakt.tv';
const TRAKT_API_VERSION = '2';

export default async (req) => {
  // Extrai o caminho do URL de uma forma que funciona tanto em produção como em desenvolvimento local.
  // O `req.path` da Netlify contém o caminho original do pedido (ex: /api/trakt/search/tmdb/123).
  const path = req.path.replace(/^\/api\/trakt/, '');

  const searchParams = new URL(req.url).searchParams;

  const traktUrl = `${TRAKT_BASE_URL}${path}?${searchParams.toString()}`;

  try {
    const response = await fetch(traktUrl, {
      headers: {
        'Content-Type': 'application/json',
        'trakt-api-version': TRAKT_API_VERSION,
        'trakt-api-key': TRAKT_API_KEY,
      },
    });

    if (!response.ok) {
      return {
        statusCode: response.status,
        body: response.statusText,
      };
    }

    const data = await response.json();
    return {
      statusCode: 200,
      body: JSON.stringify(data),
      headers: {
        'Content-Type': 'application/json',
      },
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to fetch data from Trakt' }),
    };
  }
};
