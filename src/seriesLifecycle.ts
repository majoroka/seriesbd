import type { Episode, TMDbSeriesDetails } from './types';

export type SeriesArchiveRecommendation = 'archive' | 'watchlist' | 'unchanged';
export type SeriesLibraryLifecycleStatus = 'watchlist' | 'unseen' | 'archive';

type SeriesLifecycleSnapshot = {
  watchedCount: number;
  totalEpisodes: number;
  releasedEpisodes?: number | null;
  status: string | null | undefined;
  nextEpisodeToAir: Episode | null | undefined;
  firstAirDate?: string | null | undefined;
  isArchived: boolean;
};

export type SeriesLifecycleInput = Omit<SeriesLifecycleSnapshot, 'isArchived'>;

function parseDateOnly(value: string | null | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isDateInPastOrToday(value: string | null | undefined): boolean {
  const parsed = parseDateOnly(value);
  if (!parsed) return false;
  const today = new Date();
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return parsed.getTime() <= todayUtc;
}

function isDateInFuture(value: string | null | undefined): boolean {
  const parsed = parseDateOnly(value);
  if (!parsed) return false;
  const today = new Date();
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return parsed.getTime() > todayUtc;
}

function hasImplicitReleasedEpisodesBeforeNext(snapshot: SeriesLifecycleSnapshot): boolean {
  const nextEpisode = snapshot.nextEpisodeToAir;
  if (!nextEpisode) return false;
  if (!isDateInFuture(nextEpisode.air_date)) return false;
  if (nextEpisode.season_number <= 0) return false;
  return nextEpisode.episode_number > 1;
}

function getImplicitReleasedEpisodeCountBeforeNext(snapshot: SeriesLifecycleSnapshot): number | null {
  if (!hasImplicitReleasedEpisodesBeforeNext(snapshot)) return null;
  const nextEpisode = snapshot.nextEpisodeToAir;
  if (!nextEpisode) return null;
  if (
    nextEpisode.episode_number === 2
    && typeof snapshot.releasedEpisodes === 'number'
    && snapshot.watchedCount === snapshot.releasedEpisodes
    && snapshot.watchedCount < snapshot.totalEpisodes
  ) {
    return snapshot.releasedEpisodes + 1;
  }
  if (snapshot.totalEpisodes > snapshot.watchedCount) return null;
  return snapshot.totalEpisodes + (nextEpisode.episode_number - 1);
}

export function getSeriesImplicitEpisodeCount(snapshot: SeriesLifecycleInput): number | null {
  return getImplicitReleasedEpisodeCountBeforeNext({ ...snapshot, isArchived: false });
}

function hasPremiered(firstAirDate: string | null | undefined): boolean {
  const premiereDate = parseDateOnly(firstAirDate);
  if (!premiereDate) return true;
  const today = new Date();
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return premiereDate.getTime() <= todayUtc;
}

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

export function getSeriesReleasedEpisodesFromDetails(
  details: Pick<TMDbSeriesDetails, 'seasons' | 'last_episode_to_air' | 'status' | 'first_air_date'>,
): number {
  if (!hasPremiered(details.first_air_date)) return 0;

  const totalEpisodes = getSeriesTotalEpisodesFromDetails(details);
  const lastEpisodeToAir = details.last_episode_to_air;

  if (lastEpisodeToAir && lastEpisodeToAir.season_number > 0 && lastEpisodeToAir.episode_number > 0) {
    const releasedBeforeCurrentSeason = details.seasons
      ? details.seasons
          .filter((season) => season.season_number !== 0 && season.season_number < lastEpisodeToAir.season_number)
          .reduce((acc, season) => acc + season.episode_count, 0)
      : 0;

    return Math.min(totalEpisodes || Number.MAX_SAFE_INTEGER, releasedBeforeCurrentSeason + lastEpisodeToAir.episode_number);
  }

  if (isSeriesStatusTerminal(details.status)) {
    return totalEpisodes;
  }

  return 0;
}

export function getEffectiveReleasedEpisodeCount(snapshot: SeriesLifecycleInput): number | null {
  if (typeof snapshot.releasedEpisodes === 'number' && snapshot.releasedEpisodes >= 0) {
    if (
      snapshot.nextEpisodeToAir?.air_date
      && isDateInPastOrToday(snapshot.nextEpisodeToAir.air_date)
      && snapshot.totalEpisodes > snapshot.releasedEpisodes
    ) {
      return Math.min(snapshot.totalEpisodes, snapshot.releasedEpisodes + 1);
    }
    return snapshot.releasedEpisodes;
  }

  if (!hasPremiered(snapshot.firstAirDate)) {
    return 0;
  }

  if (isSeriesStatusTerminal(snapshot.status) && snapshot.totalEpisodes > 0) {
    return snapshot.totalEpisodes;
  }

  return null;
}

export function getSeriesLibraryStatus(snapshot: Omit<SeriesLifecycleSnapshot, 'isArchived'>): SeriesLibraryLifecycleStatus {
  const { watchedCount, totalEpisodes } = snapshot;
  const releasedEpisodes = getEffectiveReleasedEpisodeCount(snapshot);

  if (releasedEpisodes !== null) {
    if (releasedEpisodes <= 0 || watchedCount <= 0) return 'watchlist';
    if (watchedCount < releasedEpisodes) return 'unseen';
    if (!isSeriesStatusTerminal(snapshot.status)) {
      const implicitReleasedCount = getImplicitReleasedEpisodeCountBeforeNext(snapshot);
      if (implicitReleasedCount !== null) {
        return watchedCount < implicitReleasedCount ? 'unseen' : 'archive';
      }
    }
    return 'archive';
  }

  if (watchedCount <= 0) return 'watchlist';
  if (!isSeriesStatusTerminal(snapshot.status)) {
    const implicitReleasedCount = getImplicitReleasedEpisodeCountBeforeNext(snapshot);
    if (implicitReleasedCount !== null) {
      return watchedCount < implicitReleasedCount ? 'unseen' : 'archive';
    }
  }
  if (totalEpisodes > 0 && watchedCount < totalEpisodes) return 'unseen';
  return 'archive';
}

export function getSeriesUnwatchedReleasedCount(snapshot: SeriesLifecycleInput): number {
  const releasedEpisodes = getEffectiveReleasedEpisodeCount(snapshot);
  if (releasedEpisodes === null || releasedEpisodes <= 0) return 0;
  return Math.max(0, releasedEpisodes - snapshot.watchedCount);
}

export function getSeriesUnwatchedBadgeCount(snapshot: SeriesLifecycleInput): number {
  const implicitEpisodeCount = getSeriesImplicitEpisodeCount(snapshot);
  const knownEpisodeCount = Math.max(
    snapshot.totalEpisodes || 0,
    snapshot.releasedEpisodes || 0,
    implicitEpisodeCount || 0,
  );
  if (knownEpisodeCount <= 0) return 0;
  return Math.max(0, knownEpisodeCount - snapshot.watchedCount);
}

export function getSeriesArchiveRecommendation(snapshot: SeriesLifecycleSnapshot): SeriesArchiveRecommendation {
  const desiredStatus = getSeriesLibraryStatus(snapshot);
  if (desiredStatus === 'archive') {
    return snapshot.isArchived ? 'unchanged' : 'archive';
  }
  if (snapshot.isArchived) {
    return 'watchlist';
  }
  return 'unchanged';
}
