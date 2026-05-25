import type { Episode, TMDbSeriesDetails } from './types';

export type SeriesArchiveRecommendation = 'archive' | 'watchlist' | 'unchanged';

type SeriesLifecycleSnapshot = {
  watchedCount: number;
  totalEpisodes: number;
  status: string | null | undefined;
  nextEpisodeToAir: Episode | null | undefined;
  isArchived: boolean;
};

export function isSeriesStatusTerminal(status: string | null | undefined): boolean {
  const normalized = (status || '').trim().toLowerCase();
  return normalized === 'ended' || normalized === 'canceled' || normalized === 'cancelled';
}

export function getSeriesTotalEpisodesFromDetails(details: Pick<TMDbSeriesDetails, 'seasons'>): number {
  return details.seasons
    ? details.seasons
        .filter((season) => season.season_number !== 0)
        .reduce((acc, season) => acc + season.episode_count, 0)
    : 0;
}

export function getSeriesArchiveRecommendation(snapshot: SeriesLifecycleSnapshot): SeriesArchiveRecommendation {
  const { watchedCount, totalEpisodes, status, nextEpisodeToAir, isArchived } = snapshot;

  if (totalEpisodes > 0 && watchedCount < totalEpisodes) {
    return isArchived ? 'watchlist' : 'unchanged';
  }

  const terminal = isSeriesStatusTerminal(status);
  const hasFutureLifecycle = Boolean(nextEpisodeToAir) || (!!status && !terminal);

  if (hasFutureLifecycle) {
    return isArchived ? 'watchlist' : 'unchanged';
  }

  if (totalEpisodes > 0 && watchedCount >= totalEpisodes && terminal) {
    return isArchived ? 'unchanged' : 'archive';
  }

  return 'unchanged';
}
