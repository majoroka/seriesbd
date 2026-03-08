import { beforeEach, describe, expect, it } from 'vitest';
import {
  enforceRateLimit,
  isPathSafe,
  resetRateLimitStore,
  sanitizeSearchParams,
} from './security.js';

describe('security shared helpers', () => {
  beforeEach(() => {
    resetRateLimitStore();
  });

  it('accepts safe endpoint paths and rejects unsafe paths', () => {
    expect(isPathSafe('/tv/123/videos')).toBe(true);
    expect(isPathSafe('/resolve/show')).toBe(true);
    expect(isPathSafe('/../secret')).toBe(false);
    expect(isPathSafe('/http://evil.com')).toBe(false);
    expect(isPathSafe('/bad//path')).toBe(false);
  });

  it('sanitizes query params and rejects invalid keys', () => {
    const input = new URLSearchParams();
    input.set('query', 'Dexter');
    input.set('language', 'pt-PT');
    const sanitized = sanitizeSearchParams(input);
    expect(sanitized.get('query')).toBe('Dexter');
    expect(sanitized.get('language')).toBe('pt-PT');

    const bad = new URLSearchParams();
    bad.set('bad-key', 'x');
    expect(() => sanitizeSearchParams(bad)).toThrow(/Invalid query parameter key/);
  });

  it('enforces rate limits per route and IP', () => {
    const request = new Request('https://example.com/api/tmdb/search', {
      headers: { 'cf-connecting-ip': '1.1.1.1' },
    });

    const a = enforceRateLimit(request, { routeKey: 'tmdb', limit: 2, windowMs: 60_000 });
    const b = enforceRateLimit(request, { routeKey: 'tmdb', limit: 2, windowMs: 60_000 });
    const c = enforceRateLimit(request, { routeKey: 'tmdb', limit: 2, windowMs: 60_000 });

    expect(a.allowed).toBe(true);
    expect(b.allowed).toBe(true);
    expect(c.allowed).toBe(false);
    expect(c.headers['retry-after']).toBeDefined();
  });
});

