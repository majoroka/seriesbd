import { describe, expect, it } from 'vitest';
import { createContentShareText, createPublicContentShareUrl, getContentShareDestinations } from './contentShare';
import { toScopedMovieId } from './media';
import type { Series } from './types';

function createMedia(overrides: Partial<Series>): Series {
    return {
        id: 1,
        media_type: 'series',
        name: 'Conteúdo de teste',
        overview: '',
        poster_path: null,
        backdrop_path: null,
        first_air_date: '',
        genres: [],
        ...overrides,
    };
}

describe('public content sharing', () => {
    it('builds public catalog URLs without library or user state', () => {
        const origin = 'https://staging.seriesbd.pages.dev';
        const series = createMedia({ id: 1396, media_type: 'series', userRating: 10 });
        const movie = createMedia({
            id: toScopedMovieId(550),
            media_type: 'movie',
            source_provider: 'tmdb_movie',
            source_id: '550',
        });
        const book = createMedia({
            id: 2_123_456_789,
            media_type: 'book',
            source_provider: 'open_library',
            source_id: 'works/OL45804W',
        });

        expect(createPublicContentShareUrl(series, origin)).toBe(`${origin}/partilhar/serie/1396`);
        expect(createPublicContentShareUrl(movie, origin)).toBe(`${origin}/partilhar/filme/550`);
        expect(createPublicContentShareUrl(book, origin)).toBe(`${origin}/partilhar/livro/open_library/works%2FOL45804W`);
    });

    it('does not create a book URL without a supported public source', () => {
        const origin = 'https://mediadex.app';
        expect(createPublicContentShareUrl(createMedia({
            media_type: 'book',
            source_provider: 'presenca',
            source_id: '9789722322261',
        }), origin)).toBeNull();
        expect(createPublicContentShareUrl(createMedia({ media_type: 'book' }), origin)).toBeNull();
    });

    it('encodes destination URLs and never adds private state to the message', () => {
        const url = 'https://mediadex.app/partilhar/serie/1396';
        const text = createContentShareText(createMedia({ name: 'A Guerra dos Tronos' }));
        const destinations = getContentShareDestinations('A Guerra dos Tronos | MediaDex', text, url);

        expect(text).toBe('Descobre A Guerra dos Tronos no MediaDex.');
        expect(destinations.map((destination) => destination.id)).toEqual(['whatsapp', 'facebook', 'x', 'email']);
        expect(JSON.stringify(destinations)).not.toContain('userRating');
        expect(JSON.stringify(destinations)).not.toContain('watchlist');
        expect(destinations.find((destination) => destination.id === 'whatsapp')?.href).toContain(encodeURIComponent(url));
    });
});
