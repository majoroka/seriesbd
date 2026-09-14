import { describe, expect, it } from 'vitest';
import { hasMissingAiredEpisodeSynopsis, mergeEpisodeMetadataFallback } from './episodeMetadata';
import type { Episode } from './types';

function episode(overrides: Partial<Episode> = {}): Episode {
    return {
        air_date: '2020-01-01',
        episode_number: 1,
        id: 1,
        name: 'Episódio 1',
        overview: '',
        production_code: '',
        runtime: null,
        season_number: 1,
        show_id: 10,
        still_path: null,
        vote_average: 0,
        vote_count: 0,
        ...overrides,
    };
}

describe('episode metadata fallbacks', () => {
    it('requests enrichment only for already aired episodes without a meaningful synopsis', () => {
        expect(hasMissingAiredEpisodeSynopsis([episode()], new Date('2020-01-02'))).toBe(true);
        expect(hasMissingAiredEpisodeSynopsis([episode({ air_date: '2030-01-01' })], new Date('2020-01-02'))).toBe(false);
    });

    it('fills empty metadata without replacing Portuguese TMDb text', () => {
        const merged = mergeEpisodeMetadataFallback([
            episode(),
            episode({ id: 2, episode_number: 2, name: 'Título PT', overview: 'Sinopse em português.' }),
        ], [
            { episode_number: 1, air_date: '2020-01-01', name: 'Pilot', overview: '<p>English summary.</p>' },
            { episode_number: 2, air_date: '2020-01-01', name: 'English title', overview: 'English summary.' },
        ]);

        expect(merged[0]).toMatchObject({ name: 'Pilot', overview: 'English summary.' });
        expect(merged[1]).toMatchObject({ name: 'Título PT', overview: 'Sinopse em português.' });
    });

    it('does not merge a candidate with an incompatible air date', () => {
        const merged = mergeEpisodeMetadataFallback([episode()], [
            { episode_number: 1, air_date: '2020-01-08', name: 'Wrong episode', overview: 'Wrong summary.' },
        ]);

        expect(merged[0]).toMatchObject({ name: 'Episódio 1', overview: '' });
    });
});
