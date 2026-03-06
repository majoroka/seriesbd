const TVMAZE_BASE_URL = 'https://api.tvmaze.com';
const PROXY_HEADER_EXPOSE = 'x-request-id, x-upstream-status, x-upstream-latency-ms';

const createRequestId = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `tvmaze_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
};

const getErrorMessage = (error) => (error instanceof Error ? error.message : String(error));

const addProxyHeaders = (response, { requestId, upstreamStatus, durationMs }) => {
  response.headers.set('x-request-id', requestId);
  response.headers.set('x-upstream-status', String(upstreamStatus));
  response.headers.set('x-upstream-latency-ms', String(durationMs));
  response.headers.set('Access-Control-Expose-Headers', PROXY_HEADER_EXPOSE);
  return response;
};

const addCorsHeaders = (response) => {
  response.headers.set('Access-Control-Allow-Origin', '*');
  response.headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, x-api-key, authorization');
  response.headers.set('Access-Control-Max-Age', '86400');
  response.headers.set('Access-Control-Expose-Headers', PROXY_HEADER_EXPOSE);
  return response;
};

const sanitizeOriginHeaders = (sourceHeaders) => {
  const headers = new Headers(sourceHeaders);
  headers.delete('content-encoding');
  headers.delete('content-length');
  headers.delete('Content-Encoding');
  headers.delete('Content-Length');
  return headers;
};

const stripHtml = (value) => {
  if (!value) return '';
  return String(value).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
};

const normalizeString = (value) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

const buildTvMazeHeaders = (apiKey) => {
  const headers = {
    Accept: 'application/json',
    'User-Agent': 'seriesBD/1.0 (+https://seriesbd.pages.dev)',
  };
  if (apiKey) headers['x-api-key'] = apiKey;
  return headers;
};

const buildTvMazeUrl = (endpointPath, sourceSearchParams, apiKey) => {
  const path = endpointPath.startsWith('/') ? endpointPath : `/${endpointPath}`;
  const url = new URL(`${TVMAZE_BASE_URL}${path}`);
  sourceSearchParams.forEach((value, key) => {
    url.searchParams.set(key, value);
  });

  if (apiKey && !url.searchParams.has('api_key')) {
    url.searchParams.set('api_key', apiKey);
  }

  return url.toString();
};

const parseEndpointPath = (rawPathname) => {
  let endpointPath = rawPathname;
  if (endpointPath.startsWith('/api/tvmaze')) {
    endpointPath = endpointPath.substring('/api/tvmaze'.length);
  }
  return endpointPath || '/';
};

const fetchTvMaze = async (endpointPath, params, apiKey) => {
  const url = buildTvMazeUrl(endpointPath, params, apiKey);
  const response = await fetch(url, { headers: buildTvMazeHeaders(apiKey) });
  return { url, response };
};

const scoreSearchResult = (item, query, expectedYear) => {
  const show = item?.show;
  if (!show) return -1;

  const normalizedQuery = normalizeString(query);
  const normalizedName = normalizeString(show.name);

  let score = Number(item?.score || 0);
  if (normalizedQuery && normalizedName === normalizedQuery) score += 0.5;
  else if (normalizedQuery && normalizedName.includes(normalizedQuery)) score += 0.2;

  if (typeof expectedYear === 'number' && Number.isFinite(expectedYear)) {
    const premieredYear = Number(String(show.premiered || '').slice(0, 4));
    if (!Number.isNaN(premieredYear)) {
      if (premieredYear === expectedYear) score += 0.4;
      else if (Math.abs(premieredYear - expectedYear) <= 1) score += 0.2;
    }
  }

  return score;
};

const normalizeShowPayload = (show) => {
  if (!show) return null;
  return {
    id: show.id,
    name: show.name || null,
    language: show.language || null,
    premiered: show.premiered || null,
    status: show.status || null,
    type: show.type || null,
    genres: Array.isArray(show.genres) ? show.genres : [],
    url: show.url || null,
    officialSite: show.officialSite || null,
    rating: {
      average: typeof show?.rating?.average === 'number' ? show.rating.average : null,
    },
    image: show.image || null,
    externals: show.externals || null,
    summaryHtml: show.summary || null,
    summaryText: stripHtml(show.summary),
    network: show.network || null,
    webChannel: show.webChannel || null,
  };
};

const resolveShow = async (searchParams, requestId, apiKey) => {
  const imdbId = searchParams.get('imdb') || '';
  const query = searchParams.get('query') || searchParams.get('name') || '';
  const yearRaw = searchParams.get('year');
  const expectedYear = yearRaw ? Number(yearRaw) : undefined;

  if (!imdbId && !query) {
    return new Response(
      JSON.stringify({ error: 'Missing parameters', details: 'Use imdb ou query/name.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (imdbId) {
    const lookupParams = new URLSearchParams();
    lookupParams.set('imdb', imdbId);
    const { response } = await fetchTvMaze('/lookup/shows', lookupParams, apiKey);
    if (response.ok) {
      const show = await response.json();
      return new Response(
        JSON.stringify({
          source: 'tvmaze',
          match: { method: 'imdb', score: 1 },
          show: normalizeShowPayload(show),
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (response.status !== 404) {
      const errorBody = await response.text();
      console.warn('[tvmaze function] lookup by imdb failed with non-404', {
        requestId,
        imdbId,
        status: response.status,
        bodyPreview: errorBody.slice(0, 200),
      });
    }
  }

  if (query) {
    const searchRequestParams = new URLSearchParams();
    searchRequestParams.set('q', query);
    const { response } = await fetchTvMaze('/search/shows', searchRequestParams, apiKey);

    if (!response.ok) {
      const errorBody = await response.text();
      return new Response(
        JSON.stringify({
          error: 'TVMaze search failed',
          details: errorBody || `status ${response.status}`,
        }),
        { status: response.status, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const results = await response.json();
    if (!Array.isArray(results) || results.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Show not found', details: 'No matches from TVMaze search.' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const ranked = results
      .map((item) => ({ item, score: scoreSearchResult(item, query, expectedYear) }))
      .filter((entry) => entry.score >= 0)
      .sort((a, b) => b.score - a.score);

    const best = ranked[0];
    if (!best || best.score < 0.35) {
      return new Response(
        JSON.stringify({
          error: 'Match too weak',
          details: 'TVMaze returned results, but match confidence is below threshold.',
          topScore: best?.score ?? null,
        }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const chosenShow = best.item?.show;
    return new Response(
      JSON.stringify({
        source: 'tvmaze',
        match: {
          method: 'search',
          score: Number(best.score.toFixed(3)),
          year: expectedYear || null,
          candidates: ranked.length,
        },
        show: normalizeShowPayload(chosenShow),
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  return new Response(
    JSON.stringify({ error: 'Show not found', details: 'No valid lookup strategy available.' }),
    { status: 404, headers: { 'Content-Type': 'application/json' } }
  );
};

export async function onRequest(context) {
  const { request, env } = context;
  const requestId = createRequestId();
  const startedAt = Date.now();

  if (request.method === 'OPTIONS') {
    const optionsResponse = addCorsHeaders(new Response(null, { status: 204 }));
    optionsResponse.headers.set('x-request-id', requestId);
    return optionsResponse;
  }

  try {
    const apiKey = env.TVMAZE_API_KEY;
    const url = new URL(request.url);
    const endpointPath = parseEndpointPath(url.pathname);

    console.log('[tvmaze function] Proxy request', {
      requestId,
      method: request.method,
      endpoint: endpointPath,
      hasApiKey: Boolean(apiKey),
    });

    if (endpointPath === '/resolve/show') {
      const resolveResponse = await resolveShow(url.searchParams, requestId, apiKey);
      const durationMs = Date.now() - startedAt;
      addProxyHeaders(resolveResponse, {
        requestId,
        upstreamStatus: resolveResponse.status,
        durationMs,
      });
      return addCorsHeaders(resolveResponse);
    }

    const { url: tvmazeUrl, response: apiResponse } = await fetchTvMaze(endpointPath, url.searchParams, apiKey);
    const durationMs = Date.now() - startedAt;
    if (!apiResponse.ok) {
      const bodyPreview = (await apiResponse.text()).slice(0, 300);
      console.error('[tvmaze function] Upstream error', {
        requestId,
        endpoint: endpointPath,
        target: tvmazeUrl,
        status: apiResponse.status,
        durationMs,
        bodyPreview,
      });
      const errorResponse = new Response(
        JSON.stringify({
          error: 'TVMaze upstream error',
          details: bodyPreview || `status ${apiResponse.status}`,
        }),
        {
          status: apiResponse.status,
          statusText: apiResponse.statusText,
          headers: { 'Content-Type': 'application/json' },
        }
      );
      addProxyHeaders(errorResponse, {
        requestId,
        upstreamStatus: apiResponse.status,
        durationMs,
      });
      return addCorsHeaders(errorResponse);
    }

    const response = new Response(apiResponse.body, {
      status: apiResponse.status,
      statusText: apiResponse.statusText,
      headers: sanitizeOriginHeaders(apiResponse.headers),
    });
    addProxyHeaders(response, {
      requestId,
      upstreamStatus: apiResponse.status,
      durationMs,
    });

    return addCorsHeaders(response);
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const message = getErrorMessage(error);
    console.error('[tvmaze function] Unexpected error', {
      requestId,
      method: request.method,
      durationMs,
      error: message,
    });

    const errorResponse = new Response(
      JSON.stringify({ error: 'Falha ao processar o pedido na função tvmaze', details: message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
    addProxyHeaders(errorResponse, {
      requestId,
      upstreamStatus: 500,
      durationMs,
    });

    return addCorsHeaders(errorResponse);
  }
}
