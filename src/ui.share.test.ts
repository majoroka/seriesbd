import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Series, TMDbCredits, TMDbSeriesDetails } from './types';

const { detailSection } = vi.hoisted(() => ({
    detailSection: document.createElement('section'),
}));

vi.mock('./dom', () => ({
    seriesViewSection: detailSection,
}));

import { renderMediaDetails, renderSeriesDetails } from './ui';

function createMedia(overrides: Partial<Series>): Series {
    return {
        id: 1,
        media_type: 'movie',
        name: 'Conteúdo de teste',
        overview: 'Sinopse pública de teste.',
        poster_path: null,
        backdrop_path: null,
        first_air_date: '2020-01-01',
        genres: [],
        ...overrides,
    };
}

function createSeries(): TMDbSeriesDetails {
    return {
        ...createMedia({ id: 1396, media_type: 'series', name: 'Breaking Bad', source_provider: 'tmdb_tv' }),
        created_by: [],
        next_episode_to_air: null,
        last_episode_to_air: null,
        episode_run_time: [45],
        networks: [],
        production_companies: [],
        production_countries: [],
        seasons: [],
        spoken_languages: [],
        status: 'Ended',
        vote_average: 9.5,
        videos: { results: [] },
    };
}

const emptyCredits: TMDbCredits = { cast: [], crew: [] };

function expectShareMenu(path: string): void {
    const shareButton = detailSection.querySelector<HTMLButtonElement>('#content-share-btn');
    const menu = detailSection.querySelector<HTMLElement>('#content-share-menu');
    expect(shareButton).not.toBeNull();
    expect(shareButton?.dataset.shareUrl).toContain(path);
    expect(shareButton?.getAttribute('aria-haspopup')).toBe('menu');
    expect(menu?.hidden).toBe(true);
    expect(menu?.querySelector('[data-share-copy]')).not.toBeNull();
    expect(menu?.querySelectorAll('a[role="menuitem"]')).toHaveLength(4);
}

describe('share action in content details', () => {
    beforeEach(() => {
        detailSection.replaceChildren();
        document.body.replaceChildren(detailSection);
    });

    it('renders sharing for a movie without removing its existing library actions', () => {
        renderMediaDetails(createMedia({
            id: 1_000_000_238,
            media_type: 'movie',
            source_provider: 'tmdb_movie',
            source_id: '238',
            name: 'O Padrinho',
        }), { progressPercent: 0, isInLibrary: true, isArchived: false });

        expectShareMenu('/partilhar/filme/238');
        expect(detailSection.querySelector('#back-to-previous-section-btn')).not.toBeNull();
        expect(detailSection.querySelector('#media-refresh-details-btn')).not.toBeNull();
        expect(detailSection.querySelector('#media-archive-toggle-btn')).not.toBeNull();
        expect(detailSection.querySelector('#media-remove-from-library-btn')).not.toBeNull();
    });

    it('renders sharing for a supported book without removing reading controls', () => {
        renderMediaDetails(createMedia({
            id: 2_123_456_789,
            media_type: 'book',
            source_provider: 'open_library',
            source_id: 'works/OL45804W',
            name: 'Livro Público',
        }), { progressPercent: 30, isInLibrary: false, isArchived: false });

        expectShareMenu('/partilhar/livro/open_library/works%2FOL45804W');
        expect(detailSection.querySelector('#media-add-watchlist-btn')).not.toBeNull();
        expect(detailSection.querySelector('#book-progress-save-btn')).not.toBeNull();
    });

    it('renders sharing for a series without removing existing series actions', () => {
        renderSeriesDetails(createSeries(), [], emptyCredits, null, null, null);

        expectShareMenu('/partilhar/serie/1396');
        expect(detailSection.querySelector('#back-to-previous-section-btn')).not.toBeNull();
        expect(detailSection.querySelector('#mark-all-seen-btn')).not.toBeNull();
        expect(detailSection.querySelector('#refresh-metadata-btn')).not.toBeNull();
        expect(detailSection.querySelector('#v2-remove-series-btn')).not.toBeNull();
        expect(detailSection.querySelector('#add-to-watchlist-btn')).not.toBeNull();
    });

    it('keeps sharing available but hides mutating actions in a public detail', () => {
        renderMediaDetails(createMedia({
            id: 1_000_000_238,
            media_type: 'movie',
            source_provider: 'tmdb_movie',
            source_id: '238',
        }), { progressPercent: 0, isInLibrary: false, isArchived: false, isPublicView: true });

        expectShareMenu('/partilhar/filme/238');
        expect(detailSection.querySelector('#media-add-watchlist-btn')).toBeNull();
        expect(detailSection.querySelector('#movie-toggle-seen-btn')).toBeNull();
        expect(detailSection.querySelector('.user-rating-container')).toBeNull();
    });
});
