import { describe, expect, it } from 'vitest';
import {
  buildGoogleSearchQueries,
  mapGoogleBook,
  mergeBookMetadata,
  mapOpenLibraryBook,
  normalizeIsbn,
  parseBertrandBookPage,
  parsePresencaProductPayload,
  parsePresencaSearchResults,
  parseWookBookPage,
} from './books/[[path]].js';

describe('books ISBN mapping', () => {
  it('normalizes ISBN values consistently', () => {
    expect(normalizeIsbn('978-989-9254-27-5')).toBe('9789899254275');
    expect(normalizeIsbn('989-9254-27-X')).toBe('989925427X');
    expect(normalizeIsbn('invalid')).toBeNull();
  });

  it('builds direct Google Books ISBN searches for ISBN queries', () => {
    expect(buildGoogleSearchQueries('978-989-9254-27-5')).toEqual(['isbn:9789899254275']);
  });

  it('maps google books identifiers into isbn fields', () => {
    const result = mapGoogleBook({
      id: 'google-volume-id',
      volumeInfo: {
        title: 'Livro Teste',
        industryIdentifiers: [
          { type: 'OTHER', identifier: 'abc' },
          { type: 'ISBN_10', identifier: '989925427X' },
          { type: 'ISBN_13', identifier: '9789899254275' },
        ],
      },
    });

    expect(result.isbn).toBe('9789899254275');
    expect(result.isbn_13).toBe('9789899254275');
    expect(result.isbn_10).toBe('989925427X');
  });

  it('maps open library identifiers into isbn fields', () => {
    const result = mapOpenLibraryBook({
      key: '/works/OL123W',
      title: 'Livro OL',
      isbn: ['9789899254275', '989925427X'],
    });

    expect(result.isbn).toBe('9789899254275');
    expect(result.isbn_13).toBe('9789899254275');
    expect(result.isbn_10).toBe('989925427X');
  });

  it('replaces weak Google Books content cover URLs with stronger fallback covers', () => {
    const merged = mergeBookMetadata(
      {
        source_provider: 'google_books',
        poster_path: 'https://books.google.com/books/content?id=test&printsec=frontcover&img=1&zoom=3&source=gbs_api',
      },
      {
        source_provider: 'presenca',
        poster_path: 'https://cdn.shopify.com/s/files/1/teste.jpg?v=1',
      },
    );

    expect(merged.poster_path).toBe('https://cdn.shopify.com/s/files/1/teste.jpg?v=1');
  });
});

describe('books fallback parsers', () => {
  it('parses Bertrand product pages with matching ISBN', () => {
    const html = `
      <html>
        <head>
          <meta property="og:image" content="https://cdn.example.com/bertrand-cover.jpg" />
          <meta property="og:description" content="Sinopse curta Bertrand" />
          <script type="application/ld+json">
            {"@context":"https://schema.org","@type":"Book","isbn":"9789899254275","description":"Sinopse longa Bertrand","image":"https://cdn.example.com/bertrand-cover-large.jpg"}
          </script>
        </head>
      </html>
    `;

    const parsed = parseBertrandBookPage(html, 'https://www.bertrand.pt/livro/teste/123', '9789899254275');

    expect(parsed).toEqual({
      provider: 'bertrand',
      isbn: '9789899254275',
      result: expect.objectContaining({
        source_provider: 'bertrand',
        source_id: 'https://www.bertrand.pt/livro/teste/123',
        isbn: '9789899254275',
        overview: 'Sinopse longa Bertrand',
        poster_path: 'https://cdn.example.com/bertrand-cover-large.jpg',
      }),
    });
  });

  it('parses Wook product pages with matching ISBN', () => {
    const html = `
      <html>
        <head>
          <meta name="description" content="Sinopse Wook" />
          <meta property="og:image" content="/images/wook-cover.jpg" />
          <script type="application/ld+json">
            {"@context":"https://schema.org","@type":"Product","productID":"ISBN 9789899254275","description":"Sinopse Wook detalhada","image":{"url":"https://static.wook.pt/covers/large.jpg"}}
          </script>
        </head>
      </html>
    `;

    const parsed = parseWookBookPage(html, 'https://www.wook.pt/livro/teste/123', '9789899254275');

    expect(parsed).toEqual({
      provider: 'wook',
      isbn: '9789899254275',
      result: expect.objectContaining({
        source_provider: 'wook',
        source_id: 'https://www.wook.pt/livro/teste/123',
        isbn: '9789899254275',
        overview: 'Sinopse Wook detalhada',
        poster_path: 'https://static.wook.pt/covers/large.jpg',
      }),
    });
  });

  it('parses Presenca search results into a clean product handle', () => {
    const parsed = parsePresencaSearchResults([
      {
        title: 'Ganhei Uma Vida Quando Te Perdi - Edição Especial',
        handle: '/products/ganhei-uma-vida-quando-te-perdi-edicao-especial?_pos=1&_sid=test&_ss=r',
        featured_image: '//www.presenca.pt/cdn/shop/files/capa.jpg?v=1',
      },
    ], '9789899254787');

    expect(parsed).toEqual({
      handle: '/products/ganhei-uma-vida-quando-te-perdi-edicao-especial',
      title: 'Ganhei Uma Vida Quando Te Perdi - Edição Especial',
      imageUrl: 'https://www.presenca.pt/cdn/shop/files/capa.jpg?v=1',
    });
  });

  it('parses Presenca product payload with matching ISBN', () => {
    const parsed = parsePresencaProductPayload({
      description: '<p>Sinopse Presenca</p>',
      featured_image: '//cdn.shopify.com/s/files/1/teste.jpg?v=1',
      url: '/products/ganhei-uma-vida-quando-te-perdi-edicao-especial',
      variants: [
        {
          sku: '9789899254787',
          barcode: '9789899254787',
        },
      ],
    }, '9789899254787');

    expect(parsed).toEqual({
      provider: 'presenca',
      isbn: '9789899254787',
      result: expect.objectContaining({
        source_provider: 'presenca',
        source_id: 'https://www.presenca.pt/products/ganhei-uma-vida-quando-te-perdi-edicao-especial',
        isbn: '9789899254787',
        overview: 'Sinopse Presenca',
        poster_path: 'https://cdn.shopify.com/s/files/1/teste.jpg?v=1',
      }),
    });
  });

  it('rejects fallback pages when ISBN cannot be confirmed', () => {
    const html = `
      <html>
        <head>
          <meta property="og:image" content="https://cdn.example.com/cover.jpg" />
          <meta property="og:description" content="Sinopse sem ISBN" />
        </head>
      </html>
    `;

    expect(parseBertrandBookPage(html, 'https://www.bertrand.pt/livro/teste/123', '9789899254275')).toBeNull();
    expect(parseWookBookPage(html, 'https://www.wook.pt/livro/teste/123', '9789899254275')).toBeNull();
    expect(parsePresencaProductPayload({ variants: [{ sku: '9781111111111' }] }, '9789899254275')).toBeNull();
  });
});
