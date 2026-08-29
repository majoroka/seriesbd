const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const GOOGLE_BOOKS_BASE_URL = 'https://www.googleapis.com/books/v1/volumes';
const OPEN_LIBRARY_BASE_URL = 'https://openlibrary.org';
const SUPPORTED_BOOK_PROVIDERS = new Set(['google_books', 'open_library', 'goodreads']);
const MAX_TEXT_LENGTH = 280;

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function cleanText(value, maxLength = MAX_TEXT_LENGTH) {
  const raw = typeof value === 'object' && value !== null && 'value' in value ? value.value : value;
  const normalized = String(raw || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return '';
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1).trimEnd()}…` : normalized;
}

function parsePositiveId(value) {
  if (!/^\d+$/.test(String(value || ''))) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function decodeSegment(value) {
  try {
    const decoded = decodeURIComponent(String(value || '')).trim();
    return decoded && !/[\u0000-\u001f]/.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

function parseShareRoute(pathname) {
  const segments = String(pathname || '').split('/').filter(Boolean);
  if (segments[0] !== 'partilhar') return null;

  if ((segments[1] === 'serie' || segments[1] === 'filme') && segments.length === 3) {
    const tmdbId = parsePositiveId(segments[2]);
    if (!tmdbId) return null;
    return { type: segments[1] === 'serie' ? 'series' : 'movie', tmdbId };
  }

  if (segments[1] !== 'livro' || segments.length !== 4) return null;
  const provider = decodeSegment(segments[2]);
  const sourceId = decodeSegment(segments[3]);
  if (!provider || !SUPPORTED_BOOK_PROVIDERS.has(provider) || !sourceId || sourceId.length > 500) return null;
  return { type: 'book', provider, sourceId };
}

function getDefaultMetadata(route, origin) {
  const typeLabel = route?.type === 'series' ? 'Série' : route?.type === 'movie' ? 'Filme' : route?.type === 'book' ? 'Livro' : 'Conteúdo';
  return {
    title: `${typeLabel} partilhado | MediaDex`,
    description: `Descobre este ${typeLabel.toLowerCase()} no MediaDex.`,
    image: new URL('/android-chrome-512x512.png', origin).toString(),
  };
}

function normalizeImageUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw.replace(/^http:\/\//i, 'https://'));
    return parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function fromTmdb(data, type) {
  const name = cleanText(type === 'series' ? data?.name : data?.title, 120);
  if (!name) return null;
  return {
    title: `${name} | MediaDex`,
    description: cleanText(data?.overview) || `Descobre ${type === 'series' ? 'a série' : 'o filme'} ${name} no MediaDex.`,
    image: data?.poster_path ? `https://image.tmdb.org/t/p/w780${data.poster_path}` : null,
  };
}

function fromGoogleBook(data) {
  const info = data?.volumeInfo || {};
  const name = cleanText(info.title, 120);
  if (!name) return null;
  const images = info.imageLinks || {};
  return {
    title: `${name} | MediaDex`,
    description: cleanText(info.description) || `Descobre o livro ${name} no MediaDex.`,
    image: normalizeImageUrl(images.extraLarge || images.large || images.medium || images.thumbnail),
  };
}

function fromOpenLibraryBook(data) {
  const name = cleanText(data?.title, 120);
  if (!name) return null;
  const coverId = Array.isArray(data?.covers) ? data.covers.find((value) => Number.isSafeInteger(Number(value)) && Number(value) > 0) : null;
  return {
    title: `${name} | MediaDex`,
    description: cleanText(data?.description) || `Descobre o livro ${name} no MediaDex.`,
    image: coverId ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg` : null,
  };
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) return null;
  return response.json();
}

async function resolvePublicMetadata(route, env, origin) {
  const fallback = getDefaultMetadata(route, origin);
  try {
    if (route.type === 'series' || route.type === 'movie') {
      if (!env.TMDB_API_KEY) return fallback;
      const endpoint = route.type === 'series' ? 'tv' : 'movie';
      const url = new URL(`${TMDB_BASE_URL}/${endpoint}/${route.tmdbId}`);
      url.searchParams.set('api_key', env.TMDB_API_KEY);
      url.searchParams.set('language', 'pt-PT');
      return { ...fallback, ...(fromTmdb(await fetchJson(url.toString()), route.type) || {}) };
    }

    if (route.provider === 'google_books') {
      const url = `${GOOGLE_BOOKS_BASE_URL}/${encodeURIComponent(route.sourceId)}`;
      return { ...fallback, ...(fromGoogleBook(await fetchJson(url)) || {}) };
    }

    if (route.provider === 'open_library') {
      const safePath = route.sourceId.replace(/^\/+/, '');
      if (!/^works\/OL\d+W$/i.test(safePath)) return fallback;
      const url = `${OPEN_LIBRARY_BASE_URL}/${safePath}.json`;
      return { ...fallback, ...(fromOpenLibraryBook(await fetchJson(url)) || {}) };
    }
  } catch (error) {
    console.warn('share.opengraph_metadata_failed', { type: route.type, error: error instanceof Error ? error.message : String(error) });
  }
  return fallback;
}

function buildMetaTags(metadata, canonicalUrl) {
  const tags = [
    ['name', 'description', metadata.description],
    ['property', 'og:type', 'website'],
    ['property', 'og:site_name', 'MediaDex'],
    ['property', 'og:title', metadata.title],
    ['property', 'og:description', metadata.description],
    ['property', 'og:url', canonicalUrl],
    ['property', 'og:image', metadata.image],
    ['name', 'twitter:card', 'summary_large_image'],
    ['name', 'twitter:title', metadata.title],
    ['name', 'twitter:description', metadata.description],
    ['name', 'twitter:image', metadata.image],
  ];
  return [
    `<title>${escapeHtml(metadata.title)}</title>`,
    `<link rel="canonical" href="${escapeHtml(canonicalUrl)}">`,
    ...tags.map(([attribute, name, value]) => `<meta ${attribute}="${name}" content="${escapeHtml(value)}">`),
  ].join('');
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const requestUrl = new URL(request.url);
  const route = parseShareRoute(requestUrl.pathname);
  const baseResponsePromise = context.next();

  if (!route) return baseResponsePromise;

  const [baseResponse, metadata] = await Promise.all([
    baseResponsePromise,
    resolvePublicMetadata(route, env, requestUrl.origin),
  ]);
  const contentType = baseResponse.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return baseResponse;

  const canonicalUrl = new URL(requestUrl.pathname, requestUrl.origin).toString();
  const html = await baseResponse.text();
  const headers = new Headers(baseResponse.headers);
  headers.delete('content-length');
  headers.set('Cache-Control', 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400');
  const htmlWithoutStaticTitle = html.replace(/<title>[\s\S]*?<\/title>/i, '');
  return new Response(htmlWithoutStaticTitle.replace('</head>', `${buildMetaTags(metadata, canonicalUrl)}</head>`), {
    status: baseResponse.status,
    statusText: baseResponse.statusText,
    headers,
  });
}
