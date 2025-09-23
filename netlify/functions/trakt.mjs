// Conteúdo para netlify/functions/trakt.mjs
const TRAKT_API_KEY = process.env.TRAKT_API_KEY;
const TRAKT_BASE_URL = 'https://api.trakt.tv';
const TRAKT_API_VERSION = '2';

export default async (req) => {
  // Extrai o caminho do URL de uma forma que funciona tanto em produção como em desenvolvimento local.
  // Extrai a parte relevante do caminho da API, que funciona tanto localmente como em produção.
  const path = req.path.split('/trakt')[1] || '';

  // Usa req.rawUrl para analisar corretamente os parâmetros de pesquisa no ambiente Netlify.
  const searchParams = new URL(req.rawUrl).searchParams;

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
      // Tenta encaminhar a mensagem de erro da API original.
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
      },
    };
  } catch (error) {
    // Regista o erro real para depuração nos logs da função Netlify.
    console.error('Erro na função trakt:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Falha ao buscar dados do Trakt', details: error.message }),
    };
  }
};
