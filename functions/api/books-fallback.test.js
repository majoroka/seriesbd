import { describe, expect, it } from 'vitest';
import {
  buildGoogleSearchQueries,
  mapGoogleBook,
  mergeBookMetadata,
  mapOpenLibraryBook,
  normalizeIsbn,
  parseGoodreadsBookPage,
  parseGoodreadsSearchResults,
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

  it('replaces weak truncated overviews with richer fallback synopses', () => {
    const merged = mergeBookMetadata(
      {
        source_provider: 'google_books',
        overview: 'Nas escadarias do Museu Egípcio, em pleno Cairo, Tomás...',
      },
      {
        source_provider: 'goodreads',
        overview: 'Nas escadarias do Museu Egípcio, em pleno Cairo, Tomás Noronha é subitamente envolvido numa investigação complexa que o conduz por um labirinto de segredos científicos, religiosos e históricos.',
      },
    );

    expect(merged.overview).toBe('Nas escadarias do Museu Egípcio, em pleno Cairo, Tomás Noronha é subitamente envolvido numa investigação complexa que o conduz por um labirinto de segredos científicos, religiosos e históricos.');
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

  it('parses Goodreads search results into clean product URLs', () => {
    const html = `
      <html>
        <body>
          <a class="bookTitle" href="/book/show/49634616-ganhei-uma-vida-quando-te-perdi?from_search=true&amp;rank=1">
            <span>Ganhei uma vida quando te perdi</span>
          </a>
          <a class="bookTitle" href="/book/show/222199303-ganhei-uma-vida-quando-te-perdi?from_search=true&amp;rank=2">
            <span>Ganhei Uma Vida Quando Te Perdi</span>
          </a>
        </body>
      </html>
    `;

    expect(parseGoodreadsSearchResults(html)).toEqual([
      {
        author: '',
        imageUrl: null,
        productUrl: 'https://www.goodreads.com/book/show/49634616-ganhei-uma-vida-quando-te-perdi',
        title: 'Ganhei uma vida quando te perdi',
      },
      {
        author: '',
        imageUrl: null,
        productUrl: 'https://www.goodreads.com/book/show/222199303-ganhei-uma-vida-quando-te-perdi',
        title: 'Ganhei Uma Vida Quando Te Perdi',
      },
    ]);
  });

  it('parses Goodreads book pages with matching title and extracts cover and synopsis', () => {
    const html = `
      <html>
        <head>
          <meta name="description" content="Read 160 reviews. Como é que se esquece alguém?" />
          <meta property="og:description" content="Como é que se esquece alguém? Quando Alice decide esquecer..." />
          <meta property="og:image" content="https://m.media-amazon.com/images/S/compressed.photo.goodreads.com/books/1576959857i/49634616.jpg" />
          <script type="application/ld+json">
            {"@context":"https://schema.org","@type":"Book","name":"Ganhei uma vida quando te perdi","image":"https://m.media-amazon.com/images/S/compressed.photo.goodreads.com/books/1576959857i/49634616.jpg","isbn":"9789899254787"}
          </script>
        </head>
        <body>
          <div data-testid="description" class="BookPageMetadataSection__description">
            <div class="TruncatedContent__text TruncatedContent__text--large">
              <span class="Formatted">Como é que se esquece alguém? Quando Alice decide esquecer Tomás, percebe que o fim também pode ser um começo.<br />Esta é a versão completa da sinopse.</span>
            </div>
          </div>
        </body>
      </html>
    `;

    const parsed = parseGoodreadsBookPage(
      html,
      'https://www.goodreads.com/book/show/49634616-ganhei-uma-vida-quando-te-perdi?from_search=true',
      'Ganhei uma vida quando te perdi',
      '9789899254787',
    );

    expect(parsed).toEqual({
      provider: 'goodreads',
      isbn: '9789899254787',
      result: expect.objectContaining({
        source_provider: 'goodreads',
        source_id: 'https://www.goodreads.com/book/show/49634616-ganhei-uma-vida-quando-te-perdi',
        name: 'Ganhei uma vida quando te perdi',
        author: '',
        isbn: '9789899254787',
        overview: 'Como é que se esquece alguém? Quando Alice decide esquecer Tomás, percebe que o fim também pode ser um começo. Esta é a versão completa da sinopse.',
        poster_path: 'https://m.media-amazon.com/images/S/compressed.photo.goodreads.com/books/1576959857i/49634616.jpg',
      }),
    });
  });

  it('accepts Goodreads titles with series suffixes or parenthetical expansions', () => {
    const html = `
      <html>
        <head>
          <meta property="og:description" content="Sinopse Goodreads com metadados completos." />
          <meta property="og:image" content="https://m.media-amazon.com/images/S/compressed.photo.goodreads.com/books/1234567890i/2430907.jpg" />
          <script type="application/ld+json">
            {"@context":"https://schema.org","@type":"Book","name":"A fórmula de Deus (Tomás Noronha, #2)","image":"https://m.media-amazon.com/images/S/compressed.photo.goodreads.com/books/1234567890i/2430907.jpg"}
          </script>
        </head>
        <body>
          <div data-testid="description">
            <span class="Formatted">Nas escadarias do Museu Egípcio, em pleno Cairo, Tomás Noronha é convocado para uma investigação que o levará ao coração da ciência e da fé.</span>
          </div>
        </body>
      </html>
    `;

    const parsed = parseGoodreadsBookPage(
      html,
      'https://www.goodreads.com/book/show/2430907.A_F_rmula_de_Deus?from_search=true',
      'A fórmula de Deus',
      null,
    );

    expect(parsed).toEqual({
      provider: 'goodreads',
      isbn: null,
      result: expect.objectContaining({
        source_provider: 'goodreads',
        source_id: 'https://www.goodreads.com/book/show/2430907.A_F_rmula_de_Deus',
        name: 'A fórmula de Deus (Tomás Noronha, #2)',
        author: '',
        overview: 'Nas escadarias do Museu Egípcio, em pleno Cairo, Tomás Noronha é convocado para uma investigação que o levará ao coração da ciência e da fé.',
        poster_path: 'https://m.media-amazon.com/images/S/compressed.photo.goodreads.com/books/1234567890i/2430907.jpg',
      }),
    });
  });

  it('prefers Portuguese Goodreads descriptions over longer English variants', () => {
    const html = `
      <html>
        <head>
          <meta property="og:image" content="https://m.media-amazon.com/images/S/compressed.photo.goodreads.com/books/1234567890i/2430907.jpg" />
          <script type="application/ld+json">
            {"@context":"https://schema.org","@type":"Book","name":"A fórmula de Deus","image":"https://m.media-amazon.com/images/S/compressed.photo.goodreads.com/books/1234567890i/2430907.jpg"}
          </script>
        </head>
        <body>
          <div data-testid="description">
            <span class="Formatted">This novel follows Tomás Noronha through a long investigation about science, faith, and the origins of the universe in a sweeping international thriller.</span>
            <span class="Formatted">Nas escadarias do Museu Egípcio, em pleno Cairo, Tomás Noronha é arrastado para uma investigação sobre ciência, fé e a origem do universo.</span>
          </div>
        </body>
      </html>
    `;

    const parsed = parseGoodreadsBookPage(
      html,
      'https://www.goodreads.com/book/show/2430907.A_F_rmula_de_Deus?from_search=true',
      'A fórmula de Deus',
      null,
    );

    expect(parsed).toEqual({
      provider: 'goodreads',
      isbn: null,
      result: expect.objectContaining({
        source_provider: 'goodreads',
        source_id: 'https://www.goodreads.com/book/show/2430907.A_F_rmula_de_Deus',
        name: 'A fórmula de Deus',
        author: '',
        overview: 'Nas escadarias do Museu Egípcio, em pleno Cairo, Tomás Noronha é arrastado para uma investigação sobre ciência, fé e a origem do universo.',
        poster_path: 'https://m.media-amazon.com/images/S/compressed.photo.goodreads.com/books/1234567890i/2430907.jpg',
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
    expect(parseGoodreadsBookPage(html, 'https://www.goodreads.com/book/show/teste', 'Ganhei uma vida quando te perdi', '9789899254275')).toBeNull();
  });
});
