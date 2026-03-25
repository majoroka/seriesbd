export interface Genre {
    id: number;
    name: string;
}

export interface Episode {
    air_date: string;
    episode_number: number;
    id: number;
    name: string;
    overview: string;
    production_code: string;
    runtime: number | null;
    season_number: number;
    show_id: number;
    still_path: string | null;
    vote_average: number;
    vote_count: number;
}

export interface Season {
    air_date: string;
    episode_count: number;
    id: number;
    name: string;
    overview: string;
    poster_path: string | null;
    season_number: number;
}

export interface TMDbSeason extends Season {
    episodes: Episode[];
}

export type MediaType = 'series' | 'movie' | 'book';
export type NewsMediaTypeHint = MediaType | 'general';

export interface DashboardNewsItem {
    id: string;
    title: string;
    url: string;
    source: string;
    sourceKey: string;
    publishedAt: string | null;
    mediaTypeHint: NewsMediaTypeHint;
    imageUrl: string | null;
    summary: string;
}

export interface DashboardNewsResponse {
    ok: boolean;
    items: DashboardNewsItem[];
    meta?: {
        total?: number;
        requestedType?: string;
        limit?: number;
        generatedAt?: string;
        partialFailure?: boolean;
        sources?: Array<{
            key: string;
            source: string;
            ok: boolean;
            itemCount?: number;
            error?: string;
        }>;
    };
}

export interface ExternalReview {
    id: string;
    source: string;
    sourceKey: string;
    author: string;
    authorUrl?: string | null;
    rating?: number | null;
    createdAt?: string | null;
    updatedAt?: string | null;
    content: string;
    url?: string | null;
    language?: string | null;
}

export interface Series {
    id: number;
    media_type: MediaType;
    source_provider?: 'tmdb_tv' | 'tmdb_movie' | 'google_books' | 'open_library' | 'presenca';
    source_id?: string;
    isbn?: string;
    isbn_13?: string | null;
    isbn_10?: string | null;
    name: string;
    original_name?: string;
    overview: string;
    poster_path: string | null;
    backdrop_path: string | null;
    first_air_date: string;
    genres: Genre[];
    vote_average?: number;
    total_episodes?: number;
    episode_run_time?: number;
    _details?: {
        next_episode_to_air: Episode | null;
        status: string;
    };
    videos?: {
        results: { key: string; site: string; type: string; official?: boolean }[];
    };
    _lastUpdated?: string;
    userRating?: number;
}

export interface TMDbSeriesDetails extends Omit<Series, 'episode_run_time' | '_details'> {
    created_by: { id: number; name: string; profile_path: string | null }[];
    next_episode_to_air: Episode | null;
    episode_run_time: number[]; // This conflicts with Series, but we handle it in the mapping
    networks: { id: number; name: string; logo_path: string | null }[];
    production_companies: { id: number; name: string }[];
    production_countries: { iso_3166_1: string; name: string }[];
    seasons: Season[];
    spoken_languages: { english_name: string; name: string }[];
    status: string;
    vote_average: number;
    videos: { results: { key: string; site: string; type: string; official: boolean }[] };
    external_ids?: { imdb_id: string | null };
}

export interface TMDbPerson {
    id: number;
    name: string;
    profile_path: string | null;
    roles: { character: string }[];
}

export interface TMDbCredits {
    cast: TMDbPerson[];
}

export interface TraktRatings {
    rating: number;
    votes: number;
}

export interface TraktData {
    ratings: TraktRatings | null;
    trailerKey: string | null;
    traktId?: number;
    overview: string | null;
    certification: string | null;
}

export interface TraktSeason {
    number: number;
    episodes: { number: number; overview: string | null }[];
    images?: { poster?: { thumb?: string; full?: string } };
}

export interface TVMazeShow {
    id: number;
    name: string | null;
    language: string | null;
    premiered: string | null;
    status: string | null;
    type: string | null;
    genres: string[];
    url: string | null;
    officialSite: string | null;
    rating: { average: number | null };
    image: { medium?: string; original?: string } | null;
    externals: { imdb?: string | null; thetvdb?: number | null; tvrage?: number | null } | null;
    summaryHtml: string | null;
    summaryText: string;
    network: any;
    webChannel: any;
}

export interface TVMazeResolveData {
    source: 'tvmaze';
    match: {
        method: 'imdb' | 'search';
        score: number;
        year?: number | null;
        candidates?: number;
    };
    show: TVMazeShow | null;
}

export type ProviderSource = 'tmdb' | 'trakt' | 'tvmaze';

export interface AggregatedOverviewCandidate {
    source: ProviderSource;
    language: string;
    text: string;
    score: number;
}

export interface AggregatedSeriesMetadata {
    overview: string | null;
    overviewSource: ProviderSource | null;
    overviewLanguage: string | null;
    certification: string | null;
    certificationSource: ProviderSource | null;
    overviewCandidates: AggregatedOverviewCandidate[];
    tvmazeData: TVMazeResolveData | null;
}

export interface WatchedState {
    [mediaKey: string]: number[];
}

export interface UserData {
    [mediaKey: string]: {
        rating?: number;
        notes?: string;
        progress_percent?: number;
    };
}

export interface WatchedStateItem {
    media_key: string;
    media_type: MediaType;
    media_id: number;
    seriesId?: number;
    episodeId: number;
}

export interface UserDataItem {
    media_key: string;
    media_type: MediaType;
    media_id: number;
    seriesId?: number;
    rating?: number;
    notes?: string;
    progress_percent?: number;
}
export interface KVStoreItem { key: string; value: any; }
export interface SeasonCacheItem { seriesId: number; seasonNumber: number; data: TMDbSeason; cachedAt: number; }

declare global {
    interface Window {
        showSaveFilePicker: (options?: any) => Promise<any>;
    }
}
