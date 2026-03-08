const GOOGLE_BOOKS_BASE_URL = 'https://www.googleapis.com/books/v1';
const OPEN_LIBRARY_BASE_URL = 'https://openlibrary.org';
const OPEN_LIBRARY_COVERS_BASE_URL = 'https://covers.openlibrary.org/b/id';
const PROXY_HEADER_EXPOSE = 'x-request-id, x-upstream-status, x-upstream-latency-ms';
const BOOK_ID_OFFSET = 2_000_000_000;
const BOOK_ID_RANGE = 1_000_000_000;

const createRequestId = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `books_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
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
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type');
  response.headers.set('Access-Control-Max-Age', '86400');
  response.headers.set('Access-Control-Expose-Headers', PROXY_HEADER_EXPOSE);
  return response;
};

const hashStringToPositiveInt = (value) => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const toScopedBookId = (sourceId) => BOOK_ID_OFFSET + (hashStringToPositiveInt(String(sourceId || 'unknown')) % BOOK_ID_RANGE);

const normalizePath = (requestUrl) => {
  const url = new URL(requestUrl);
  let endpointPath = url.pathname;
  if (endpointPath.startsWith('/api/books')) {
    endpointPath = endpointPath.substring('/api/books'.length);
  }
  return endpointPath || '/';
};

const toGenreList = (input) => {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 3).map((name, index) => ({ id: index + 1, name: String(name) }));
};

const toGoogleCover = (imageLinks) => {
  const raw = imageLinks?.thumbnail || imageLinks?.smallThumbnail || null;
  if (!raw) return null;
  return String(raw).replace(/^http:\/\//i, 'https://');
};

const mapGoogleBook = (item) => {
  const info = item?.volumeInfo || {};
  const sourceId = String(item?.id || info?.canonicalVolumeLink || info?.title || Math.random());
  const description = typeof info.description === 'string' ? info.description : '';
  const publishedDate = typeof info.publishedDate === 'string' ? info.publishedDate : '';
  const rating = typeof info.averageRating === 'number' ? Number((info.averageRating * 2).toFixed(1)) : undefined;

  return {
    id: toScopedBookId(`google:${sourceId}`),
    media_type: 'book',
    source_provider: 'google_books',
    source_id: sourceId,
    name: String(info.title || 'Livro sem titulo'),
    original_name: String(info.subtitle || info.title || ''),
    overview: description,
    poster_path: toGoogleCover(info.imageLinks),
    backdrop_path: null,
    first_air_date: publishedDate,
    genres: toGenreList(info.categories),
    vote_average: rating,
  };
};

const mapOpenLibraryBook = (doc) => {
  const sourceId = String(doc?.key || doc?.cover_edition_key || doc?.edition_key?.[0] || doc?.title || Math.random());
  const firstSentence = Array.isArray(doc?.first_sentence) ? doc.first_sentence[0] : doc?.first_sentence;
  const overview = typeof firstSentence === 'string' ? firstSentence : '';
  const firstPublishYear = Number(doc?.first_publish_year);
  const firstAirDate = Number.isNaN(firstPublishYear) ? '' : `${firstPublishYear}-01-01`;

  return {
    id: toScopedBookId(`openlibrary:${sourceId}`),
    media_type: 'book',
    source_provider: 'open_library',
    source_id: sourceId,
    name: String(doc?.title || 'Livro sem titulo'),
    original_name: String(doc?.subtitle || doc?.title || ''),
    overview,
    poster_path: doc?.cover_i ? `${OPEN_LIBRARY_COVERS_BASE_URL}/${doc.cover_i}-L.jpg` : null,
    backdrop_path: null,
    first_air_date: firstAirDate,
    genres: toGenreList(doc?.subject),
  };
};

const searchGoogleBooks = async (query, apiKey) => {
  const url = new URL(`${GOOGLE_BOOKS_BASE_URL}/volumes`);
  url.searchParams.set('q', query);
  url.searchParams.set('maxResults', '20');
  url.searchParams.set('orderBy', 'relevance');
  url.searchParams.set('langRestrict', 'pt');
  if (apiKey) url.searchParams.set('key', apiKey);

  const response = await fetch(url.toString());
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { ok: false, status: response.status, results: [] };
  }

  const rawItems = Array.isArray(payload?.items) ? payload.items : [];
  return {
    ok: true,
    status: response.status,
    results: rawItems.map(mapGoogleBook),
  };
};

const searchOpenLibraryBooks = async (query) => {
  const url = new URL(`${OPEN_LIBRARY_BASE_URL}/search.json`);
  url.searchParams.set('q', query);
  url.searchParams.set('limit', '20');
  url.searchParams.set('language', 'por');

  const response = await fetch(url.toString());
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { ok: false, status: response.status, results: [] };
  }

  const docs = Array.isArray(payload?.docs) ? payload.docs : [];
  return {
    ok: true,
    status: response.status,
    results: docs.map(mapOpenLibraryBook),
  };
};

const fetchGoogleBookById = async (sourceId, apiKey) => {
  const normalizedSourceId = String(sourceId || '').trim();
  if (!normalizedSourceId) return { ok: false, status: 400, result: null };
  const url = new URL(`${GOOGLE_BOOKS_BASE_URL}/volumes/${encodeURIComponent(normalizedSourceId)}`);
  if (apiKey) url.searchParams.set('key', apiKey);

  const response = await fetch(url.toString());
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) return { ok: false, status: response.status, result: null };
  return { ok: true, status: response.status, result: mapGoogleBook(payload) };
};

const mapOpenLibraryWorkDetails = (payload, sourceId, fallbackTitle = '') => {
  const descriptionRaw = payload?.description;
  const description = typeof descriptionRaw === 'string'
    ? descriptionRaw
    : (typeof descriptionRaw?.value === 'string' ? descriptionRaw.value : '');
  const title = String(payload?.title || fallbackTitle || 'Livro sem titulo');
  const firstPublished = String(payload?.first_publish_date || '');
  const coverId = Array.isArray(payload?.covers) ? payload.covers[0] : null;

  return {
    id: toScopedBookId(`openlibrary:${sourceId}`),
    media_type: 'book',
    source_provider: 'open_library',
    source_id: sourceId,
    name: title,
    original_name: String(payload?.subtitle || title || ''),
    overview: description,
    poster_path: coverId ? `${OPEN_LIBRARY_COVERS_BASE_URL}/${coverId}-L.jpg` : null,
    backdrop_path: null,
    first_air_date: firstPublished,
    genres: [],
  };
};

const fetchOpenLibraryBookDetails = async (sourceId, fallbackTitle = '') => {
  const normalizedSourceId = String(sourceId || '').trim();
  if (!normalizedSourceId) return { ok: false, status: 400, result: null };
  let workPath = normalizedSourceId;
  if (!workPath.startsWith('/')) {
    workPath = workPath.startsWith('works/') ? `/${workPath}` : `/works/${workPath}`;
  }

  const url = new URL(`${OPEN_LIBRARY_BASE_URL}${workPath}.json`);
  const response = await fetch(url.toString());
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) return { ok: false, status: response.status, result: null };
  return {
    ok: true,
    status: response.status,
    result: mapOpenLibraryWorkDetails(payload, normalizedSourceId, fallbackTitle),
  };
};

export async function onRequest(context) {
  const { request, env } = context;
  const requestId = createRequestId();
  const startedAt = Date.now();

  if (request.method === 'OPTIONS') {
    const response = addCorsHeaders(new Response(null, { status: 204 }));
    response.headers.set('x-request-id', requestId);
    return response;
  }

  try {
    const url = new URL(request.url);
    const endpointPath = normalizePath(request.url);

    if (endpointPath !== '/search' && endpointPath !== '/details') {
      const notFound = addCorsHeaders(
        new Response(JSON.stringify({ error: 'Endpoint not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        })
      );
      return addProxyHeaders(notFound, {
        requestId,
        upstreamStatus: 404,
        durationMs: Date.now() - startedAt,
      });
    }

    const googleApiKey = env.GOOGLE_BOOKS_API_KEY;
    if (endpointPath === '/search') {
      const query = (url.searchParams.get('query') || url.searchParams.get('q') || '').trim();
      if (!query) {
        const badRequest = addCorsHeaders(
          new Response(JSON.stringify({ error: 'Missing query parameter' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          })
        );
        return addProxyHeaders(badRequest, {
          requestId,
          upstreamStatus: 400,
          durationMs: Date.now() - startedAt,
        });
      }

      const google = await searchGoogleBooks(query, googleApiKey);
      let provider = 'google_books';
      let upstreamStatus = google.status;
      let results = google.results;

      if (!google.ok || results.length === 0) {
        const openLibrary = await searchOpenLibraryBooks(query);
        provider = 'open_library';
        upstreamStatus = openLibrary.status;
        results = openLibrary.results;
      }

      const response = addCorsHeaders(
        new Response(
          JSON.stringify({
            ok: true,
            provider,
            query,
            results,
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              'Cache-Control': 'public, max-age=1800',
            },
          }
        )
      );

      return addProxyHeaders(response, {
        requestId,
        upstreamStatus,
        durationMs: Date.now() - startedAt,
      });
    }

    const sourceId = (url.searchParams.get('source_id') || url.searchParams.get('id') || '').trim();
    const providerParam = (url.searchParams.get('provider') || '').trim();
    const query = (url.searchParams.get('query') || url.searchParams.get('q') || '').trim();
    if (!sourceId && !query) {
      const badRequest = addCorsHeaders(
        new Response(JSON.stringify({ error: 'Missing source_id or query parameter' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      );
      return addProxyHeaders(badRequest, {
        requestId,
        upstreamStatus: 400,
        durationMs: Date.now() - startedAt,
      });
    }

    let provider = providerParam === 'open_library' ? 'open_library' : 'google_books';
    let upstreamStatus = 200;
    let result = null;

    if (provider === 'google_books' && sourceId) {
      const googleDetails = await fetchGoogleBookById(sourceId, googleApiKey);
      upstreamStatus = googleDetails.status;
      result = googleDetails.result;
      if (!googleDetails.ok || !result) {
        provider = 'open_library';
      }
    }

    if (provider === 'open_library' && sourceId) {
      const openLibraryDetails = await fetchOpenLibraryBookDetails(sourceId, query);
      upstreamStatus = openLibraryDetails.status;
      result = openLibraryDetails.result;
    }

    if (!result && query) {
      const searchFallback = await searchOpenLibraryBooks(query);
      upstreamStatus = searchFallback.status;
      result = searchFallback.results[0] || null;
      provider = 'open_library';
    }

    if (!result) {
      const notFound = addCorsHeaders(
        new Response(JSON.stringify({ error: 'Book details not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        })
      );
      return addProxyHeaders(notFound, {
        requestId,
        upstreamStatus: 404,
        durationMs: Date.now() - startedAt,
      });
    }

    const response = addCorsHeaders(
      new Response(
        JSON.stringify({
          ok: true,
          provider,
          source_id: sourceId || null,
          query: query || null,
          result,
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=1800',
          },
        }
      )
    );

    return addProxyHeaders(response, {
      requestId,
      upstreamStatus,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    const message = getErrorMessage(error);
    const response = addCorsHeaders(
      new Response(JSON.stringify({ error: 'Falha ao processar o pedido na função books', details: message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    return addProxyHeaders(response, {
      requestId,
      upstreamStatus: 500,
      durationMs: Date.now() - startedAt,
    });
  }
}
