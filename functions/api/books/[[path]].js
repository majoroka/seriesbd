import {
  addCorsHeaders,
  addProxyHeaders,
  applyRateLimitHeaders,
  createRequestId,
  enforceRateLimit,
  getErrorMessage,
  handleOptions,
  jsonResponse,
  resolveEndpointPath,
  sanitizeSearchParams,
} from '../_shared/security.js';

const GOOGLE_BOOKS_BASE_URL = 'https://www.googleapis.com/books/v1';
const OPEN_LIBRARY_BASE_URL = 'https://openlibrary.org';
const OPEN_LIBRARY_COVERS_BASE_URL = 'https://covers.openlibrary.org/b/id';
const PRESENCA_BASE_URL = 'https://www.presenca.pt';
const GOODREADS_BASE_URL = 'https://www.goodreads.com';
const BOOK_ID_OFFSET = 2_000_000_000;
const BOOK_ID_RANGE = 1_000_000_000;
const ROUTE_KEY = 'books';
const FALLBACK_PROVIDER_HEADERS = {
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'pt-PT,pt;q=0.9,en;q=0.8',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
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

export const normalizeIsbn = (rawValue) => {
  const normalized = String(rawValue || '')
    .toUpperCase()
    .replace(/[^0-9X]/g, '');
  if (normalized.length === 10 || normalized.length === 13) return normalized;
  return null;
};

const extractIsbnFields = (inputValues) => {
  const candidates = (Array.isArray(inputValues) ? inputValues : [inputValues])
    .map((value) => normalizeIsbn(value))
    .filter(Boolean);

  const isbn13 = candidates.find((value) => value.length === 13) || null;
  const isbn10 = candidates.find((value) => value.length === 10) || null;

  return {
    isbn: isbn13 || isbn10 || null,
    isbn_13: isbn13,
    isbn_10: isbn10,
  };
};

const toGenreList = (input) => {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 3).map((name, index) => ({ id: index + 1, name: String(name) }));
};

const dedupeBookResults = (results) => {
  const seen = new Set();
  return (Array.isArray(results) ? results : []).filter((item) => {
    const provider = String(item?.source_provider || '');
    const sourceId = String(item?.source_id || item?.id || '');
    const key = `${provider}:${sourceId}`;
    if (!sourceId || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const hasBookText = (value) => String(value || '').trim().length > 0;
const isWeakBookPosterUrl = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return true;
  return normalized.includes('books.google.com/books/content');
};
const bookNeedsMetadata = (book) => !book || !hasBookText(book.overview) || !book.poster_path;

export const mergeBookMetadata = (baseResult, enrichmentResult) => {
  if (!baseResult && !enrichmentResult) return null;
  if (!baseResult) return enrichmentResult;
  if (!enrichmentResult) return baseResult;

  return {
    ...baseResult,
    overview: hasBookText(baseResult.overview) ? baseResult.overview : enrichmentResult.overview,
    poster_path: (!baseResult.poster_path || isWeakBookPosterUrl(baseResult.poster_path))
      ? (enrichmentResult.poster_path || baseResult.poster_path || null)
      : (baseResult.poster_path || enrichmentResult.poster_path || null),
    genres: Array.isArray(baseResult.genres) && baseResult.genres.length > 0 ? baseResult.genres : enrichmentResult.genres,
    first_air_date: hasBookText(baseResult.first_air_date) ? baseResult.first_air_date : enrichmentResult.first_air_date,
    original_name: hasBookText(baseResult.original_name) ? baseResult.original_name : enrichmentResult.original_name,
    isbn: baseResult.isbn || enrichmentResult.isbn || null,
    isbn_13: baseResult.isbn_13 || enrichmentResult.isbn_13 || null,
    isbn_10: baseResult.isbn_10 || enrichmentResult.isbn_10 || null,
  };
};

export const buildGoogleSearchQueries = (query) => {
  const normalized = String(query || '').trim().replace(/\s+/g, ' ');
  if (!normalized) return [];

  const normalizedIsbn = normalizeIsbn(normalized);
  if (normalizedIsbn) {
    return [`isbn:${normalizedIsbn}`];
  }

  const strategies = [normalized];
  if (!/^inauthor:/i.test(normalized)) {
    strategies.push(`inauthor:"${normalized}"`);
  }
  if (!/^intitle:/i.test(normalized)) {
    strategies.push(`intitle:"${normalized}"`);
  }

  return Array.from(new Set(strategies));
};

const normalizeGoogleCoverUrl = (rawUrl) => {
  if (!rawUrl) return null;
  const normalized = String(rawUrl).replace(/^http:\/\//i, 'https://');
  try {
    const parsed = new URL(normalized);
    const currentZoom = Number(parsed.searchParams.get('zoom') || '1');
    if (Number.isNaN(currentZoom) || currentZoom < 2) {
      parsed.searchParams.set('zoom', '3');
    }
    parsed.searchParams.delete('edge');
    return parsed.toString();
  } catch {
    return normalized
      .replace(/([?&])zoom=1(&|$)/, '$1zoom=3$2')
      .replace(/([?&])edge=[^&]+(&|$)/, '$1');
  }
};

const buildGoogleCoverFallback = (sourceId) => {
  const safeId = String(sourceId || '').trim();
  if (!safeId) return null;
  return `https://books.google.com/books/content?id=${encodeURIComponent(safeId)}&printsec=frontcover&img=1&zoom=3&source=gbs_api`;
};

const toGoogleCover = (imageLinks, sourceId) => {
  const raw =
    imageLinks?.extraLarge
    || imageLinks?.large
    || imageLinks?.medium
    || imageLinks?.small
    || imageLinks?.thumbnail
    || imageLinks?.smallThumbnail
    || buildGoogleCoverFallback(sourceId);
  return normalizeGoogleCoverUrl(raw);
};

const toGoogleIsbnFields = (industryIdentifiers) =>
  extractIsbnFields(
    (Array.isArray(industryIdentifiers) ? industryIdentifiers : []).map((entry) => entry?.identifier),
  );

const toOpenLibraryIsbnFields = (isbnList) => extractIsbnFields(isbnList);

export const mapGoogleBook = (item) => {
  const info = item?.volumeInfo || {};
  const sourceId = String(item?.id || info?.canonicalVolumeLink || info?.title || Math.random());
  const description = typeof info.description === 'string' ? info.description : '';
  const publishedDate = typeof info.publishedDate === 'string' ? info.publishedDate : '';
  const rating = typeof info.averageRating === 'number' ? Number((info.averageRating * 2).toFixed(1)) : undefined;
  const isbnFields = toGoogleIsbnFields(info.industryIdentifiers);

  return {
    id: toScopedBookId(`google:${sourceId}`),
    media_type: 'book',
    source_provider: 'google_books',
    source_id: sourceId,
    name: String(info.title || 'Livro sem titulo'),
    original_name: String(info.subtitle || info.title || ''),
    overview: description,
    poster_path: toGoogleCover(info.imageLinks, sourceId),
    backdrop_path: null,
    first_air_date: publishedDate,
    genres: toGenreList(info.categories),
    vote_average: rating,
    ...isbnFields,
  };
};

export const mapOpenLibraryBook = (doc) => {
  const sourceId = String(doc?.key || doc?.cover_edition_key || doc?.edition_key?.[0] || doc?.title || Math.random());
  const firstSentence = Array.isArray(doc?.first_sentence) ? doc.first_sentence[0] : doc?.first_sentence;
  const overview = typeof firstSentence === 'string' ? firstSentence : '';
  const firstPublishYear = Number(doc?.first_publish_year);
  const firstAirDate = Number.isNaN(firstPublishYear) ? '' : `${firstPublishYear}-01-01`;
  const isbnFields = toOpenLibraryIsbnFields(doc?.isbn);

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
    ...isbnFields,
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

const searchOpenLibraryBooks = async (query, options = {}) => {
  const { byAuthor = false, isbn = null } = options;
  const url = new URL(`${OPEN_LIBRARY_BASE_URL}/search.json`);
  if (isbn) {
    url.searchParams.set('isbn', isbn);
  } else {
    url.searchParams.set(byAuthor ? 'author' : 'q', query);
  }
  url.searchParams.set('limit', '20');
  if (!byAuthor && !isbn) {
    url.searchParams.set('language', 'por');
  }

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

const searchGoogleBooksByIsbn = async (isbn, apiKey) => searchGoogleBooks(`isbn:${isbn}`, apiKey);

const searchOpenLibraryBooksByIsbn = async (isbn) => searchOpenLibraryBooks(isbn, { isbn });

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

const fetchGoogleBookByIsbn = async (isbn, apiKey) => {
  const search = await searchGoogleBooksByIsbn(isbn, apiKey);
  if (!search.ok) return { ok: false, status: search.status, result: null };
  const exactMatch = search.results.find((result) => result?.isbn === isbn || result?.isbn_13 === isbn || result?.isbn_10 === isbn);
  return {
    ok: Boolean(exactMatch),
    status: search.status,
    result: exactMatch || null,
  };
};

const mapOpenLibraryWorkDetails = (payload, sourceId, fallbackTitle = '') => {
  const descriptionRaw = payload?.description;
  const description = typeof descriptionRaw === 'string'
    ? descriptionRaw
    : (typeof descriptionRaw?.value === 'string' ? descriptionRaw.value : '');
  const title = String(payload?.title || fallbackTitle || 'Livro sem titulo');
  const firstPublished = String(payload?.first_publish_date || '');
  const coverId = Array.isArray(payload?.covers) ? payload.covers[0] : null;
  const isbnFields = toOpenLibraryIsbnFields(payload?.isbn_13 || payload?.isbn_10 || payload?.isbn);

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
    ...isbnFields,
  };
};

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const stripHtml = (value) => String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

const decodeHtmlEntities = (value) =>
  String(value || '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

const sanitizeOverviewText = (value) => {
  const text = decodeHtmlEntities(stripHtml(value));
  return text.length > 1200 ? `${text.slice(0, 1197).trim()}...` : text;
};

const normalizeBookMatchText = (value) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' e ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const toTitleCandidates = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return [];
  const rawCandidates = [
    raw,
    raw.split(':')[0],
    raw.split(' - ')[0],
    raw.replace(/\([^)]*\)/g, ' '),
  ];
  return Array.from(new Set(rawCandidates.map((entry) => normalizeBookMatchText(entry)).filter(Boolean)));
};

const toMeaningfulTokens = (value) =>
  normalizeBookMatchText(value)
    .split(' ')
    .filter((token) => token.length >= 3);

const titlesStronglyMatch = (left, right) => {
  const leftCandidates = toTitleCandidates(left);
  const rightCandidates = toTitleCandidates(right);
  if (leftCandidates.length === 0 || rightCandidates.length === 0) return false;
  if (leftCandidates.some((candidate) => rightCandidates.includes(candidate))) return true;

  const partialMatch = leftCandidates.some((leftCandidate) =>
    rightCandidates.some((rightCandidate) => {
      const shorter = leftCandidate.length <= rightCandidate.length ? leftCandidate : rightCandidate;
      const longer = leftCandidate.length > rightCandidate.length ? leftCandidate : rightCandidate;
      return shorter.length >= 8 && longer.includes(shorter);
    }),
  );
  if (partialMatch) return true;

  return leftCandidates.some((leftCandidate) => {
    const leftTokens = toMeaningfulTokens(leftCandidate);
    if (leftTokens.length < 2) return false;
    return rightCandidates.some((rightCandidate) => {
      const rightTokens = new Set(toMeaningfulTokens(rightCandidate));
      const sharedTokens = leftTokens.filter((token) => rightTokens.has(token)).length;
      return sharedTokens >= Math.max(2, Math.ceil(leftTokens.length * 0.6));
    });
  });
};

const absolutizeUrl = (rawUrl, baseUrl) => {
  if (!rawUrl) return null;
  try {
    return new URL(String(rawUrl), baseUrl).toString();
  } catch {
    return null;
  }
};

const extractMetaContent = (html, attributeName, attributeValue) => {
  const pattern = new RegExp(
    `<meta[^>]+${attributeName}=["']${escapeRegExp(attributeValue)}["'][^>]+content=["']([^"']+)["'][^>]*>|<meta[^>]+content=["']([^"']+)["'][^>]+${attributeName}=["']${escapeRegExp(attributeValue)}["'][^>]*>`,
    'i',
  );
  const match = html.match(pattern);
  return decodeHtmlEntities(match?.[1] || match?.[2] || '');
};

const parseJsonLdBlocks = (html) => {
  const matches = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  const result = [];
  for (const match of matches) {
    const raw = String(match[1] || '').trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) result.push(...parsed);
      else result.push(parsed);
    } catch {
      continue;
    }
  }
  return result;
};

const flattenJsonLdNodes = (input, bucket = []) => {
  if (!input) return bucket;
  if (Array.isArray(input)) {
    input.forEach((entry) => flattenJsonLdNodes(entry, bucket));
    return bucket;
  }
  if (typeof input !== 'object') return bucket;
  bucket.push(input);
  if (Array.isArray(input['@graph'])) {
    input['@graph'].forEach((entry) => flattenJsonLdNodes(entry, bucket));
  }
  return bucket;
};

const collectJsonLdIsbns = (node) => {
  if (!node || typeof node !== 'object') return [];
  const direct = extractIsbnFields([
    node.isbn,
    ...(Array.isArray(node.isbn) ? node.isbn : []),
    node.sku,
    node.gtin13,
    node.gtin12,
    node.gtin14,
    node.productID,
  ]);
  return [direct.isbn_13, direct.isbn_10, direct.isbn].filter(Boolean);
};

const extractFallbackProductLinks = (html, baseUrl, isbn) => {
  const matches = html.matchAll(/href=["']([^"']*(?:\/livro\/|\/wook\/i\/)[^"']+)["']/gi);
  const candidates = [];
  for (const match of matches) {
    const href = absolutizeUrl(match[1], baseUrl);
    if (!href) continue;
    const rawIndex = typeof match.index === 'number' ? match.index : 0;
    const context = html.slice(Math.max(0, rawIndex - 350), rawIndex + 900);
    const score = context.includes(isbn) ? 2 : 1;
    candidates.push({ href, score });
  }
  return [...new Map(
    candidates
      .sort((left, right) => right.score - left.score)
      .map((entry) => [entry.href, entry]),
  ).values()].map((entry) => entry.href);
};

const buildFallbackResult = ({ provider, isbn, productUrl, imageUrl, overview }) => ({
  provider,
  isbn,
  result: {
    source_provider: provider,
    source_id: productUrl,
    isbn,
    overview: sanitizeOverviewText(overview),
    poster_path: imageUrl || null,
  },
});

const normalizePresencaHandle = (rawHandle) => {
  const value = String(rawHandle || '').trim();
  if (!value) return null;
  try {
    const parsed = new URL(value, PRESENCA_BASE_URL);
    return `${parsed.pathname}`.replace(/\.js$/i, '');
  } catch {
    const sanitized = value.split('?')[0].trim();
    return sanitized.startsWith('/') ? sanitized : `/${sanitized}`;
  }
};

export const parsePresencaSearchResults = (payload, expectedIsbn) => {
  const items = Array.isArray(payload) ? payload : [];
  for (const item of items) {
    const handle = normalizePresencaHandle(item?.handle);
    const title = String(item?.title || item?.value || '').trim();
    const imageUrl = absolutizeUrl(item?.featured_image, PRESENCA_BASE_URL);
    if (!handle) continue;
    if (hasBookText(title) || imageUrl) {
      return {
        handle,
        title,
        imageUrl,
      };
    }
  }
  return null;
};

export const parsePresencaProductPayload = (payload, expectedIsbn) => {
  if (!payload || typeof payload !== 'object') return null;

  const barcodeMatches = Array.isArray(payload.variants)
    && payload.variants.some((variant) => {
      const sku = normalizeIsbn(variant?.sku);
      const barcode = normalizeIsbn(variant?.barcode);
      return sku === expectedIsbn || barcode === expectedIsbn;
    });

  if (!barcodeMatches) return null;

  const imageUrl = absolutizeUrl(
    payload?.featured_image || payload?.media?.[0]?.src || payload?.images?.[0] || null,
    PRESENCA_BASE_URL,
  );

  return buildFallbackResult({
    provider: 'presenca',
    isbn: expectedIsbn,
    productUrl: absolutizeUrl(payload?.url || '', PRESENCA_BASE_URL),
    imageUrl,
    overview: payload?.description || '',
  });
};

export const parseGoodreadsSearchResults = (html) => {
  const matches = html.matchAll(/<a[^>]+href=["']([^"']*\/book\/show\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi);
  const results = [];
  const seen = new Set();

  for (const match of matches) {
    const productUrl = absolutizeUrl(String(match[1] || '').split('?')[0], GOODREADS_BASE_URL);
    const title = sanitizeOverviewText(match[2] || '');
    if (!productUrl || !title || seen.has(productUrl)) continue;
    seen.add(productUrl);
    results.push({
      productUrl,
      title,
    });
  }

  return results;
};

export const parseGoodreadsBookPage = (html, pageUrl, expectedTitle, expectedIsbn = null) => {
  const jsonLdNodes = flattenJsonLdNodes(parseJsonLdBlocks(html));
  const bookNode = jsonLdNodes.find((entry) => {
    const type = entry?.['@type'];
    return type === 'Book' || (Array.isArray(type) && type.includes('Book'));
  }) || null;

  const pageTitle =
    String(bookNode?.name || '').trim()
    || extractMetaContent(html, 'property', 'og:title')
    || extractMetaContent(html, 'name', 'twitter:title');
  const jsonLdIsbns = collectJsonLdIsbns(bookNode);
  const titleMatches = titlesStronglyMatch(pageTitle, expectedTitle);
  const isbnMatches = expectedIsbn ? (jsonLdIsbns.includes(expectedIsbn) || html.includes(expectedIsbn)) : false;
  if (!titleMatches && !isbnMatches) return null;

  const rawImage = Array.isArray(bookNode?.image)
    ? bookNode.image[0]
    : (bookNode?.image?.url || bookNode?.image?.contentUrl || bookNode?.image);
  const imageUrl = absolutizeUrl(
    rawImage || extractMetaContent(html, 'property', 'og:image') || extractMetaContent(html, 'name', 'twitter:image'),
    pageUrl,
  );
  const overview =
    bookNode?.description
    || extractMetaContent(html, 'property', 'og:description')
    || extractMetaContent(html, 'name', 'description');
  const normalizedPageUrl = absolutizeUrl(String(pageUrl || '').split('?')[0], GOODREADS_BASE_URL) || pageUrl;

  return buildFallbackResult({
    provider: 'goodreads',
    isbn: expectedIsbn || jsonLdIsbns[0] || null,
    productUrl: normalizedPageUrl,
    imageUrl,
    overview,
  });
};

export const parseBertrandBookPage = (html, pageUrl, expectedIsbn) => {
  const jsonLdBlocks = parseJsonLdBlocks(html);
  const matchedJsonLd = jsonLdBlocks.find((entry) => collectJsonLdIsbns(entry).includes(expectedIsbn));
  const metaImage = extractMetaContent(html, 'property', 'og:image') || extractMetaContent(html, 'name', 'twitter:image');
  const metaDescription = extractMetaContent(html, 'property', 'og:description') || extractMetaContent(html, 'name', 'description');

  if (!matchedJsonLd && !html.includes(expectedIsbn)) return null;

  const imageUrl = absolutizeUrl(
    matchedJsonLd?.image?.url || matchedJsonLd?.image?.contentUrl || matchedJsonLd?.image || metaImage,
    pageUrl,
  );
  const overview = matchedJsonLd?.description || metaDescription;
  return buildFallbackResult({
    provider: 'bertrand',
    isbn: expectedIsbn,
    productUrl: pageUrl,
    imageUrl,
    overview,
  });
};

export const parseWookBookPage = (html, pageUrl, expectedIsbn) => {
  const jsonLdBlocks = parseJsonLdBlocks(html);
  const matchedJsonLd = jsonLdBlocks.find((entry) => collectJsonLdIsbns(entry).includes(expectedIsbn));
  const metaImage = extractMetaContent(html, 'property', 'og:image') || extractMetaContent(html, 'name', 'twitter:image');
  const metaDescription = extractMetaContent(html, 'property', 'og:description') || extractMetaContent(html, 'name', 'description');

  if (!matchedJsonLd && !html.includes(expectedIsbn)) return null;

  const imageUrl = absolutizeUrl(
    matchedJsonLd?.image?.url || matchedJsonLd?.image?.contentUrl || matchedJsonLd?.image || metaImage,
    pageUrl,
  );
  const overview = matchedJsonLd?.description || metaDescription;
  return buildFallbackResult({
    provider: 'wook',
    isbn: expectedIsbn,
    productUrl: pageUrl,
    imageUrl,
    overview,
  });
};

const fetchHtmlPage = async (url) => {
  const response = await fetch(url, {
    method: 'GET',
    headers: FALLBACK_PROVIDER_HEADERS,
    redirect: 'follow',
  });
  const html = await response.text().catch(() => '');
  return {
    ok: response.ok,
    status: response.status,
    url: response.url || url,
    html,
  };
};

const resolveBertrandProductUrlByIsbn = async (isbn) => {
  const searchPage = await fetchHtmlPage(`https://www.bertrand.pt/pesquisa?query=${encodeURIComponent(isbn)}`);
  if (!searchPage.ok) {
    return { ok: false, status: searchPage.status, url: null, reason: 'search_failed' };
  }
  const links = extractFallbackProductLinks(searchPage.html, searchPage.url, isbn);
  return { ok: links.length > 0, status: searchPage.status, url: links[0] || null, reason: links.length > 0 ? null : 'no_product_link' };
};

const resolveWookProductUrlByIsbn = async (isbn) => {
  const candidateUrls = [
    `https://www.wook.pt/pesquisa/${encodeURIComponent(isbn)}`,
    `https://www.wook.pt/pesquisa?query=${encodeURIComponent(isbn)}`,
  ];

  for (const candidateUrl of candidateUrls) {
    const searchPage = await fetchHtmlPage(candidateUrl);
    if (!searchPage.ok) continue;
    const links = extractFallbackProductLinks(searchPage.html, searchPage.url, isbn);
    if (links.length > 0) {
      return { ok: true, status: searchPage.status, url: links[0], reason: null };
    }
  }

  return { ok: false, status: 404, url: null, reason: 'no_product_link' };
};

const fetchBertrandFallbackByIsbn = async (isbn) => {
  const resolved = await resolveBertrandProductUrlByIsbn(isbn);
  if (!resolved.ok || !resolved.url) return { ok: false, status: resolved.status, provider: 'bertrand', result: null, reason: resolved.reason };

  const productPage = await fetchHtmlPage(resolved.url);
  if (!productPage.ok) return { ok: false, status: productPage.status, provider: 'bertrand', result: null, reason: 'product_fetch_failed' };

  const parsed = parseBertrandBookPage(productPage.html, productPage.url, isbn);
  return {
    ok: Boolean(parsed),
    status: productPage.status,
    provider: 'bertrand',
    result: parsed?.result || null,
    reason: parsed ? null : 'isbn_not_confirmed',
  };
};

const fetchWookFallbackByIsbn = async (isbn) => {
  const resolved = await resolveWookProductUrlByIsbn(isbn);
  if (!resolved.ok || !resolved.url) return { ok: false, status: resolved.status, provider: 'wook', result: null, reason: resolved.reason };

  const productPage = await fetchHtmlPage(resolved.url);
  if (!productPage.ok) return { ok: false, status: productPage.status, provider: 'wook', result: null, reason: 'product_fetch_failed' };

  const parsed = parseWookBookPage(productPage.html, productPage.url, isbn);
  return {
    ok: Boolean(parsed),
    status: productPage.status,
    provider: 'wook',
    result: parsed?.result || null,
    reason: parsed ? null : 'isbn_not_confirmed',
  };
};

const resolvePresencaProductByIsbn = async (isbn) => {
  const searchUrl = `${PRESENCA_BASE_URL}/search?q=${encodeURIComponent(isbn)}&view=json`;
  const response = await fetch(searchUrl, {
    method: 'GET',
    headers: {
      ...FALLBACK_PROVIDER_HEADERS,
      Accept: 'application/json,text/plain,*/*',
    },
    redirect: 'follow',
  });

  const rawText = await response.text().catch(() => '');
  if (!response.ok) {
    return { ok: false, status: response.status, handle: null, reason: 'search_failed' };
  }

  try {
    const payload = JSON.parse(String(rawText || '').trim());
    const match = parsePresencaSearchResults(payload, isbn);
    return {
      ok: Boolean(match?.handle),
      status: response.status,
      handle: match?.handle || null,
      previewImageUrl: match?.imageUrl || null,
      reason: match?.handle ? null : 'no_product_link',
    };
  } catch {
    return { ok: false, status: response.status, handle: null, reason: 'search_parse_failed' };
  }
};

const fetchPresencaFallbackByIsbn = async (isbn) => {
  const resolved = await resolvePresencaProductByIsbn(isbn);
  if (!resolved.ok || !resolved.handle) {
    return { ok: false, status: resolved.status, provider: 'presenca', result: null, reason: resolved.reason };
  }

  const productUrl = `${PRESENCA_BASE_URL}${resolved.handle}.js`;
  const response = await fetch(productUrl, {
    method: 'GET',
    headers: {
      ...FALLBACK_PROVIDER_HEADERS,
      Accept: 'application/json,text/plain,*/*',
    },
    redirect: 'follow',
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload) {
    return { ok: false, status: response.status, provider: 'presenca', result: null, reason: 'product_fetch_failed' };
  }

  const parsed = parsePresencaProductPayload(payload, isbn);
  if (parsed?.result && !parsed.result.poster_path && resolved.previewImageUrl) {
    parsed.result.poster_path = resolved.previewImageUrl;
  }

  return {
    ok: Boolean(parsed),
    status: response.status,
    provider: 'presenca',
    result: parsed?.result || null,
    reason: parsed ? null : 'isbn_not_confirmed',
  };
};

const fetchGoodreadsFallbackByTitle = async (title, isbn = null) => {
  const normalizedTitle = String(title || '').trim();
  if (!normalizedTitle) {
    return { ok: false, status: 400, provider: 'goodreads', result: null, reason: 'missing_title' };
  }

  const searchPage = await fetchHtmlPage(`${GOODREADS_BASE_URL}/search?q=${encodeURIComponent(normalizedTitle)}&search%5Bfield%5D=title`);
  if (!searchPage.ok) {
    return { ok: false, status: searchPage.status, provider: 'goodreads', result: null, reason: 'search_failed' };
  }

  const parsedCandidates = parseGoodreadsSearchResults(searchPage.html);
  const strongCandidates = parsedCandidates.filter((entry) => titlesStronglyMatch(entry.title, normalizedTitle));
  const fallbackCandidates = parsedCandidates.filter((entry) => !strongCandidates.some((match) => match.productUrl === entry.productUrl));
  const candidates = [...strongCandidates, ...fallbackCandidates];

  for (const candidate of candidates.slice(0, 8)) {
    const productPage = await fetchHtmlPage(candidate.productUrl);
    if (!productPage.ok) continue;
    const parsed = parseGoodreadsBookPage(productPage.html, productPage.url, normalizedTitle, isbn);
    if (parsed?.result) {
      return {
        ok: true,
        status: productPage.status,
        provider: 'goodreads',
        result: parsed.result,
        reason: null,
      };
    }
  }

  return { ok: false, status: searchPage.status || 404, provider: 'goodreads', result: null, reason: 'no_strong_match' };
};

const enrichBookByOfficialSourcesAndFallbacks = async (baseResult, { isbn = null, title = '', googleApiKey = null } = {}) => {
  let result = baseResult;

  if (isbn) {
    const googleByIsbn = await fetchGoogleBookByIsbn(isbn, googleApiKey);
    if (googleByIsbn.ok && googleByIsbn.result) {
      result = mergeBookMetadata(result, googleByIsbn.result);
    }

    const openLibraryByIsbn = await fetchOpenLibraryBookByIsbn(isbn);
    if (openLibraryByIsbn.ok && openLibraryByIsbn.result) {
      result = mergeBookMetadata(result, openLibraryByIsbn.result);
    }
  }

  if (isbn && bookNeedsMetadata(result)) {
    const presencaFallback = await fetchPresencaFallbackByIsbn(isbn);
    if (presencaFallback.ok && presencaFallback.result) {
      result = mergeBookMetadata(result, presencaFallback.result);
    }
  }

  if (bookNeedsMetadata(result)) {
    const fallbackTitle = String(result?.name || title || '').trim();
    if (fallbackTitle) {
      const goodreadsFallback = await fetchGoodreadsFallbackByTitle(fallbackTitle, isbn);
      if (goodreadsFallback.ok && goodreadsFallback.result) {
        result = mergeBookMetadata(result, goodreadsFallback.result);
      }
    }
  }

  return result;
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

const fetchOpenLibraryBookByIsbn = async (isbn) => {
  const search = await searchOpenLibraryBooksByIsbn(isbn);
  if (!search.ok) return { ok: false, status: search.status, result: null };

  const exactMatch = search.results.find((result) => result?.isbn === isbn || result?.isbn_13 === isbn || result?.isbn_10 === isbn) || search.results[0];
  if (!exactMatch?.source_id) {
    return { ok: false, status: search.status || 404, result: null };
  }

  const details = await fetchOpenLibraryBookDetails(exactMatch.source_id, exactMatch.name);
  if (!details.ok || !details.result) {
    return {
      ok: true,
      status: search.status,
      result: exactMatch,
    };
  }

  return {
    ok: true,
    status: details.status || search.status,
    result: mergeBookMetadata(exactMatch, details.result),
  };
};

export async function onRequest(context) {
  const { request, env } = context;
  const requestId = createRequestId(ROUTE_KEY);
  const startedAt = Date.now();
  const corsConfig = { methods: 'GET, OPTIONS', headers: 'Content-Type' };
  const optionsResponse = handleOptions(request, requestId, corsConfig);
  if (optionsResponse) return optionsResponse;

  if (request.method.toUpperCase() !== 'GET') {
    const response = addCorsHeaders(jsonResponse({ ok: false, error: 'Method not allowed' }, 405, { Allow: 'GET, OPTIONS' }), corsConfig);
    return addProxyHeaders(response, {
      requestId,
      upstreamStatus: 405,
      durationMs: Date.now() - startedAt,
    });
  }

  const rateLimit = enforceRateLimit(request, { routeKey: ROUTE_KEY, limit: 80, windowMs: 60_000 });
  if (!rateLimit.allowed) {
    const response = addCorsHeaders(jsonResponse({ ok: false, error: 'Rate limit exceeded' }, 429), corsConfig);
    addProxyHeaders(response, {
      requestId,
      upstreamStatus: 429,
      durationMs: Date.now() - startedAt,
    });
    return applyRateLimitHeaders(response, rateLimit);
  }

  try {
    const url = new URL(request.url);
    const endpointPath = resolveEndpointPath(request.url, '/api/books');
    const safeParams = sanitizeSearchParams(url.searchParams, {
      maxParams: endpointPath === '/details' ? 6 : endpointPath === '/fallback' ? 5 : 3,
      maxValueLength: 500,
    });

    if (endpointPath !== '/search' && endpointPath !== '/details' && endpointPath !== '/fallback') {
      const notFound = addCorsHeaders(
        new Response(JSON.stringify({ error: 'Endpoint not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }),
        corsConfig
      );
      addProxyHeaders(notFound, {
        requestId,
        upstreamStatus: 404,
        durationMs: Date.now() - startedAt,
      });
      return applyRateLimitHeaders(notFound, rateLimit);
    }

    const googleApiKey = env.GOOGLE_BOOKS_API_KEY;
    if (endpointPath === '/search') {
      const query = (safeParams.get('query') || safeParams.get('q') || '').trim();
      if (!query) {
        const badRequest = addCorsHeaders(
          new Response(JSON.stringify({ error: 'Missing query parameter' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          }),
          corsConfig
        );
        addProxyHeaders(badRequest, {
          requestId,
          upstreamStatus: 400,
          durationMs: Date.now() - startedAt,
        });
        return applyRateLimitHeaders(badRequest, rateLimit);
      }

      const normalizedIsbn = normalizeIsbn(query);
      const googleQueries = buildGoogleSearchQueries(query);
      let provider = 'google_books';
      let upstreamStatus = 200;
      const googleResults = [];
      let googleHadOkResponse = false;

      for (const googleQuery of googleQueries) {
        const google = await searchGoogleBooks(googleQuery, googleApiKey);
        upstreamStatus = google.status;
        if (!google.ok) continue;
        googleHadOkResponse = true;
        googleResults.push(...google.results);
      }

      let results = dedupeBookResults(googleResults);

      if (normalizedIsbn) {
        const openLibraryIsbn = await searchOpenLibraryBooksByIsbn(normalizedIsbn);
        provider = 'official_isbn';
        upstreamStatus = openLibraryIsbn.status || upstreamStatus;
        results = dedupeBookResults([
          ...results,
          ...openLibraryIsbn.results,
        ]);

        results = await Promise.all(
          results.map(async (entry) => {
            const entryIsbn = entry?.isbn || entry?.isbn_13 || entry?.isbn_10;
            if (entryIsbn !== normalizedIsbn) return entry;
            return enrichBookByOfficialSourcesAndFallbacks(entry, {
              isbn: normalizedIsbn,
              title: entry?.name || query,
              googleApiKey,
            });
          }),
        );
      } else if (!googleHadOkResponse || results.length === 0) {
        const openLibraryKeyword = await searchOpenLibraryBooks(query);
        const openLibraryAuthor = await searchOpenLibraryBooks(query, { byAuthor: true });
        provider = 'open_library';
        upstreamStatus = openLibraryAuthor.status || openLibraryKeyword.status;
        results = dedupeBookResults([
          ...openLibraryKeyword.results,
          ...openLibraryAuthor.results,
        ]);
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
        ),
        corsConfig
      );

      addProxyHeaders(response, {
        requestId,
        upstreamStatus,
        durationMs: Date.now() - startedAt,
      });
      return applyRateLimitHeaders(response, rateLimit);
    }

    if (endpointPath === '/fallback') {
      const rawIsbn = safeParams.get('isbn') || safeParams.get('q') || '';
      const normalizedIsbn = normalizeIsbn(rawIsbn);
      const title = String(
        safeParams.get('title')
        || safeParams.get('query')
        || (normalizedIsbn ? '' : (safeParams.get('q') || '')),
      ).trim();
      const providerParam = String(safeParams.get('provider') || 'all').trim().toLowerCase();
      if (!normalizedIsbn && !title) {
        const badRequest = addCorsHeaders(
          new Response(JSON.stringify({ error: 'Missing or invalid isbn parameter, or missing title parameter' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          }),
          corsConfig,
        );
        addProxyHeaders(badRequest, {
          requestId,
          upstreamStatus: 400,
          durationMs: Date.now() - startedAt,
        });
        return applyRateLimitHeaders(badRequest, rateLimit);
      }

      const providers =
        providerParam === 'bertrand'
          ? ['bertrand']
          : providerParam === 'wook'
            ? ['wook']
            : providerParam === 'presenca'
              ? ['presenca']
              : providerParam === 'goodreads'
                ? ['goodreads']
                : normalizedIsbn
                  ? ['presenca', 'goodreads']
                  : ['goodreads'];

      const attempts = [];
      let result = null;
      let upstreamStatus = 404;
      let provider = null;

      for (const fallbackProvider of providers) {
        const fallbackResponse = fallbackProvider === 'bertrand'
          ? await fetchBertrandFallbackByIsbn(normalizedIsbn)
          : fallbackProvider === 'wook'
            ? await fetchWookFallbackByIsbn(normalizedIsbn)
            : fallbackProvider === 'goodreads'
              ? await fetchGoodreadsFallbackByTitle(title, normalizedIsbn)
              : normalizedIsbn
                ? await fetchPresencaFallbackByIsbn(normalizedIsbn)
                : { ok: false, status: 400, provider: 'presenca', result: null, reason: 'missing_isbn' };
        upstreamStatus = fallbackResponse.status || upstreamStatus;
        attempts.push({
          provider: fallbackProvider,
          ok: fallbackResponse.ok,
          status: fallbackResponse.status,
          reason: fallbackResponse.reason || null,
        });
        if (fallbackResponse.ok && fallbackResponse.result) {
          provider = fallbackProvider;
          result = fallbackResponse.result;
          break;
        }
      }

      if (!result) {
        const notFound = addCorsHeaders(
          new Response(JSON.stringify({
            ok: false,
            error: 'Fallback book metadata not found',
            isbn: normalizedIsbn || null,
            title: title || null,
            attempts,
          }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          }),
          corsConfig,
        );
        addProxyHeaders(notFound, {
          requestId,
          upstreamStatus: 404,
          durationMs: Date.now() - startedAt,
        });
        return applyRateLimitHeaders(notFound, rateLimit);
      }

      const response = addCorsHeaders(
        new Response(JSON.stringify({
          ok: true,
          isbn: normalizedIsbn || null,
          title: title || null,
          provider,
          result,
          attempts,
        }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=900',
          },
        }),
        corsConfig,
      );

      addProxyHeaders(response, {
        requestId,
        upstreamStatus,
        durationMs: Date.now() - startedAt,
      });
      return applyRateLimitHeaders(response, rateLimit);
    }

    const sourceId = (safeParams.get('source_id') || safeParams.get('id') || '').trim();
    const providerParam = (safeParams.get('provider') || '').trim();
    const query = (safeParams.get('query') || safeParams.get('q') || '').trim();
    const normalizedIsbn = normalizeIsbn(safeParams.get('isbn') || '');
    if (!sourceId && !query && !normalizedIsbn) {
      const badRequest = addCorsHeaders(
        new Response(JSON.stringify({ error: 'Missing source_id, isbn or query parameter' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }),
        corsConfig
      );
      addProxyHeaders(badRequest, {
        requestId,
        upstreamStatus: 400,
        durationMs: Date.now() - startedAt,
      });
      return applyRateLimitHeaders(badRequest, rateLimit);
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

    if (normalizedIsbn) {
      result = await enrichBookByOfficialSourcesAndFallbacks(result, {
        isbn: normalizedIsbn,
        title: result?.name || query,
        googleApiKey,
      });
    } else if (result && bookNeedsMetadata(result)) {
      result = await enrichBookByOfficialSourcesAndFallbacks(result, {
        title: result?.name || query,
        googleApiKey,
      });
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
        }),
        corsConfig
      );
      addProxyHeaders(notFound, {
        requestId,
        upstreamStatus: 404,
        durationMs: Date.now() - startedAt,
      });
      return applyRateLimitHeaders(notFound, rateLimit);
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
        ),
        corsConfig
      );

    addProxyHeaders(response, {
      requestId,
      upstreamStatus,
      durationMs: Date.now() - startedAt,
    });
    return applyRateLimitHeaders(response, rateLimit);
  } catch (error) {
    const response = addCorsHeaders(
      new Response(JSON.stringify({ error: 'Falha ao processar o pedido na função books' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }),
      corsConfig
    );
    addProxyHeaders(response, {
      requestId,
      upstreamStatus: 500,
      durationMs: Date.now() - startedAt,
    });
    return applyRateLimitHeaders(response, rateLimit);
  }
}
