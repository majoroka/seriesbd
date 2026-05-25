import { describe, expect, it } from 'vitest';
import {
  getSeriesArchiveRecommendation,
  getSeriesLibraryStatus,
  getSeriesReleasedEpisodesFromDetails,
  getSeriesTotalEpisodesFromDetails,
  isSeriesStatusTerminal,
} from './seriesLifecycle';

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

  it('derives released episodes from last aired metadata', () => {
    expect(
      getSeriesReleasedEpisodesFromDetails({
        first_air_date: '2024-01-01',
        status: 'Returning Series',
        last_episode_to_air: {
          season_number: 3,
          episode_number: 4,
        } as any,
        seasons: [
          { season_number: 0, episode_count: 2 },
          { season_number: 1, episode_count: 10 },
          { season_number: 2, episode_count: 8 },
          { season_number: 3, episode_count: 10 },
        ] as any,
      }),
    ).toBe(22);
  });

  it('keeps unreleased in-production series in watchlist', () => {
    expect(
      getSeriesLibraryStatus({
        watchedCount: 0,
        totalEpisodes: 0,
        releasedEpisodes: 0,
        status: 'In Production',
        nextEpisodeToAir: null,
        firstAirDate: '2030-01-01',
      }),
    ).toBe('watchlist');
  });

  it('puts active series with unseen released episodes in progress', () => {
    expect(
      getSeriesLibraryStatus({
        watchedCount: 8,
        totalEpisodes: 20,
        releasedEpisodes: 10,
        status: 'Returning Series',
        nextEpisodeToAir: { id: 1 } as any,
        firstAirDate: '2020-01-01',
      }),
    ).toBe('unseen');
  });

  it('treats returning series with all released episodes watched as completed', () => {
    expect(
      getSeriesLibraryStatus({
        watchedCount: 10,
        totalEpisodes: 20,
        releasedEpisodes: 10,
        status: 'Returning Series',
        nextEpisodeToAir: { id: 1 } as any,
        firstAirDate: '2020-01-01',
      }),
    ).toBe('archive');
  });

  it('treats a stale next episode that has already aired as in progress', () => {
    expect(
      getSeriesLibraryStatus({
        watchedCount: 30,
        totalEpisodes: 40,
        releasedEpisodes: 30,
        status: 'Returning Series',
        nextEpisodeToAir: { air_date: '2026-04-19' } as any,
        firstAirDate: '2020-01-01',
      }),
    ).toBe('unseen');
  });

  it('treats a future episode 2 as proof that episode 1 is already released', () => {
    expect(
      getSeriesLibraryStatus({
        watchedCount: 30,
        totalEpisodes: 40,
        releasedEpisodes: 30,
        status: 'Returning Series',
        nextEpisodeToAir: {
          season_number: 4,
          episode_number: 2,
          air_date: '2030-04-26',
        } as any,
        firstAirDate: '2020-01-01',
      }),
    ).toBe('unseen');
  });

  it('keeps an archived series in watchlist when released episodes are still pending', () => {
    expect(
      getSeriesArchiveRecommendation({
        watchedCount: 20,
        totalEpisodes: 30,
        releasedEpisodes: 22,
        status: 'Returning Series',
        nextEpisodeToAir: null,
        firstAirDate: '2020-01-01',
        isArchived: true,
      }),
    ).toBe('watchlist');
  });

  it('keeps terminal incomplete series in watchlist', () => {
    expect(
      getSeriesArchiveRecommendation({
        watchedCount: 20,
        totalEpisodes: 30,
        releasedEpisodes: 30,
        status: 'Ended',
        nextEpisodeToAir: null,
        firstAirDate: '2020-01-01',
        isArchived: true,
      }),
    ).toBe('watchlist');
  });

  it('archives completed terminal series', () => {
    expect(
      getSeriesArchiveRecommendation({
        watchedCount: 12,
        totalEpisodes: 12,
        releasedEpisodes: 12,
        status: 'Ended',
        nextEpisodeToAir: null,
        firstAirDate: '2020-01-01',
        isArchived: false,
      }),
    ).toBe('archive');
  });
});
