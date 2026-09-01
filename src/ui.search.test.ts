import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Series } from './types';
import { getSearchQuickCompletion } from './searchQuickCompletion';

const { searchResultsContainer, state } = vi.hoisted(() => ({
    searchResultsContainer: document.createElement('section'),
    state: {
        archive: [] as Series[],
        watchlist: [] as Series[],
    },
}));

vi.mock('./dom', () => ({
    searchResultsContainer,
}));

vi.mock('./state', () => ({
    get myArchive(): Series[] {
        return state.archive;
    },
    get myWatchlist(): Series[] {
        return state.watchlist;
    },
}));

import { renderSearchResults } from './ui';

function createResult(mediaType: Series['media_type']): Series {
    return {
        id: mediaType === 'series' ? 1 : mediaType === 'movie' ? 2 : 3,
        media_type: mediaType,
        name: `Resultado ${mediaType}`,
        overview: 'Sinopse de teste.',
        poster_path: null,
        backdrop_path: null,
        first_air_date: '2020-01-01',
        genres: [],
    };
}

describe('quick actions in search results', () => {
    beforeEach(() => {
        state.archive = [];
        state.watchlist = [];
        searchResultsContainer.replaceChildren();
        document.body.replaceChildren(searchResultsContainer);
    });

    it.each([
        ['series', 'Adicionar e Marcar Tudo Como Visto', 'fas fa-check-double'],
        ['movie', 'Adicionar e Marcar Como Visto', 'fas fa-check'],
        ['book', 'Adicionar e Marcar Como Lido', 'fas fa-check'],
    ] as const)('renders add and completion actions for %s', (mediaType, completionTitle, iconClass) => {
        const result = createResult(mediaType);

        renderSearchResults([result]);

        const addButton = searchResultsContainer.querySelector<HTMLButtonElement>('.add-media-quick-btn');
        const completionButton = searchResultsContainer.querySelector<HTMLButtonElement>('.complete-media-quick-btn');
        expect(addButton?.dataset.mediaId).toBe(String(result.id));
        expect(addButton?.dataset.mediaType).toBe(mediaType);
        expect(completionButton?.title).toBe(completionTitle);
        expect(completionButton?.dataset.mediaId).toBe(String(result.id));
        expect(completionButton?.dataset.mediaType).toBe(mediaType);
        expect(completionButton?.querySelector('i')?.className).toBe(iconClass);
    });

    it('replaces quick actions with the library label when the result is archived', () => {
        const movie = createResult('movie');
        state.archive = [movie];

        renderSearchResults([movie]);

        expect(searchResultsContainer.querySelector('.in-library-label')?.textContent).toContain('Na Biblioteca');
        expect(searchResultsContainer.querySelector('.add-media-quick-btn')).toBeNull();
        expect(searchResultsContainer.querySelector('.complete-media-quick-btn')).toBeNull();
    });

    it('maps movies and books to 100% progress, while series use released episodes', () => {
        expect(getSearchQuickCompletion('series')).toMatchObject({ mode: 'released-episodes' });
        expect(getSearchQuickCompletion('movie')).toMatchObject({ mode: 'progress', progressPercent: 100 });
        expect(getSearchQuickCompletion('book')).toMatchObject({ mode: 'progress', progressPercent: 100 });
    });
});
