import type { Episode } from './types';

export type EpisodeMetadataCandidate = Pick<Episode, 'episode_number' | 'air_date'> & {
    name?: string | null;
    overview?: string | null;
};

const EMPTY_OVERVIEWS = new Set([
    '',
    'sinopse não disponível.',
    'sinopse nao disponivel.',
    'overview not available.',
    'no overview available.',
    'n/a',
]);

export function normalizeEpisodeText(value: unknown): string {
    return String(value || '')
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<\/p>/gi, ' ')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'")
        .replace(/\s+/g, ' ')
        .trim();
}

export function hasMeaningfulEpisodeOverview(value: unknown): boolean {
    const normalized = normalizeEpisodeText(value);
    return Boolean(normalized) && !EMPTY_OVERVIEWS.has(normalized.toLowerCase());
}

export function isGenericEpisodeTitle(value: unknown, episodeNumber: number): boolean {
    const title = normalizeEpisodeText(value).toLowerCase();
    if (!title) return true;
    return new RegExp(`^(epis[oó]dio|episode)\\s+0*${episodeNumber}$`, 'i').test(title);
}

export function isEpisodeAlreadyAired(airDate: string | null | undefined, now = new Date()): boolean {
    if (!airDate) return false;
    const releasedAt = new Date(`${airDate}T23:59:59`);
    return Number.isFinite(releasedAt.getTime()) && releasedAt.getTime() <= now.getTime();
}

export function hasMissingAiredEpisodeSynopsis(episodes: Episode[], now = new Date()): boolean {
    return episodes.some((episode) =>
        isEpisodeAlreadyAired(episode.air_date, now) && !hasMeaningfulEpisodeOverview(episode.overview)
    );
}

function haveCompatibleAirDates(baseDate: string | null | undefined, candidateDate: string | null | undefined): boolean {
    if (!baseDate || !candidateDate) return true;
    return baseDate === candidateDate;
}

/**
 * Only fills absent episode metadata. Matching requires episode number and,
 * when both sources provide it, the same original air date.
 */
export function mergeEpisodeMetadataFallback(
    baseEpisodes: Episode[],
    candidates: EpisodeMetadataCandidate[],
): Episode[] {
    const candidatesByNumber = new Map(candidates.map((candidate) => [candidate.episode_number, candidate]));

    return baseEpisodes.map((episode) => {
        const candidate = candidatesByNumber.get(episode.episode_number);
        if (!candidate || !haveCompatibleAirDates(episode.air_date, candidate.air_date)) return episode;

        const nextOverview = hasMeaningfulEpisodeOverview(episode.overview)
            ? episode.overview
            : normalizeEpisodeText(candidate.overview);
        const nextName = isGenericEpisodeTitle(episode.name, episode.episode_number) && normalizeEpisodeText(candidate.name)
            ? normalizeEpisodeText(candidate.name)
            : episode.name;

        if (nextOverview === episode.overview && nextName === episode.name) return episode;
        return { ...episode, overview: nextOverview, name: nextName };
    });
}
