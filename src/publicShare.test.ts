import { describe, expect, it } from 'vitest';
import { createPublicShareMedia, isPublicSharePath, parsePublicShareRoute } from './publicShare';

describe('public share routes', () => {
  it('parses series and movie routes only when their TMDb id is valid', () => {
    expect(parsePublicShareRoute('/partilhar/serie/1396')).toEqual({ mediaType: 'series', tmdbId: 1396 });
    expect(parsePublicShareRoute('/partilhar/filme/550')).toEqual({ mediaType: 'movie', tmdbId: 550 });
    expect(parsePublicShareRoute('/partilhar/serie/0')).toBeNull();
    expect(parsePublicShareRoute('/partilhar/filme/not-a-number')).toBeNull();
    expect(parsePublicShareRoute('/partilhar/serie/1396/extra')).toBeNull();
  });

  it('parses supported book providers and safely decodes their catalog id', () => {
    expect(parsePublicShareRoute('/partilhar/livro/open_library/works%2FOL45804W')).toEqual({
      mediaType: 'book',
      provider: 'open_library',
      sourceId: 'works/OL45804W',
    });
    expect(parsePublicShareRoute('/partilhar/livro/unknown/abc')).toBeNull();
    expect(parsePublicShareRoute('/partilhar/livro/open_library/%E0%A4%A')).toBeNull();
  });

  it('recognizes invalid share paths so the app can show a generic public error', () => {
    expect(isPublicSharePath('/partilhar/serie/invalid')).toBe(true);
    expect(isPublicSharePath('/biblioteca')).toBe(false);
  });

  it('creates transient catalog media without any user or library state', () => {
    const movie = createPublicShareMedia({ mediaType: 'movie', tmdbId: 550 });
    const book = createPublicShareMedia({ mediaType: 'book', provider: 'google_books', sourceId: 'abc123' });

    expect(movie).toMatchObject({ media_type: 'movie', source_id: '550', name: 'Filme partilhado' });
    expect(book).toMatchObject({ media_type: 'book', source_provider: 'google_books', source_id: 'abc123' });
    expect(movie).not.toHaveProperty('userRating');
    expect(book).not.toHaveProperty('userRating');
  });
});
