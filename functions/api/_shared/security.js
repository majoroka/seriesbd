const PROXY_HEADER_EXPOSE = 'x-request-id, x-upstream-status, x-upstream-latency-ms, x-ratelimit-limit, x-ratelimit-remaining, x-ratelimit-reset, retry-after';

const getRateLimitStore = () => {
  if (!globalThis.__seriesbdRateLimitStore) {
    globalThis.__seriesbdRateLimitStore = new Map();
  }
  return globalThis.__seriesbdRateLimitStore;
};

export const createRequestId = (prefix = 'req') => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
};

export const getErrorMessage = (error) => (error instanceof Error ? error.message : String(error));

export const sanitizeOriginHeaders = (sourceHeaders) => {
  const headers = new Headers(sourceHeaders);
  headers.delete('content-encoding');
  headers.delete('content-length');
  headers.delete('Content-Encoding');
  headers.delete('Content-Length');
  return headers;
};

export const addProxyHeaders = (response, { requestId, upstreamStatus, durationMs }) => {
  response.headers.set('x-request-id', requestId);
  response.headers.set('x-upstream-status', String(upstreamStatus));
  response.headers.set('x-upstream-latency-ms', String(durationMs));
  response.headers.set('Access-Control-Expose-Headers', PROXY_HEADER_EXPOSE);
  return response;
};

export const addCorsHeaders = (response, corsConfig = {}) => {
  const {
    origin = '*',
    methods = 'GET, OPTIONS',
    headers = 'Content-Type',
    maxAge = '86400',
  } = corsConfig;
  response.headers.set('Access-Control-Allow-Origin', origin);
  response.headers.set('Access-Control-Allow-Methods', methods);
  response.headers.set('Access-Control-Allow-Headers', headers);
  response.headers.set('Access-Control-Max-Age', String(maxAge));
  return response;
};

export const jsonResponse = (payload, status = 200, extraHeaders = {}) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  });

export const handleOptions = (request, requestId, corsConfig = {}) => {
  if (request.method.toUpperCase() !== 'OPTIONS') return null;
  const response = addCorsHeaders(new Response(null, { status: 204 }), corsConfig);
  response.headers.set('x-request-id', requestId);
  response.headers.set('Access-Control-Expose-Headers', PROXY_HEADER_EXPOSE);
  return response;
};

export const resolveEndpointPath = (requestUrl, routePrefix) => {
  const url = new URL(requestUrl);
  let endpointPath = url.pathname;
  if (endpointPath.startsWith(routePrefix)) {
    endpointPath = endpointPath.substring(routePrefix.length);
  }
  return endpointPath || '/';
};

export const isPathSafe = (endpointPath) => {
  if (!endpointPath.startsWith('/')) return false;
  if (endpointPath.includes('..') || endpointPath.includes('//')) return false;
  if (/https?:/i.test(endpointPath)) return false;
  return /^\/[A-Za-z0-9\-._~/%]*$/.test(endpointPath);
};

export const sanitizeSearchParams = (searchParams, options = {}) => {
  const {
    maxParams = 20,
    maxKeyLength = 40,
    maxValueLength = 500,
  } = options;
  const entries = Array.from(searchParams.entries());
  if (entries.length > maxParams) {
    throw new Error(`Too many query parameters (max ${maxParams}).`);
  }

  const sanitized = new URLSearchParams();
  for (const [rawKey, rawValue] of entries) {
    const key = String(rawKey || '');
    const value = String(rawValue || '');

    if (!/^[A-Za-z0-9_]+$/.test(key)) {
      throw new Error(`Invalid query parameter key: ${key}`);
    }
    if (key.length > maxKeyLength) {
      throw new Error(`Query key too long: ${key}`);
    }
    if (value.length > maxValueLength) {
      throw new Error(`Query value too long for key: ${key}`);
    }
    if (/[\x00-\x1F\x7F]/.test(value)) {
      throw new Error(`Invalid control character in query value: ${key}`);
    }
    sanitized.append(key, value);
  }

  return sanitized;
};

export const getClientIp = (request) => {
  const cfIp = request.headers.get('cf-connecting-ip');
  if (cfIp) return cfIp;
  const forwarded = request.headers.get('x-forwarded-for');
  if (!forwarded) return 'unknown';
  const [first] = forwarded.split(',');
  return String(first || '').trim() || 'unknown';
};

export const enforceRateLimit = (request, { routeKey, limit, windowMs }) => {
  const now = Date.now();
  const store = getRateLimitStore();
  const ip = getClientIp(request);
  const key = `${routeKey}:${ip}`;
  const entry = store.get(key);

  if (!entry || now >= entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
  } else {
    entry.count += 1;
    store.set(key, entry);
  }

  // Lazy cleanup to avoid unbounded growth.
  if (store.size > 2000) {
    for (const [storeKey, value] of store.entries()) {
      if (now >= value.resetAt) store.delete(storeKey);
    }
  }

  const active = store.get(key);
  const remaining = Math.max(0, limit - active.count);
  const resetEpochSec = Math.ceil(active.resetAt / 1000);
  const retryAfterSec = Math.max(1, Math.ceil((active.resetAt - now) / 1000));
  const headers = {
    'x-ratelimit-limit': String(limit),
    'x-ratelimit-remaining': String(remaining),
    'x-ratelimit-reset': String(resetEpochSec),
  };

  if (active.count > limit) {
    return {
      allowed: false,
      retryAfterSec,
      headers: {
        ...headers,
        'retry-after': String(retryAfterSec),
      },
    };
  }

  return { allowed: true, retryAfterSec, headers };
};

export const applyRateLimitHeaders = (response, rateLimitResult) => {
  Object.entries(rateLimitResult.headers).forEach(([name, value]) => {
    response.headers.set(name, String(value));
  });
  return response;
};

export const logEvent = (level, event, data = {}) => {
  const payload = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...data,
  });

  if (level === 'error') console.error(payload);
  else if (level === 'warn') console.warn(payload);
  else console.log(payload);
};

export const maskApiKeyFromUrl = (rawUrl) => {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.searchParams.has('api_key')) parsed.searchParams.set('api_key', '***');
    return parsed.toString();
  } catch {
    return String(rawUrl || '').replace(/api_key=[^&]+/g, 'api_key=***');
  }
};

export const resetRateLimitStore = () => {
  getRateLimitStore().clear();
};
