export const ARCHIVE_VIEW_MODE_KEY: string = 'seriesdb.archiveViewMode';
export const WATCHLIST_VIEW_MODE_KEY: string = 'seriesdb.watchlistViewMode';
export const UNSEEN_VIEW_MODE_KEY: string = 'seriesdb.unseenViewMode';
export const ALL_SERIES_VIEW_MODE_KEY: string = 'seriesdb.allSeriesViewMode';
export const ALL_SERIES_STATUS_FILTER_KEY: string = 'seriesdb.allSeriesStatusFilter';
export const ALL_SERIES_MEDIA_FILTER_KEY: string = 'seriesdb.allSeriesMediaFilter';
export const THEME_STORAGE_KEY: string = 'seriesdb.theme';
export const TOP_RATED_EXCLUDE_ASIAN_ANIMATION_KEY: string = 'seriesdb.topRated.excludeAsianAnimation';
export const SEASON_CACHE_DURATION: number = 7 * 24 * 60 * 60 * 1000; // 7 dias
export const DASHBOARD_NEWS_ROLLOUT_QUERY_KEY: string = 'dashboardNews';
export const DASHBOARD_NEWS_ROLLOUT_STORAGE_KEY: string = 'seriesdb.dashboardNewsRollout';
export const DASHBOARD_NEWS_ENHANCED_ENABLED: boolean = true;

function normalizeBooleanOverride(value: string | null | undefined): boolean | null {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return null;
    if (['1', 'true', 'on', 'enabled', 'enable', 'yes'].includes(normalized)) return true;
    if (['0', 'false', 'off', 'disabled', 'disable', 'no'].includes(normalized)) return false;
    return null;
}

function readDashboardNewsQueryOverride(): boolean | null {
    if (typeof window === 'undefined') return null;
    try {
        const params = new URLSearchParams(window.location.search);
        return normalizeBooleanOverride(params.get(DASHBOARD_NEWS_ROLLOUT_QUERY_KEY));
    } catch {
        return null;
    }
}

function readDashboardNewsStorageOverride(): boolean | null {
    if (typeof window === 'undefined') return null;
    try {
        return normalizeBooleanOverride(window.localStorage.getItem(DASHBOARD_NEWS_ROLLOUT_STORAGE_KEY));
    } catch {
        return null;
    }
}

function readDashboardNewsEnvDefault(): boolean {
    const raw = import.meta.env.VITE_DASHBOARD_NEWS_ENABLED;
    const normalized = normalizeBooleanOverride(raw);
    if (normalized !== null) return normalized;
    return DASHBOARD_NEWS_ENHANCED_ENABLED;
}

export function isDashboardNewsRolloutEnabled(): boolean {
    const queryOverride = readDashboardNewsQueryOverride();
    if (queryOverride !== null) return queryOverride;

    const storageOverride = readDashboardNewsStorageOverride();
    if (storageOverride !== null) return storageOverride;

    return readDashboardNewsEnvDefault();
}
