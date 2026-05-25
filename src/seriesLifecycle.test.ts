import { describe, expect, it } from 'vitest';
import { getSeriesArchiveRecommendation, getSeriesTotalEpisodesFromDetails, isSeriesStatusTerminal } from './seriesLifecycle';

describe('series lifecycle helpers', () => {
  it('treats ended and canceled series as terminal', () => {
    expect(isSeriesStatusTerminal('Ended')).toBe(true);
    expect(isSeriesStatusTerminal('Canceled')).toBe(true);
    expect(isSeriesStatusTerminal('Cancelled')).toBe(true);
    expect(isSeriesStatusTerminal('Returning Series')).toBe(false);
  });

  it('derives total episodes from non-special seasons only', () => {
    expect(
      getSeriesTotalEpisodesFromDetails({
        seasons: [
          { season_number: 0, episode_count: 3 },
          { season_number: 1, episode_count: 10 },
          { season_number: 2, episode_count: 8 },
        ] as any,
      }),
    ).toBe(18);
  });

  it('keeps an archived returning series in watchlist when more episodes are expected', () => {
    expect(
      getSeriesArchiveRecommendation({
        watchedCount: 20,
        totalEpisodes: 20,
        status: 'Returning Series',
        nextEpisodeToAir: null,
        isArchived: true,
      }),
    ).toBe('watchlist');
  });

  it('keeps an archived series in watchlist when watched count is below the known total', () => {
    expect(
      getSeriesArchiveRecommendation({
        watchedCount: 20,
        totalEpisodes: 30,
        status: 'Ended',
        nextEpisodeToAir: null,
        isArchived: true,
      }),
    ).toBe('watchlist');
  });

  it('archives only terminal completed series', () => {
    expect(
      getSeriesArchiveRecommendation({
        watchedCount: 12,
        totalEpisodes: 12,
        status: 'Ended',
        nextEpisodeToAir: null,
        isArchived: false,
      }),
    ).toBe('archive');
  });
});
