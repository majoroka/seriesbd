import './style.css';
import * as C from './constants';
import * as DOM from './dom';
import * as API from './api';
import * as UI from './ui';
import * as S from './state';
import { debounce, exportChartToPNG, exportDataToCSV, processInBatches } from './utils';
import { db } from './db';
import { registerSW } from 'virtual:pwa-register';
import type { AuthChangeEvent, User } from '@supabase/supabase-js';
import { Series, Episode, TMDbPerson, WatchedStateItem, UserDataItem, TMDbSeriesDetails, KVStoreItem, MediaType } from './types';
import { getSupabaseClient, isSupabaseConfigured } from './supabase';
import { createMediaKey, normalizeSeriesCollection, parseMediaKey, toScopedBookId, toScopedMovieId } from './media';
import {
    checkDisplayNameAvailability,
    getCurrentSession,
    signInWithPassword,
    signOutCurrentUser,
    signUpWithPassword,
    subscribeToAuthState,
} from './auth';
import {
    LibrarySyncOutcome,
    markLocalLibraryMutation,
    pushLocalLibrarySnapshot,
    syncLibrarySnapshotAfterLogin,
} from './librarySync';

const OBSERVABILITY_STORAGE_KEY = 'seriesdb.observability.v1';
const SLOW_SECTION_THRESHOLD_MS = 1500;
type ObservabilitySection = 'search' | 'trending-day' | 'trending-week' | 'popular' | 'premieres' | 'series-details' | 'initialize';
type FailureMetric = {
    failCount: number;
    lastFailureAt: string;
    lastEndpoint: string;
    lastStatus: number | 'unknown';
    lastMessage: string;
};
type PerformanceMetric = {
    runs: number;
    failures: number;
    slowRuns: number;
    avgDurationMs: number;
    lastDurationMs: number;
    lastRunAt: string;
};
type DetailReturnContext = {
    sectionId: string;
    scrollTop: number;
};
type MainMenuTarget = 'dashboard' | 'series' | 'movie' | 'book' | 'library';
type SubmenuMediaTarget = Extract<MainMenuTarget, 'series' | 'movie' | 'book'>;
type AppNotificationKind =
    | 'episode-upcoming'
    | 'episode-released'
    | 'movie-upcoming'
    | 'movie-released'
    | 'book-upcoming'
    | 'book-released';
type AppNotification = {
    id: string;
    kind: AppNotificationKind;
    mediaType: MediaType;
    mediaId: number;
    title: string;
    description: string;
    dateIso: string;
    timestamp: number;
    isFuture: boolean;
    isRead: boolean;
};
type NotificationReadState = Record<string, string[]>;

const sectionFailureMetrics: Record<string, FailureMetric> = {};
const sectionPerformanceMetrics: Record<string, PerformanceMetric> = {};
let detailReturnContext: DetailReturnContext | null = null;
let authFormMode: 'login' | 'signup' = 'login';
let authFormBusy = false;
let currentAuthenticatedUserId: string | null = null;
let librarySyncTimer: number | null = null;
let isApplyingRemoteLibrarySnapshot = false;
let selectedSearchMediaType: MediaType = 'series';
let inactivityLogoutTimer: number | null = null;
let inactivityActivityListenersRegistered = false;
let lastInactivityActivityAt = 0;
let lastSignOutReason: 'manual' | 'inactivity' | null = null;
let profileIdentityRequestId = 0;
let activeSubmenuMediaTarget: SubmenuMediaTarget = 'series';
let notificationReadState: NotificationReadState = {};
let notificationReadStateLoaded = false;
let notificationDismissedState: NotificationReadState = {};
let notificationsCenterEntries: AppNotification[] = [];
let notificationsMenuOpen = false;
let mobileTopbarPanelOpen = false;
const nextAiredRetryAt = new Map<number, number>();

const INACTIVITY_LOGOUT_TIMEOUT_MS = 30 * 60 * 1000;
const INACTIVITY_ACTIVITY_THROTTLE_MS = 10 * 1000;
const NOTIFICATIONS_READ_STATE_KEY = 'seriesdb.notifications.readState.v1';
const NOTIFICATIONS_DISMISSED_STATE_KEY = 'seriesdb.notifications.dismissedState.v1';
const NOTIFICATION_MAX_ITEMS = 24;
const NOTIFICATION_EPISODE_LOOKAHEAD_DAYS = 30;
const NOTIFICATION_MOVIE_LOOKAHEAD_DAYS = 60;
const NOTIFICATION_BOOK_LOOKAHEAD_DAYS = 90;
const NOTIFICATION_RECENT_RELEASE_DAYS = 7;
const NEXT_AIRED_BATCH_SIZE = 2;
const NEXT_AIRED_BATCH_DELAY_MS = 1500;
const NEXT_AIRED_RATE_LIMIT_COOLDOWN_MS = 90_000;
const MOBILE_TOPBAR_BREAKPOINT_PX = 768;

function getErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
}

function getErrorStatus(error: unknown): number | null {
    if (typeof error === 'object' && error !== null && 'status' in error) {
        const status = Number((error as { status?: unknown }).status);
        if (!Number.isNaN(status) && status > 0) return status;
    }
    const message = getErrorMessage(error);
    const statusMatch = message.match(/(?:status|server error):\s*(\d{3})/i);
    if (!statusMatch) return null;
    const parsed = Number(statusMatch[1]);
    return Number.isNaN(parsed) ? null : parsed;
}

function renderInitializationErrorState(error: unknown): void {
    if (!DOM.dashboard) return;

    const errorMessage = getErrorMessage(error);
    const errorStatus = getErrorStatus(error);
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    const errorStack = error instanceof Error ? (error.stack || '') : '';
    const stackPreview = errorStack
        ? errorStack.split('\n').slice(0, 5).join('\n')
        : 'Sem stack trace disponível.';
    const timestamp = new Date().toISOString();
    const diagnosticsId = `init-${Date.now().toString(36)}`;

    DOM.dashboard.innerHTML = '';

    const card = document.createElement('div');
    card.className = 'card app-init-error-card';

    const title = document.createElement('h3');
    title.className = 'app-init-error-title';
    title.textContent = 'Ocorreu um erro crítico ao iniciar a aplicação.';

    const description = document.createElement('p');
    description.className = 'app-init-error-description';
    description.textContent = 'A app não conseguiu concluir a inicialização. Pode recarregar agora e, se voltar a acontecer, partilha este diagnóstico.';

    const details = document.createElement('details');
    details.className = 'app-init-error-details';
    details.open = true;

    const summary = document.createElement('summary');
    summary.textContent = 'Ver diagnóstico técnico';

    const pre = document.createElement('pre');
    pre.className = 'app-init-error-log';
    pre.textContent = [
        `id: ${diagnosticsId}`,
        `timestamp: ${timestamp}`,
        `name: ${errorName}`,
        `status: ${errorStatus ?? 'unknown'}`,
        `message: ${errorMessage}`,
        '',
        stackPreview,
    ].join('\n');

    details.appendChild(summary);
    details.appendChild(pre);

    const actions = document.createElement('div');
    actions.className = 'app-init-error-actions';

    const reloadBtn = document.createElement('button');
    reloadBtn.type = 'button';
    reloadBtn.className = 'search-bar-button';
    reloadBtn.textContent = 'Recarregar aplicação';
    reloadBtn.addEventListener('click', () => {
        window.location.reload();
    });

    actions.appendChild(reloadBtn);
    card.appendChild(title);
    card.appendChild(description);
    card.appendChild(details);
    card.appendChild(actions);
    DOM.dashboard.appendChild(card);
}

function parseMediaType(value: string | null | undefined): MediaType {
    if (value === 'movie' || value === 'book' || value === 'series') return value;
    return 'series';
}

function parseMainMenuTarget(value: string | null | undefined): MainMenuTarget {
    if (value === 'dashboard' || value === 'series' || value === 'movie' || value === 'book' || value === 'library') {
        return value;
    }
    return 'dashboard';
}

function getMediaTypeLabel(mediaType: MediaType): string {
    if (mediaType === 'movie') return 'Filmes';
    if (mediaType === 'book') return 'Livros';
    return 'Séries';
}

function getSearchPlaceholder(mediaType: MediaType): string {
    if (mediaType === 'movie') return 'Pesquisar para adicionar filme...';
    if (mediaType === 'book') return 'Pesquisar para adicionar livro...';
    return 'Pesquisar para adicionar série...';
}

function getSearchEmptyMessage(mediaType: MediaType): string {
    if (mediaType === 'movie') return 'Escreva na barra de pesquisa para encontrar novos filmes.';
    if (mediaType === 'book') return 'Escreva na barra de pesquisa para encontrar novos livros.';
    return 'Escreva na barra de pesquisa para encontrar novas séries.';
}

function getSubmenuMediaTarget(mainTarget: MainMenuTarget): SubmenuMediaTarget | null {
    if (mainTarget === 'series' || mainTarget === 'movie' || mainTarget === 'book') return mainTarget;
    return null;
}

function startOfDay(date: Date): Date {
    const normalized = new Date(date);
    normalized.setHours(0, 0, 0, 0);
    return normalized;
}

function parseDateOnly(value: string | null | undefined): Date | null {
    if (!value) return null;
    const normalized = String(value).trim();
    if (!normalized) return null;
    let isoDate = normalized;
    if (/^\d{4}$/.test(normalized)) {
        isoDate = `${normalized}-01-01`;
    } else if (/^\d{4}-\d{2}$/.test(normalized)) {
        isoDate = `${normalized}-01`;
    }
    const date = new Date(`${isoDate}T00:00:00`);
    if (Number.isNaN(date.getTime())) return null;
    return date;
}

function formatNotificationDateLabel(date: Date): string {
    const today = startOfDay(new Date());
    const target = startOfDay(date);
    const diffDays = Math.round((target.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
    if (diffDays === 0) return 'Hoje';
    if (diffDays === 1) return 'Amanhã';
    if (diffDays === -1) return 'Ontem';
    return target.toLocaleDateString('pt-PT', { day: '2-digit', month: 'short' }).replace('.', '');
}

function getNotificationUserKey(): string {
    return currentAuthenticatedUserId ? `user:${currentAuthenticatedUserId}` : 'local';
}

function parseNotificationState(rawState: unknown): NotificationReadState {
    if (!rawState || typeof rawState !== 'object' || Array.isArray(rawState)) return {};
    const parsed: NotificationReadState = {};
    Object.entries(rawState as Record<string, unknown>).forEach(([key, value]) => {
        if (!Array.isArray(value)) return;
        parsed[key] = value
            .map((entry) => String(entry || '').trim())
            .filter((entry) => entry.length > 0);
    });
    return parsed;
}

async function ensureNotificationReadStateLoaded(): Promise<void> {
    if (notificationReadStateLoaded) return;
    const [storedReadState, storedDismissedState] = await Promise.all([
        db.kvStore.get(NOTIFICATIONS_READ_STATE_KEY),
        db.kvStore.get(NOTIFICATIONS_DISMISSED_STATE_KEY),
    ]);
    notificationReadState = parseNotificationState(storedReadState?.value);
    notificationDismissedState = parseNotificationState(storedDismissedState?.value);
    notificationReadStateLoaded = true;
}

async function persistNotificationReadState(): Promise<void> {
    await db.kvStore.put({
        key: NOTIFICATIONS_READ_STATE_KEY,
        value: notificationReadState,
    });
}

function getReadIdsForCurrentUser(): Set<string> {
    const userKey = getNotificationUserKey();
    const values = notificationReadState[userKey] || [];
    return new Set(values);
}

async function persistNotificationDismissedState(): Promise<void> {
    await db.kvStore.put({
        key: NOTIFICATIONS_DISMISSED_STATE_KEY,
        value: notificationDismissedState,
    });
}

function getDismissedIdsForCurrentUser(): Set<string> {
    const userKey = getNotificationUserKey();
    const values = notificationDismissedState[userKey] || [];
    return new Set(values);
}

async function markNotificationsAsRead(notificationIds: string[]): Promise<void> {
    if (notificationIds.length === 0) return;
    await ensureNotificationReadStateLoaded();
    const userKey = getNotificationUserKey();
    const readSet = new Set(notificationReadState[userKey] || []);
    notificationIds.forEach((id) => readSet.add(id));
    notificationReadState[userKey] = Array.from(readSet).slice(-400);
    await persistNotificationReadState();
    notificationsCenterEntries = notificationsCenterEntries.map((item) =>
        readSet.has(item.id)
            ? { ...item, isRead: true }
            : item
    );
    renderNotificationsMenu();
}

async function markAllNotificationsAsRead(): Promise<void> {
    const unreadIds = notificationsCenterEntries.filter((item) => !item.isRead).map((item) => item.id);
    await markNotificationsAsRead(unreadIds);
}

async function dismissNotifications(notificationIds: string[]): Promise<void> {
    if (notificationIds.length === 0) return;
    await ensureNotificationReadStateLoaded();
    const userKey = getNotificationUserKey();
    const dismissedSet = new Set(notificationDismissedState[userKey] || []);
    notificationIds.forEach((id) => dismissedSet.add(id));
    notificationDismissedState[userKey] = Array.from(dismissedSet).slice(-800);
    await persistNotificationDismissedState();
}

async function clearNotificationsCenter(): Promise<void> {
    const currentIds = notificationsCenterEntries.map((item) => item.id);
    await dismissNotifications(currentIds);
    notificationsCenterEntries = [];
    renderNotificationsMenu();
}

function getMediaProgressForNotifications(media: Series): number {
    const mediaType = media.media_type || 'series';
    if (mediaType === 'series') {
        const watchedEpisodes = S.watchedState[media.id]?.length || 0;
        const totalEpisodes = media.total_episodes || 0;
        if (totalEpisodes <= 0) return watchedEpisodes > 0 ? 100 : 0;
        return Math.max(0, Math.min(100, Math.round((watchedEpisodes / totalEpisodes) * 100)));
    }
    const mediaKey = createMediaKey(mediaType, media.id);
    const progress = S.userData[mediaKey]?.progress_percent;
    if (typeof progress !== 'number' || Number.isNaN(progress)) return 0;
    return Math.max(0, Math.min(100, Math.round(progress)));
}

function buildNotificationsFromLibrary(readSet: Set<string>, dismissedSet: Set<string>): AppNotification[] {
    const allMedia = [...S.myWatchlist, ...S.myArchive];
    const today = startOfDay(new Date());
    const todayMs = today.getTime();
    const dayMs = 24 * 60 * 60 * 1000;
    const deduped = new Map<string, AppNotification>();
    const addNotification = (notification: AppNotification) => {
        if (dismissedSet.has(notification.id)) return;
        deduped.set(notification.id, notification);
    };

    allMedia.forEach((media) => {
        const mediaType = media.media_type || 'series';
        if (!media?.id || !media?.name) return;

        if (mediaType === 'series') {
            const nextEpisodeDate = parseDateOnly(media._details?.next_episode_to_air?.air_date || null);
            if (!nextEpisodeDate) return;
            const diffDays = Math.round((startOfDay(nextEpisodeDate).getTime() - todayMs) / dayMs);
            const dateKey = startOfDay(nextEpisodeDate).toISOString().slice(0, 10);
            if (diffDays >= 0 && diffDays <= NOTIFICATION_EPISODE_LOOKAHEAD_DAYS) {
                const description = diffDays === 0
                    ? 'Novo episódio disponível hoje.'
                    : diffDays === 1
                        ? 'Novo episódio disponível amanhã.'
                        : `Novo episódio previsto em ${diffDays} dias.`;
                const id = `series:episode:upcoming:${media.id}:${dateKey}`;
                addNotification({
                    id,
                    kind: 'episode-upcoming',
                    mediaType: 'series',
                    mediaId: media.id,
                    title: media.name,
                    description,
                    dateIso: dateKey,
                    timestamp: nextEpisodeDate.getTime(),
                    isFuture: true,
                    isRead: readSet.has(id),
                });
                return;
            }

            if (diffDays < 0 && diffDays >= -NOTIFICATION_RECENT_RELEASE_DAYS) {
                const id = `series:episode:released:${media.id}:${dateKey}`;
                const daysAgo = Math.abs(diffDays);
                const description = daysAgo === 0
                    ? 'Episódio lançado hoje.'
                    : daysAgo === 1
                        ? 'Episódio lançado ontem.'
                        : `Episódio lançado há ${daysAgo} dias.`;
                addNotification({
                    id,
                    kind: 'episode-released',
                    mediaType: 'series',
                    mediaId: media.id,
                    title: media.name,
                    description,
                    dateIso: dateKey,
                    timestamp: nextEpisodeDate.getTime(),
                    isFuture: false,
                    isRead: readSet.has(id),
                });
            }
            return;
        }

        const releaseDate = parseDateOnly(media.first_air_date || null);
        if (!releaseDate) return;

        const diffDays = Math.round((startOfDay(releaseDate).getTime() - todayMs) / dayMs);
        const dateKey = startOfDay(releaseDate).toISOString().slice(0, 10);
        const progress = getMediaProgressForNotifications(media);
        const shouldSkipReleasedNotification = progress >= 100;

        if (mediaType === 'movie') {
            if (diffDays >= 0 && diffDays <= NOTIFICATION_MOVIE_LOOKAHEAD_DAYS) {
                const id = `movie:upcoming:${media.id}:${dateKey}`;
                const description = diffDays === 0
                    ? 'Estreia hoje.'
                    : diffDays === 1
                        ? 'Estreia amanhã.'
                        : `Estreia em ${diffDays} dias.`;
                addNotification({
                    id,
                    kind: 'movie-upcoming',
                    mediaType: 'movie',
                    mediaId: media.id,
                    title: media.name,
                    description,
                    dateIso: dateKey,
                    timestamp: releaseDate.getTime(),
                    isFuture: true,
                    isRead: readSet.has(id),
                });
            } else if (!shouldSkipReleasedNotification && diffDays < 0 && diffDays >= -NOTIFICATION_RECENT_RELEASE_DAYS) {
                const id = `movie:released:${media.id}:${dateKey}`;
                const daysAgo = Math.abs(diffDays);
                const description = daysAgo === 1
                    ? 'Filme lançado ontem.'
                    : daysAgo === 0
                        ? 'Filme lançado hoje.'
                        : `Filme lançado há ${daysAgo} dias.`;
                addNotification({
                    id,
                    kind: 'movie-released',
                    mediaType: 'movie',
                    mediaId: media.id,
                    title: media.name,
                    description,
                    dateIso: dateKey,
                    timestamp: releaseDate.getTime(),
                    isFuture: false,
                    isRead: readSet.has(id),
                });
            }
            return;
        }

        if (mediaType === 'book') {
            if (diffDays >= 0 && diffDays <= NOTIFICATION_BOOK_LOOKAHEAD_DAYS) {
                const id = `book:upcoming:${media.id}:${dateKey}`;
                const description = diffDays === 0
                    ? 'Lançamento previsto para hoje.'
                    : diffDays === 1
                        ? 'Lançamento previsto para amanhã.'
                        : `Lançamento previsto em ${diffDays} dias.`;
                addNotification({
                    id,
                    kind: 'book-upcoming',
                    mediaType: 'book',
                    mediaId: media.id,
                    title: media.name,
                    description,
                    dateIso: dateKey,
                    timestamp: releaseDate.getTime(),
                    isFuture: true,
                    isRead: readSet.has(id),
                });
            } else if (!shouldSkipReleasedNotification && diffDays < 0 && diffDays >= -NOTIFICATION_RECENT_RELEASE_DAYS) {
                const id = `book:released:${media.id}:${dateKey}`;
                const daysAgo = Math.abs(diffDays);
                const description = daysAgo === 1
                    ? 'Livro lançado ontem.'
                    : daysAgo === 0
                        ? 'Livro lançado hoje.'
                        : `Livro lançado há ${daysAgo} dias.`;
                addNotification({
                    id,
                    kind: 'book-released',
                    mediaType: 'book',
                    mediaId: media.id,
                    title: media.name,
                    description,
                    dateIso: dateKey,
                    timestamp: releaseDate.getTime(),
                    isFuture: false,
                    isRead: readSet.has(id),
                });
            }
        }
    });

    return Array.from(deduped.values())
        .sort((a, b) => {
            if (a.isFuture !== b.isFuture) return a.isFuture ? -1 : 1;
            return a.isFuture
                ? a.timestamp - b.timestamp
                : b.timestamp - a.timestamp;
        })
        .slice(0, NOTIFICATION_MAX_ITEMS);
}

function getNotificationMediaLabel(mediaType: MediaType): string {
    if (mediaType === 'movie') return 'Filme';
    if (mediaType === 'book') return 'Livro';
    return 'Série';
}

function closeNotificationsMenu(): void {
    notificationsMenuOpen = false;
    if (DOM.notificationsMenu) {
        DOM.notificationsMenu.classList.remove('visible');
    }
    if (DOM.notificationsBtn) {
        DOM.notificationsBtn.setAttribute('aria-expanded', 'false');
    }
}

function openNotificationsMenu(): void {
    notificationsMenuOpen = true;
    if (DOM.notificationsMenu) {
        DOM.notificationsMenu.classList.add('visible');
    }
    if (DOM.notificationsBtn) {
        DOM.notificationsBtn.setAttribute('aria-expanded', 'true');
    }
}

function toggleNotificationsMenu(): void {
    if (notificationsMenuOpen) {
        closeNotificationsMenu();
        return;
    }
    openNotificationsMenu();
}

function isMobileViewport(): boolean {
    return window.matchMedia(`(max-width: ${MOBILE_TOPBAR_BREAKPOINT_PX}px)`).matches;
}

function closeMobileTopbarPanel(): void {
    mobileTopbarPanelOpen = false;
    closeNotificationsMenu();
    DOM.settingsMenu?.classList.remove('visible');
    if (DOM.mobileTopbarPanel) {
        DOM.mobileTopbarPanel.classList.remove('visible');
        DOM.mobileTopbarPanel.hidden = true;
    }
    if (DOM.mobileTopbarToggle) {
        DOM.mobileTopbarToggle.setAttribute('aria-expanded', 'false');
    }
}

function openMobileTopbarPanel(): void {
    mobileTopbarPanelOpen = true;
    if (DOM.mobileTopbarPanel) {
        DOM.mobileTopbarPanel.hidden = false;
        DOM.mobileTopbarPanel.classList.add('visible');
    }
    DOM.settingsMenu?.classList.add('visible');
    if (DOM.mobileTopbarToggle) {
        DOM.mobileTopbarToggle.setAttribute('aria-expanded', 'true');
    }
}

function toggleMobileTopbarPanel(): void {
    if (mobileTopbarPanelOpen) {
        closeMobileTopbarPanel();
        return;
    }
    openMobileTopbarPanel();
}

function syncMobileTopbarLayout(): void {
    if (!DOM.mobileTopbarControls || !DOM.mobileTopbarPanel || !DOM.mainHeaderRight || !DOM.notificationsMenuWrapper || !DOM.accountMenuWrapper) {
        return;
    }

    const isMobile = isMobileViewport();
    DOM.mobileTopbarControls.hidden = !isMobile;

    if (isMobile) {
        closeMobileTopbarPanel();
        if (!DOM.mobileTopbarControls.contains(DOM.notificationsMenuWrapper)) {
            DOM.mobileTopbarControls.insertBefore(DOM.notificationsMenuWrapper, DOM.mobileTopbarToggle);
        }
        if (!DOM.mobileTopbarPanel.contains(DOM.accountMenuWrapper)) {
            DOM.mobileTopbarPanel.appendChild(DOM.accountMenuWrapper);
        }
        return;
    }

    closeMobileTopbarPanel();

    const searchBar = DOM.mainHeaderRight.querySelector('.search-bar');
    if (!DOM.mainHeaderRight.contains(DOM.notificationsMenuWrapper)) {
        if (searchBar && searchBar.nextSibling) {
            DOM.mainHeaderRight.insertBefore(DOM.notificationsMenuWrapper, searchBar.nextSibling);
        } else {
            DOM.mainHeaderRight.appendChild(DOM.notificationsMenuWrapper);
        }
    }
    if (!DOM.mainHeaderRight.contains(DOM.accountMenuWrapper)) {
        DOM.mainHeaderRight.appendChild(DOM.accountMenuWrapper);
    }
}

function setupMobileTopbarControls(): void {
    if (!DOM.mobileTopbarToggle || !DOM.mobileTopbarPanel || !DOM.mobileTopbarControls) return;

    syncMobileTopbarLayout();

    DOM.mobileTopbarToggle.addEventListener('click', (event) => {
        event.stopPropagation();
        toggleMobileTopbarPanel();
    });

    DOM.mobileTopbarPanel.addEventListener('click', (event) => {
        event.stopPropagation();
    });

    window.addEventListener('resize', () => {
        syncMobileTopbarLayout();
    });
}

function renderNotificationsMenu(): void {
    if (!DOM.notificationsMenuList || !DOM.notificationsBtn || !DOM.notificationsBadge || !DOM.notificationsMarkAllReadBtn || !DOM.notificationsClearBtn) return;

    const unreadCount = notificationsCenterEntries.filter((item) => !item.isRead).length;
    DOM.notificationsBtn.classList.toggle('has-unread', unreadCount > 0);
    if (unreadCount > 0) {
        DOM.notificationsBadge.hidden = false;
        DOM.notificationsBadge.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
        DOM.notificationsBtn.setAttribute('aria-label', `Notificações (${unreadCount} por ler)`);
    } else {
        DOM.notificationsBadge.hidden = true;
        DOM.notificationsBadge.textContent = '';
        DOM.notificationsBtn.setAttribute('aria-label', 'Notificações');
    }
    DOM.notificationsMarkAllReadBtn.hidden = unreadCount <= 0;
    DOM.notificationsClearBtn.hidden = notificationsCenterEntries.length <= 0;

    DOM.notificationsMenuList.innerHTML = '';
    if (notificationsCenterEntries.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'notifications-empty';
        empty.textContent = 'Sem notificações de momento.';
        DOM.notificationsMenuList.appendChild(empty);
        return;
    }

    notificationsCenterEntries.forEach((notification) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = `notification-item${notification.isRead ? '' : ' is-unread'}`;
        item.setAttribute('data-notification-id', notification.id);
        item.setAttribute('data-media-id', String(notification.mediaId));
        item.setAttribute('data-media-type', notification.mediaType);
        item.setAttribute('role', 'menuitem');

        const top = document.createElement('div');
        top.className = 'notification-item-top';

        const title = document.createElement('span');
        title.className = 'notification-item-title';
        title.textContent = notification.title;

        const date = document.createElement('span');
        date.className = 'notification-item-date';
        const notificationDate = parseDateOnly(notification.dateIso) ?? new Date(notification.timestamp);
        date.textContent = formatNotificationDateLabel(notificationDate);

        top.appendChild(title);
        top.appendChild(date);

        const description = document.createElement('p');
        description.className = 'notification-item-description';
        description.textContent = notification.description;

        const meta = document.createElement('div');
        meta.className = 'notification-item-meta';
        const pill = document.createElement('span');
        pill.className = `notification-item-pill notification-item-pill--${notification.mediaType}`;
        pill.textContent = getNotificationMediaLabel(notification.mediaType);
        meta.appendChild(pill);

        item.appendChild(top);
        item.appendChild(description);
        item.appendChild(meta);
        DOM.notificationsMenuList.appendChild(item);
    });
}

async function refreshNotificationsCenter(): Promise<void> {
    await ensureNotificationReadStateLoaded();
    const readSet = getReadIdsForCurrentUser();
    const dismissedSet = getDismissedIdsForCurrentUser();
    notificationsCenterEntries = buildNotificationsFromLibrary(readSet, dismissedSet);
    renderNotificationsMenu();
}

function getSubmenuLabels(mediaTarget: SubmenuMediaTarget): Record<string, string> {
    if (mediaTarget === 'book') {
        return {
            'watchlist-section': 'Quero Ler',
            'unseen-section': 'A Ler',
            'next-aired-section': 'Próximo Episódio',
            'trending-section': 'Tendências',
            'popular-section': 'Top Rated',
            'premieres-section': 'Estreias',
            'stats-section': 'Estatísticas',
        };
    }

    return {
        'watchlist-section': 'Quero Ver',
        'unseen-section': 'A Ver',
        'next-aired-section': 'Próximo Episódio',
        'trending-section': 'Tendências',
        'popular-section': 'Top Rated',
        'premieres-section': 'Estreias',
        'stats-section': 'Estatísticas',
    };
}

function updateSectionHeadingsForMediaTarget(mediaTarget: SubmenuMediaTarget): void {
    const watchlistHeading = document.querySelector('#watchlist-section h2');
    const unseenHeading = document.querySelector('#unseen-section h2');
    if (watchlistHeading) {
        watchlistHeading.innerHTML = mediaTarget === 'book'
            ? '<i class="fas fa-star"></i> Quero Ler'
            : '<i class="fas fa-star"></i> Quero Ver';
    }
    if (unseenHeading) {
        unseenHeading.innerHTML = mediaTarget === 'book'
            ? '<i class="fas fa-eye-slash"></i> A Ler'
            : '<i class="fas fa-eye-slash"></i> A Ver';
    }
}

function applySubmenuForMainTarget(mainTarget: MainMenuTarget): void {
    const mediaTarget = getSubmenuMediaTarget(mainTarget);
    if (!mediaTarget) {
        UI.setScopedLibraryMediaType('all');
        UI.setScopedStatsMediaType('all');
        return;
    }

    activeSubmenuMediaTarget = mediaTarget;
    UI.setScopedLibraryMediaType(mediaTarget);
    UI.setScopedStatsMediaType(mediaTarget);
    updateSectionHeadingsForMediaTarget(mediaTarget);

    const labels = getSubmenuLabels(mediaTarget);
    DOM.mainNavLinks.forEach((link) => {
        const targetId = (link as HTMLElement).dataset.target || '';
        const linkElement = link as HTMLAnchorElement;
        const parentItem = linkElement.closest('li');
        const labelElement = linkElement.querySelector<HTMLElement>('.nav-link-label');
        if (labelElement && labels[targetId]) {
            labelElement.textContent = labels[targetId];
        }
        if (targetId === 'next-aired-section' && parentItem) {
            const shouldHide = mediaTarget !== 'series';
            parentItem.classList.toggle('is-hidden', shouldHide);
            if (shouldHide) {
                linkElement.classList.remove('active');
            }
        }
    });
}

function updateMainMenuActiveState(target: MainMenuTarget): void {
    DOM.mainMenuLinks.forEach((link) => {
        link.classList.toggle('active', parseMainMenuTarget(link.dataset.mainTarget) === target);
    });
    DOM.sidebar?.setAttribute('data-main-theme', target);

    applySubmenuForMainTarget(target);

    if (DOM.sidebarSubmenuShell) {
        const showSubmenu = target === 'series' || target === 'movie' || target === 'book';
        DOM.sidebarSubmenuShell.classList.toggle('is-hidden', !showSubmenu);
        DOM.sidebarSubmenuShell.setAttribute('aria-hidden', showSubmenu ? 'false' : 'true');
        if (showSubmenu) {
            DOM.sidebarSubmenuShell.setAttribute('data-submenu-theme', target);
        } else {
            DOM.sidebarSubmenuShell.removeAttribute('data-submenu-theme');
        }
    }
}

function getMainMenuTargetFromSection(targetSection: string): MainMenuTarget {
    if (targetSection === 'media-dashboard-section') return 'dashboard';
    if (targetSection === 'all-series-section') return 'library';
    return activeSubmenuMediaTarget;
}

async function navigateMainMenu(target: MainMenuTarget): Promise<void> {
    updateMainMenuActiveState(target);
    if (target === 'dashboard') {
        UI.setScopedStatsMediaType('all');
        UI.showSection('media-dashboard-section');
        UI.renderMediaDashboard();
        return;
    }

    if (target === 'library') {
        await setAllSeriesMediaFilterPreference('all');
        await setAllSeriesStatusFilterPreference('all');
        S.setAllSeriesGenreFilter('all');
        if (DOM.allSeriesGenreFilter) DOM.allSeriesGenreFilter.value = 'all';
        UI.setScopedLibraryMediaType('all');
        UI.setScopedStatsMediaType('all');
        UI.renderAllSeries();
        UI.showSection('all-series-section');
        return;
    }

    if (target === 'series' || target === 'movie' || target === 'book') {
        UI.setScopedLibraryMediaType(target);
        UI.setScopedStatsMediaType(target);
        UI.renderWatchlist();
        UI.renderUnseen();
    }
    UI.showSection('watchlist-section');
}

function getBestUserDisplayName(user: User | null): string {
    if (!user) return 'utilizador';
    const metadata = user.user_metadata as { full_name?: string; name?: string; display_name?: string } | undefined;
    const fullName = typeof metadata?.full_name === 'string' ? metadata.full_name.trim() : '';
    if (fullName) return fullName;
    const displayName = typeof metadata?.display_name === 'string' ? metadata.display_name.trim() : '';
    if (displayName) return displayName;
    const genericName = typeof metadata?.name === 'string' ? metadata.name.trim() : '';
    if (genericName) return genericName;
    const email = String(user.email || '').trim();
    if (!email) return 'utilizador';
    return email.split('@')[0] || 'utilizador';
}

function getBestUserAvatarUrl(user: User | null): string | null {
    if (!user) return null;
    const metadata = user.user_metadata as { avatar_url?: string; picture?: string } | undefined;
    const avatarUrl = typeof metadata?.avatar_url === 'string' ? metadata.avatar_url.trim() : '';
    if (avatarUrl) return avatarUrl;
    const pictureUrl = typeof metadata?.picture === 'string' ? metadata.picture.trim() : '';
    if (pictureUrl) return pictureUrl;
    return null;
}

function applyAvatarIdentity(
    avatarElement: HTMLElement | null | undefined,
    isAuthenticated: boolean,
    displayName: string,
    avatarUrl: string | null
): void {
    if (!avatarElement) return;
    if (!isAuthenticated) {
        avatarElement.classList.add('is-hidden');
        avatarElement.classList.remove('has-image');
        avatarElement.style.backgroundImage = '';
        avatarElement.textContent = '';
        return;
    }

    avatarElement.classList.remove('is-hidden');
    if (avatarUrl) {
        avatarElement.classList.add('has-image');
        avatarElement.style.backgroundImage = `url("${avatarUrl}")`;
        avatarElement.textContent = '';
        return;
    }

    avatarElement.classList.remove('has-image');
    avatarElement.style.backgroundImage = '';
    avatarElement.textContent = (displayName.charAt(0) || 'U').toUpperCase();
}

function updateTopbarIdentity(
    user: User | null,
    profileIdentity?: { displayName?: string | null; avatarUrl?: string | null }
): void {
    const isAuthenticated = Boolean(user);
    const resolvedDisplayName = profileIdentity?.displayName?.trim() || getBestUserDisplayName(user);
    const resolvedAvatarUrl = profileIdentity?.avatarUrl?.trim() || getBestUserAvatarUrl(user);

    if (DOM.topbarGreeting) {
        DOM.topbarGreeting.textContent = `Olá, ${isAuthenticated ? resolvedDisplayName : 'visitante'}!`;
    }
    if (DOM.topbarAccountName) {
        DOM.topbarAccountName.textContent = isAuthenticated ? resolvedDisplayName : 'Conta';
    }
    if (DOM.accountMenuName) {
        DOM.accountMenuName.textContent = isAuthenticated ? resolvedDisplayName : 'Conta local';
    }
    applyAvatarIdentity(DOM.topbarAccountAvatar, isAuthenticated, resolvedDisplayName, resolvedAvatarUrl);
    applyAvatarIdentity(DOM.accountMenuAvatar, isAuthenticated, resolvedDisplayName, resolvedAvatarUrl);
    DOM.settingsBtn?.classList.toggle('no-avatar', !isAuthenticated);
}

async function refreshTopbarIdentityFromProfile(user: User | null): Promise<void> {
    profileIdentityRequestId += 1;
    const currentRequestId = profileIdentityRequestId;
    if (!user || !isSupabaseConfigured()) {
        return;
    }

    try {
        const client = getSupabaseClient();
        const { data, error } = await client
            .from('profiles')
            .select('display_name, avatar_url')
            .eq('id', user.id)
            .maybeSingle();

        if (currentRequestId !== profileIdentityRequestId || currentAuthenticatedUserId !== user.id) {
            return;
        }

        if (error) {
            console.warn('[auth] Não foi possível carregar dados de perfil para o menu de conta.', error);
            return;
        }

        const profileDisplayName = typeof data?.display_name === 'string' ? data.display_name.trim() : '';
        const profileAvatarUrl = typeof data?.avatar_url === 'string' ? data.avatar_url.trim() : '';
        updateTopbarIdentity(user, {
            displayName: profileDisplayName || null,
            avatarUrl: profileAvatarUrl || null,
        });
    } catch (error) {
        console.warn('[auth] Erro ao atualizar identidade de perfil no menu de conta.', error);
    }
}

function persistObservabilitySnapshot() {
    const snapshot = {
        updatedAt: new Date().toISOString(),
        failures: sectionFailureMetrics,
        performance: sectionPerformanceMetrics,
    };
    try {
        sessionStorage.setItem(OBSERVABILITY_STORAGE_KEY, JSON.stringify(snapshot));
    } catch (error) {
        console.warn('[obs][client] Não foi possível persistir snapshot de observabilidade.', error);
    }
    (window as unknown as { __seriesdbObservability?: unknown }).__seriesdbObservability = snapshot;
}

function recordSectionPerformance(section: ObservabilitySection, durationMs: number, success: boolean) {
    const current = sectionPerformanceMetrics[section] || {
        runs: 0,
        failures: 0,
        slowRuns: 0,
        avgDurationMs: 0,
        lastDurationMs: 0,
        lastRunAt: '',
    };

    const runs = current.runs + 1;
    const failures = current.failures + (success ? 0 : 1);
    const slowRuns = current.slowRuns + (durationMs >= SLOW_SECTION_THRESHOLD_MS ? 1 : 0);
    const avgDurationMs = Number((((current.avgDurationMs * current.runs) + durationMs) / runs).toFixed(1));

    sectionPerformanceMetrics[section] = {
        runs,
        failures,
        slowRuns,
        avgDurationMs,
        lastDurationMs: Number(durationMs.toFixed(1)),
        lastRunAt: new Date().toISOString(),
    };

    if (durationMs >= SLOW_SECTION_THRESHOLD_MS) {
        console.warn('[obs][client] Secção lenta detetada', {
            section,
            durationMs: Number(durationMs.toFixed(1)),
            thresholdMs: SLOW_SECTION_THRESHOLD_MS,
            success,
        });
    }
}

function recordSectionFailure(
    section: ObservabilitySection,
    endpoint: string,
    error: unknown,
    extra: Record<string, unknown> = {}
) {
    const status = getErrorStatus(error);
    const message = getErrorMessage(error);
    const nowIso = new Date().toISOString();
    const previous = sectionFailureMetrics[section];

    sectionFailureMetrics[section] = {
        failCount: (previous?.failCount || 0) + 1,
        lastFailureAt: nowIso,
        lastEndpoint: endpoint,
        lastStatus: status ?? 'unknown',
        lastMessage: message,
    };

    console.error('[obs][client] Falha de secção', {
        section,
        endpoint,
        status: status ?? 'unknown',
        message,
        online: navigator.onLine,
        ...extra,
    });
}

async function runObservedSection<T>(
    section: ObservabilitySection,
    endpoint: string,
    request: () => Promise<T>,
    extra: Record<string, unknown> = {}
): Promise<T> {
    const startedAt = performance.now();
    let success = false;
    try {
        const result = await request();
        success = true;
        return result;
    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            success = true;
            throw error;
        }
        recordSectionFailure(section, endpoint, error, extra);
        throw error;
    } finally {
        const durationMs = performance.now() - startedAt;
        recordSectionPerformance(section, durationMs, success);
        persistObservabilitySnapshot();
    }
}

type ViewMode = 'list' | 'grid';
type ThemeMode = 'light' | 'dark' | 'system';
type AllSeriesStatusFilter = 'all' | 'watchlist' | 'unseen' | 'archive';
type AllSeriesMediaFilter = 'all' | 'series' | 'movie' | 'book';
type SyncedUserSettings = {
    theme: ThemeMode;
    watchlist_view_mode: ViewMode;
    archive_view_mode: ViewMode;
    unseen_view_mode: ViewMode;
    all_series_view_mode: ViewMode;
    exclude_asian_animation: boolean;
};

function normalizeViewMode(value: unknown, fallback: ViewMode = 'list'): ViewMode {
    return value === 'grid' ? 'grid' : fallback;
}

function normalizeThemeMode(value: unknown, fallback: ThemeMode = 'dark'): ThemeMode {
    if (value === 'light' || value === 'dark' || value === 'system') return value;
    return fallback;
}

function normalizeBooleanSetting(value: unknown, fallback: boolean): boolean {
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    return fallback;
}

function normalizeAllSeriesStatusFilter(value: unknown, fallback: AllSeriesStatusFilter = 'all'): AllSeriesStatusFilter {
    if (value === 'watchlist' || value === 'unseen' || value === 'archive' || value === 'all') return value;
    return fallback;
}

function normalizeAllSeriesMediaFilter(value: unknown, fallback: AllSeriesMediaFilter = 'all'): AllSeriesMediaFilter {
    if (value === 'series' || value === 'movie' || value === 'book' || value === 'all') return value;
    return fallback;
}

function applySettingsMapToUi(settingsMap: Map<string, unknown>) {
    const topRatedFilterSetting = settingsMap.get(C.TOP_RATED_EXCLUDE_ASIAN_ANIMATION_KEY);
    excludeAsianAnimationFromTopRated = topRatedFilterSetting === undefined
        ? true
        : topRatedFilterSetting === true || topRatedFilterSetting === 'true';
    updateTopRatedFilterToggleButton();

    UI.applyViewMode(normalizeViewMode(settingsMap.get(C.WATCHLIST_VIEW_MODE_KEY), 'list'), DOM.watchlistContainer, DOM.watchlistViewToggle);
    UI.applyViewMode(normalizeViewMode(settingsMap.get(C.UNSEEN_VIEW_MODE_KEY), 'list'), DOM.unseenContainer, DOM.unseenViewToggle);
    UI.applyViewMode(normalizeViewMode(settingsMap.get(C.ARCHIVE_VIEW_MODE_KEY), 'list'), DOM.archiveContainer, DOM.archiveViewToggle);
    UI.applyViewMode(normalizeViewMode(settingsMap.get(C.ALL_SERIES_VIEW_MODE_KEY), 'list'), DOM.allSeriesContainer, DOM.allSeriesViewToggle);
    S.setAllSeriesMediaFilter(normalizeAllSeriesMediaFilter(settingsMap.get(C.ALL_SERIES_MEDIA_FILTER_KEY), 'all'));
    if (DOM.allSeriesMediaFilter) {
        DOM.allSeriesMediaFilter.value = S.allSeriesMediaFilter;
    }
    S.setAllSeriesStatusFilter(normalizeAllSeriesStatusFilter(settingsMap.get(C.ALL_SERIES_STATUS_FILTER_KEY), 'all'));
    if (DOM.allSeriesStatusFilter) {
        DOM.allSeriesStatusFilter.value = S.allSeriesStatusFilter;
    }

    const theme = normalizeThemeMode(settingsMap.get(C.THEME_STORAGE_KEY), 'dark');
    UI.applyTheme(theme === 'system' ? 'dark' : theme);
}

async function readLocalSettingsMap(): Promise<Map<string, unknown>> {
    const settings = await db.kvStore.toArray();
    return new Map(settings.map((item: KVStoreItem) => [item.key, item.value]));
}

function mapSettingsMapToSyncedPayload(settingsMap: Map<string, unknown>): SyncedUserSettings {
    return {
        theme: normalizeThemeMode(settingsMap.get(C.THEME_STORAGE_KEY), 'dark'),
        watchlist_view_mode: normalizeViewMode(settingsMap.get(C.WATCHLIST_VIEW_MODE_KEY), 'list'),
        archive_view_mode: normalizeViewMode(settingsMap.get(C.ARCHIVE_VIEW_MODE_KEY), 'list'),
        unseen_view_mode: normalizeViewMode(settingsMap.get(C.UNSEEN_VIEW_MODE_KEY), 'list'),
        all_series_view_mode: normalizeViewMode(settingsMap.get(C.ALL_SERIES_VIEW_MODE_KEY), 'list'),
        exclude_asian_animation: normalizeBooleanSetting(
            settingsMap.get(C.TOP_RATED_EXCLUDE_ASIAN_ANIMATION_KEY),
            true
        ),
    };
}

async function saveSyncedPayloadToLocalDb(payload: SyncedUserSettings): Promise<void> {
    const kvItems: KVStoreItem[] = [
        { key: C.THEME_STORAGE_KEY, value: payload.theme === 'system' ? 'dark' : payload.theme },
        { key: C.WATCHLIST_VIEW_MODE_KEY, value: payload.watchlist_view_mode },
        { key: C.ARCHIVE_VIEW_MODE_KEY, value: payload.archive_view_mode },
        { key: C.UNSEEN_VIEW_MODE_KEY, value: payload.unseen_view_mode },
        { key: C.ALL_SERIES_VIEW_MODE_KEY, value: payload.all_series_view_mode },
        { key: C.TOP_RATED_EXCLUDE_ASIAN_ANIMATION_KEY, value: payload.exclude_asian_animation },
    ];
    await db.kvStore.bulkPut(kvItems);
}

async function pushLocalSettingsToRemote(userId: string): Promise<void> {
    if (!isSupabaseConfigured()) return;
    const settingsMap = await readLocalSettingsMap();
    const payload = mapSettingsMapToSyncedPayload(settingsMap);
    const client = getSupabaseClient();
    const { error } = await client.from('user_settings').upsert(
        {
            user_id: userId,
            ...payload,
        },
        { onConflict: 'user_id' }
    );
    if (error) throw error;
}

async function pullRemoteSettingsToLocal(userId: string): Promise<boolean> {
    if (!isSupabaseConfigured()) return false;
    const client = getSupabaseClient();
    const { data, error } = await client
        .from('user_settings')
        .select('theme, watchlist_view_mode, archive_view_mode, unseen_view_mode, all_series_view_mode, exclude_asian_animation')
        .eq('user_id', userId)
        .maybeSingle();

    if (error) throw error;
    if (!data) return false;

    const normalized: SyncedUserSettings = {
        theme: normalizeThemeMode(data.theme, 'dark'),
        watchlist_view_mode: normalizeViewMode(data.watchlist_view_mode, 'list'),
        archive_view_mode: normalizeViewMode(data.archive_view_mode, 'list'),
        unseen_view_mode: normalizeViewMode(data.unseen_view_mode, 'list'),
        all_series_view_mode: normalizeViewMode(data.all_series_view_mode, 'list'),
        exclude_asian_animation: normalizeBooleanSetting(data.exclude_asian_animation, true),
    };
    await saveSyncedPayloadToLocalDb(normalized);
    return true;
}

async function syncUserSettingsAfterLogin(userId: string): Promise<void> {
    if (!isSupabaseConfigured()) return;
    try {
        const pulledFromRemote = await pullRemoteSettingsToLocal(userId);
        if (!pulledFromRemote) {
            await pushLocalSettingsToRemote(userId);
        }
        const settingsMap = await readLocalSettingsMap();
        applySettingsMapToUi(settingsMap);
        UI.renderWatchlist();
        UI.renderArchive();
        UI.renderAllSeries();
        UI.renderUnseen();
        UI.renderMediaDashboard();
    } catch (error) {
        console.error('[settings-sync] Falha ao sincronizar user_settings após login.', error);
    }
}

async function syncUserSettingsToRemoteIfNeeded(): Promise<void> {
    if (!isSupabaseConfigured() || !currentAuthenticatedUserId) return;
    try {
        await pushLocalSettingsToRemote(currentAuthenticatedUserId);
    } catch (error) {
        console.error('[settings-sync] Falha ao guardar user_settings no Supabase.', error);
    }
}

async function syncLibrarySnapshotToRemoteIfNeeded(): Promise<void> {
    if (!isSupabaseConfigured() || !currentAuthenticatedUserId || isApplyingRemoteLibrarySnapshot) return;
    try {
        await pushLocalLibrarySnapshot(currentAuthenticatedUserId);
    } catch (error) {
        console.error('[library-sync] Falha ao guardar biblioteca no Supabase.', error);
    }
}

function scheduleLibrarySnapshotSyncFromLocalMutation(): void {
    if (isApplyingRemoteLibrarySnapshot) return;
    void markLocalLibraryMutation();
    if (!isSupabaseConfigured() || !currentAuthenticatedUserId) return;

    if (librarySyncTimer) {
        clearTimeout(librarySyncTimer);
    }

    librarySyncTimer = window.setTimeout(() => {
        librarySyncTimer = null;
        void syncLibrarySnapshotToRemoteIfNeeded();
    }, 1200);
}

async function syncCloudStateAfterLogin(userId: string): Promise<LibrarySyncOutcome> {
    await syncUserSettingsAfterLogin(userId);

    let libraryOutcome: LibrarySyncOutcome = 'noop';
    try {
        isApplyingRemoteLibrarySnapshot = true;
        libraryOutcome = await syncLibrarySnapshotAfterLogin(userId);
    } catch (error) {
        console.error('[library-sync] Falha ao sincronizar biblioteca após login.', error);
    } finally {
        isApplyingRemoteLibrarySnapshot = false;
    }

    if (libraryOutcome === 'pulled') {
        await initializeApp();
        UI.showNotification('Biblioteca sincronizada da cloud.');
    }

    return libraryOutcome;
}

function setAuthStatusLabel(message: string, mode: 'default' | 'connected' | 'error' = 'default') {
    if (!DOM.authStatusLabel) return;
    DOM.authStatusLabel.textContent = message;
    DOM.authStatusLabel.classList.remove('connected', 'error');
    if (mode === 'connected') DOM.authStatusLabel.classList.add('connected');
    if (mode === 'error') DOM.authStatusLabel.classList.add('error');
}

function clearInactivityLogoutTimer() {
    if (!inactivityLogoutTimer) return;
    clearTimeout(inactivityLogoutTimer);
    inactivityLogoutTimer = null;
}

async function signOutDueToInactivity(): Promise<void> {
    if (!isSupabaseConfigured() || !currentAuthenticatedUserId) return;
    try {
        lastSignOutReason = 'inactivity';
        await signOutCurrentUser();
    } catch (error) {
        const message = getErrorMessage(error);
        lastSignOutReason = null;
        console.error('[auth] Erro ao terminar sessão por inatividade.', error);
        UI.showNotification(`Não foi possível terminar sessão por inatividade: ${message}`);
    }
}

function scheduleInactivityLogoutTimer() {
    if (!isSupabaseConfigured() || !currentAuthenticatedUserId) {
        clearInactivityLogoutTimer();
        return;
    }
    clearInactivityLogoutTimer();
    inactivityLogoutTimer = window.setTimeout(() => {
        inactivityLogoutTimer = null;
        void signOutDueToInactivity();
    }, INACTIVITY_LOGOUT_TIMEOUT_MS);
}

function onUserActivityForSessionTimeout(event?: Event) {
    if (!currentAuthenticatedUserId) return;
    const now = Date.now();
    const eventType = event?.type ?? '';
    const isNoisyEvent = eventType === 'mousemove' || eventType === 'scroll';

    if (isNoisyEvent && now - lastInactivityActivityAt < INACTIVITY_ACTIVITY_THROTTLE_MS) {
        return;
    }

    lastInactivityActivityAt = now;
    scheduleInactivityLogoutTimer();
}

function ensureInactivityActivityListeners() {
    if (inactivityActivityListenersRegistered) return;
    inactivityActivityListenersRegistered = true;

    const resetTimer = (event?: Event) => onUserActivityForSessionTimeout(event);
    const passiveOptions: AddEventListenerOptions = { passive: true };

    document.addEventListener('click', resetTimer, passiveOptions);
    document.addEventListener('keydown', resetTimer, passiveOptions);
    document.addEventListener('mousemove', resetTimer, passiveOptions);
    document.addEventListener('touchstart', resetTimer, passiveOptions);
    document.addEventListener('scroll', resetTimer, passiveOptions);
    window.addEventListener('focus', resetTimer, passiveOptions);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') resetTimer();
    });
}

function clearAuthInlineFeedback() {
    DOM.authInlineFeedback.hidden = true;
    DOM.authInlineFeedback.textContent = '';
    DOM.authInlineFeedback.classList.remove('info');
}

function setAuthInlineFeedback(message: string, mode: 'error' | 'info' = 'error') {
    DOM.authInlineFeedback.textContent = message;
    DOM.authInlineFeedback.hidden = false;
    DOM.authInlineFeedback.classList.toggle('info', mode === 'info');
}

function updateAuthActionButtons(user: User | null) {
    const hasSession = Boolean(user);
    DOM.authLoginBtn.hidden = hasSession;
    DOM.authSignupBtn.hidden = hasSession;
    DOM.authLogoutBtn.hidden = !hasSession;
    DOM.exportDataBtn.disabled = !hasSession;
    DOM.importDataBtn.disabled = !hasSession;
    DOM.exportDataBtn.setAttribute('aria-disabled', String(!hasSession));
    DOM.importDataBtn.setAttribute('aria-disabled', String(!hasSession));
    DOM.exportDataBtn.title = hasSession
        ? 'Exportar media'
        : 'Disponível apenas com sessão ativa.';
    DOM.importDataBtn.title = hasSession
        ? 'Importar media'
        : 'Disponível apenas com sessão ativa.';
}

function setAuthFormLoadingState(isBusy: boolean) {
    authFormBusy = isBusy;
    DOM.authSubmitBtn.disabled = isBusy;
    DOM.authSubmitBtn.textContent = isBusy
        ? 'A processar...'
        : (authFormMode === 'login' ? 'Entrar' : 'Criar conta');
    DOM.authEmailInput.disabled = isBusy;
    DOM.authPasswordInput.disabled = isBusy;
    DOM.authDisplayNameInput.disabled = isBusy;
    DOM.authToggleModeBtn.disabled = isBusy;
}

function setAuthModalMode(mode: 'login' | 'signup') {
    authFormMode = mode;
    const isSignup = mode === 'signup';

    DOM.authModalTitle.textContent = isSignup ? 'Criar conta' : 'Entrar';
    DOM.authModalDescription.textContent = isSignup
        ? 'Crie a sua conta para sincronização futura de dados.'
        : 'Use email e password para iniciar sessão.';
    DOM.authDisplayNameGroup.hidden = !isSignup;
    DOM.authDisplayNameInput.required = isSignup;
    DOM.authPasswordInput.autocomplete = isSignup ? 'new-password' : 'current-password';
    DOM.authSubmitBtn.textContent = isSignup ? 'Criar conta' : 'Entrar';
    DOM.authToggleModeBtn.textContent = isSignup
        ? 'Já tens conta? Entrar'
        : 'Ainda não tens conta? Registar';
    clearAuthInlineFeedback();
}

function resetAuthForm() {
    DOM.authForm.reset();
    DOM.authDisplayNameInput.value = '';
    clearAuthInlineFeedback();
    setAuthFormLoadingState(false);
}

function openAuthModal(mode: 'login' | 'signup') {
    UI.closeNotificationModal();
    setAuthModalMode(mode);
    resetAuthForm();
    UI.openAuthModal();
}

function closeAuthModal() {
    UI.closeAuthModal();
    UI.closeNotificationModal();
    clearAuthInlineFeedback();
    setAuthFormLoadingState(false);
}

function clearInMemoryLibraryState() {
    S.setMyWatchlist([]);
    S.setMyArchive([]);
    S.setWatchedState({});
    S.setUserData({});
    S.setCurrentSearchResults([]);
    S.setDashboardSuggestedMedia([]);
}

function renderLibraryStateFromMemory() {
    UI.renderWatchlist();
    UI.renderArchive();
    UI.renderAllSeries();
    UI.renderUnseen();
    UI.renderMediaDashboard();
    UI.renderSearchResults([]);
    UI.renderNextAired([]);
    if (DOM.globalProgressPercentage) {
        DOM.globalProgressPercentage.textContent = '0%';
    }
    UI.updateKeyStats();
    void refreshNotificationsCenter();
}

function setAuthenticatedUi(user: User | null) {
    currentAuthenticatedUserId = user?.id ?? null;
    closeNotificationsMenu();
    updateTopbarIdentity(user);
    void refreshTopbarIdentityFromProfile(user);
    void refreshNotificationsCenter();
    if (currentAuthenticatedUserId) {
        scheduleInactivityLogoutTimer();
    } else {
        clearInactivityLogoutTimer();
    }
    updateAuthActionButtons(user);
    if (!isSupabaseConfigured()) {
        setAuthStatusLabel('Modo local (Supabase não configurado)', 'default');
        return;
    }
    if (user?.email) {
        setAuthStatusLabel(`Sessão ativa: ${user.email}`, 'connected');
        return;
    }
    setAuthStatusLabel('Sem sessão iniciada', 'default');
}

function handleAuthStateChange(event: AuthChangeEvent, user: User | null) {
    const previousUserId = currentAuthenticatedUserId;
    setAuthenticatedUi(user);
    if (event === 'SIGNED_IN' && user?.email) {
        onUserActivityForSessionTimeout();
        const isSameSessionRefresh = previousUserId === user.id;
        if (!isSameSessionRefresh) {
            UI.showNotification(`Sessão iniciada: ${user.email}`);
            void syncCloudStateAfterLogin(user.id);
        }
    } else if (event === 'SIGNED_OUT') {
        clearInactivityLogoutTimer();
        if (librarySyncTimer) {
            clearTimeout(librarySyncTimer);
            librarySyncTimer = null;
        }
        if (previousUserId) {
            if (lastSignOutReason === 'inactivity') {
                UI.showNotification('Sessão terminada por inatividade (30 minutos).');
            } else {
                UI.showNotification('Sessão terminada.');
            }
        }
        lastSignOutReason = null;
        clearInMemoryLibraryState();
        renderLibraryStateFromMemory();
    }
}

async function initializeAuthState() {
    ensureInactivityActivityListeners();
    if (!isSupabaseConfigured()) {
        setAuthenticatedUi(null);
        DOM.authLoginBtn.disabled = true;
        DOM.authSignupBtn.disabled = true;
        DOM.authLogoutBtn.disabled = true;
        return;
    }

    DOM.authLoginBtn.disabled = false;
    DOM.authSignupBtn.disabled = false;
    DOM.authLogoutBtn.disabled = false;
    setAuthStatusLabel('A validar sessão...', 'default');

    try {
        const session = await getCurrentSession();
        const currentUser = session?.user ?? null;
        setAuthenticatedUi(currentUser);
        if (currentUser) {
            await syncCloudStateAfterLogin(currentUser.id);
        }
    } catch (error) {
        console.error('[auth] Falha ao validar sessão inicial.', error);
        setAuthStatusLabel('Erro ao validar sessão', 'error');
    }

    subscribeToAuthState((event, session) => {
        handleAuthStateChange(event, session?.user ?? null);
    });
}

function isMediaInLibrary(mediaType: MediaType, mediaId: number): boolean {
    return S.myWatchlist.some(s => s.media_type === mediaType && s.id === mediaId)
        || S.myArchive.some(s => s.media_type === mediaType && s.id === mediaId);
}

function getMediaStateKey(mediaType: MediaType, mediaId: number): string {
    return mediaType === 'series' ? String(mediaId) : createMediaKey(mediaType, mediaId);
}

function getMediaProgressPercent(mediaType: MediaType, mediaId: number): number {
    const progress = S.userData[getMediaStateKey(mediaType, mediaId)]?.progress_percent;
    if (typeof progress !== 'number' || Number.isNaN(progress)) return 0;
    return Math.max(0, Math.min(100, Math.round(progress)));
}

async function syncMediaLibrarySectionWithProgress(
    mediaType: Extract<MediaType, 'movie' | 'book'>,
    mediaId: number,
    progressPercent: number
): Promise<'archived' | 'watchlist' | 'unchanged'> {
    const mediaItem = S.getMediaItem(mediaType, mediaId);
    if (!mediaItem) return 'unchanged';

    const isArchived = S.myArchive.some(item => item.media_type === mediaType && item.id === mediaId);
    const isSeen = progressPercent >= 100;

    if (isSeen && !isArchived) {
        await S.archiveSeries(mediaItem);
        return 'archived';
    }

    if (!isSeen && isArchived) {
        await S.unarchiveSeries(mediaItem);
        return 'watchlist';
    }

    return 'unchanged';
}

async function setAllSeriesStatusFilterPreference(status: AllSeriesStatusFilter): Promise<void> {
    S.setAllSeriesStatusFilter(status);
    if (DOM.allSeriesStatusFilter) {
        DOM.allSeriesStatusFilter.value = status;
    }
    await db.kvStore.put({ key: C.ALL_SERIES_STATUS_FILTER_KEY, value: status });
}

async function setAllSeriesMediaFilterPreference(mediaFilter: AllSeriesMediaFilter): Promise<void> {
    S.setAllSeriesMediaFilter(mediaFilter);
    if (DOM.allSeriesMediaFilter) {
        DOM.allSeriesMediaFilter.value = mediaFilter;
    }
    await db.kvStore.put({ key: C.ALL_SERIES_MEDIA_FILTER_KEY, value: mediaFilter });
}

function findMedia(mediaType: MediaType, mediaId: number): Series | undefined {
    return S.getMediaItem(mediaType, mediaId)
        || S.currentSearchResults.find((item) => item.media_type === mediaType && item.id === mediaId)
        || S.dashboardSuggestedMedia.find((item) => item.media_type === mediaType && item.id === mediaId);
}

async function refreshLibraryViewsAfterMediaChange(mediaType: MediaType): Promise<void> {
    if (mediaType === 'series') {
        await updateNextAired();
    }
    UI.renderWatchlist();
    UI.renderUnseen();
    UI.renderArchive();
    UI.renderAllSeries();
    UI.renderMediaDashboard();
    updateGlobalProgress();
    UI.updateKeyStats();
}

async function addMediaToWatchlist(media: Series | TMDbSeriesDetails) {
    const normalizedMedia = normalizeSeriesCollection([media])[0];
    if (!normalizedMedia) return;

    const mediaType = normalizedMedia.media_type || 'series';
    const isInLibrary = isMediaInLibrary(mediaType, normalizedMedia.id);
    if (isInLibrary) {
        console.warn('O conteúdo já se encontra na biblioteca.');
        return;
    }

    if (mediaType !== 'series') {
        const mediaToAdd: Series = {
            ...normalizedMedia,
            _lastUpdated: new Date().toISOString(),
        };
        await S.addSeries(mediaToAdd);
        UI.renderWatchlist();
        UI.renderUnseen();
        UI.renderAllSeries();
        updateGlobalProgress();
        UI.updateKeyStats();
        console.log('Conteúdo adicionado a "Quero Ver":', mediaToAdd);
        return;
    }

    // Se já for TMDbSeriesDetails, usa-o, senão, busca os detalhes.
    const details: TMDbSeriesDetails = 'seasons' in media ? media : await API.fetchSeriesDetails(media.id, null);
    const totalEpisodes = details.seasons
        ? details.seasons
            .filter((season) => season.season_number !== 0)
            .reduce((acc, season) => acc + season.episode_count, 0)
        : 0;

    const seriesToAdd: Series = {
        ...normalizedMedia,
        media_type: 'series',
        total_episodes: totalEpisodes,
        episode_run_time: details.episode_run_time?.[0] || 30,
        genres: details.genres,
        _details: {
            status: details.status,
            next_episode_to_air: details.next_episode_to_air,
        },
        _lastUpdated: new Date().toISOString(),
    };

    await S.addSeries(seriesToAdd);
    UI.renderWatchlist();
    UI.renderUnseen();
    await updateNextAired();
    UI.renderAllSeries();
    updateGlobalProgress();
    UI.updateKeyStats();
    console.log('Série adicionada a "Quero Ver":', seriesToAdd);
}

async function addAndMarkAllAsSeen(seriesData: Series | TMDbSeriesDetails) {
    const normalizedMedia = normalizeSeriesCollection([seriesData])[0];
    if (!normalizedMedia) return;
    if (normalizedMedia.media_type !== 'series') {
        await addMediaToWatchlist(normalizedMedia);
        return;
    }

    const isInLibrary = isMediaInLibrary('series', normalizedMedia.id);
    if (isInLibrary) {
        console.warn('A série já se encontra na biblioteca.');
        return;
    }

    // Adiciona a série (a função já busca detalhes se necessário)
    await addMediaToWatchlist(seriesData);

    // Busca os detalhes completos para obter a lista de episódios
    const fullDetails = await API.fetchSeriesDetails(normalizedMedia.id, null);
    const allSeasons = await Promise.all(fullDetails.seasons.filter(s => s.season_number !== 0).map(s => API.getSeasonDetailsWithCache(fullDetails.id, s.season_number, null)));
    const allEpisodeIds = allSeasons.flatMap(season => season.episodes.map(ep => ep.id));

    if (allEpisodeIds.length > 0) {
        await S.markEpisodesAsWatched(normalizedMedia.id, allEpisodeIds);
        const movedToArchive = await checkSeriesCompletion(normalizedMedia.id); // Move para o arquivo
        if (movedToArchive) {
            await setAllSeriesStatusFilterPreference('archive');
            UI.updateActiveNavLink('all-series-section');
        }
    }
}

async function removeSeriesFromLibrary(seriesId: number, mediaType: MediaType = 'series', element: HTMLElement | null) {
    const mediaToRemove = S.getMediaItem(mediaType, seriesId);
    const fallbackLabel = mediaType === 'movie' ? 'o filme selecionado' : mediaType === 'book' ? 'o livro selecionado' : 'a série selecionada';
    const mediaName = mediaToRemove ? mediaToRemove.name : fallbackLabel;

    if (await UI.showConfirmationModal(`Tem a certeza que quer remover "${mediaName}" da sua biblioteca? Esta ação não pode ser desfeita.`)) {
        const performRemovalLogic = async () => {
            await S.removeMedia(mediaType, seriesId);
            if (mediaType === 'series') {
                await updateNextAired();
            }
            UI.renderWatchlist();
            UI.renderArchive();
            UI.renderAllSeries();
            UI.renderUnseen();
            updateGlobalProgress();
            UI.updateKeyStats();
            console.log(`Conteúdo ${mediaType}:${seriesId} removido da biblioteca.`);
        };

        if (element) {
            element.classList.add('removing');
            element.addEventListener('transitionend', performRemovalLogic, { once: true });
        } else {
            await performRemovalLogic();
        }
    }
}

async function updateNextAired() {
    DOM.nextAiredListContainer.innerHTML = '<p>A verificar próximos episódios...</p>';
    let allUserSeries = [...S.myWatchlist, ...S.myArchive].filter(series => series.media_type === 'series');
    const now = new Date().getTime();
    const oneDay = 24 * 60 * 60 * 1000;

    const seriesToFetch = allUserSeries.filter(series => {
        if (series._details?.status === 'Ended') return false; // Não busca atualizações para séries terminadas
        const retryAt = nextAiredRetryAt.get(series.id) ?? 0;
        if (retryAt > now) return false;
        if (!series._lastUpdated) return true;
        const lastUpdatedTime = new Date(series._lastUpdated).getTime();
        if (isNaN(lastUpdatedTime)) return true;
        return (now - lastUpdatedTime) > oneDay;
    });

    if (seriesToFetch.length > 0) {
        console.log(`A atualizar detalhes para ${seriesToFetch.length} séries.`);
        const task = (series: Series) =>
            API.fetchSeriesDetails(series.id, null).then((details: any) => {
                series._details = {
                    status: details.status, // Atualiza o status
                    next_episode_to_air: details.next_episode_to_air
                };
                series._lastUpdated = new Date().toISOString();
                nextAiredRetryAt.delete(series.id);
            }).catch(err => {
                const status = getErrorStatus(err);
                if (status === 429) {
                    const retryAtMs = Date.now() + NEXT_AIRED_RATE_LIMIT_COOLDOWN_MS;
                    nextAiredRetryAt.set(series.id, retryAtMs);
                    // Atualiza com um "timestamp virtual" para permitir retry em curto prazo
                    // sem voltar a tentar imediatamente na mesma janela de rate limit.
                    series._lastUpdated = new Date(Date.now() - oneDay + NEXT_AIRED_RATE_LIMIT_COOLDOWN_MS).toISOString();
                    console.warn(`Rate limit ao buscar detalhes para ${series.name}. Novo retry em ~${Math.round(NEXT_AIRED_RATE_LIMIT_COOLDOWN_MS / 1000)}s.`);
                    return;
                }
                console.error(`Falha ao buscar detalhes para ${series.name}`, err);
                // Em erro não-429, atualiza timestamp para evitar loops agressivos.
                series._lastUpdated = new Date().toISOString();
            });

        // Processa em lotes para não sobrecarregar a API
        const results = await processInBatches(seriesToFetch, NEXT_AIRED_BATCH_SIZE, NEXT_AIRED_BATCH_DELAY_MS, task);
        const updatedSeries = seriesToFetch.filter((_, index) => results[index].status === 'fulfilled');
        if (updatedSeries.length > 0) {
            await db.watchlist.bulkPut(updatedSeries.filter(s => S.myWatchlist.some(ws => ws.id === s.id)));
            await db.archive.bulkPut(updatedSeries.filter(s => S.myArchive.some(as => as.id === s.id)));
        }
    }

    const seriesToUnarchiveIds = allUserSeries
        .filter(series =>
            series._details?.next_episode_to_air && S.myArchive.some(s => s.id === series.id)
        )
        .map(series => series.id);

    if (seriesToUnarchiveIds.length > 0) {
        for (const seriesId of seriesToUnarchiveIds) {
            const series = S.getSeries(seriesId);
            if(series) await S.unarchiveSeries(series);
        }
        allUserSeries = [...S.myWatchlist, ...S.myArchive];
    }

    // Verifica se algum dos episódios que estavam agendados já foi para o ar
    const justAiredSeriesIds = allUserSeries
        .filter(series => {
            const nextEp = series._details?.next_episode_to_air;
            return nextEp && new Date(nextEp.air_date).getTime() < now;
        })
        .map(series => series.id);

    if (justAiredSeriesIds.length > 0) {
        console.log(`A atualizar metadados para ${justAiredSeriesIds.length} séries com episódios recém-lançados.`);
        const refreshTask = async (seriesId: number) => {
            const series = S.getSeries(seriesId);
            if (series) {
                const freshData = await API.fetchSeriesDetails(seriesId, null);
                series.total_episodes = freshData.seasons?.filter(s => s.season_number !== 0).reduce((acc, s) => acc + s.episode_count, 0) || 0;
                series._details = { status: freshData.status, next_episode_to_air: freshData.next_episode_to_air };
                series._lastUpdated = new Date().toISOString();
                await S.updateSeries(series);
            }
        };
        await processInBatches(justAiredSeriesIds, NEXT_AIRED_BATCH_SIZE, NEXT_AIRED_BATCH_DELAY_MS, refreshTask);
    }

    const upcomingEpisodes = allUserSeries
        .map(series => {
            if (series._details?.next_episode_to_air) {
                return { seriesName: series.name, seriesPoster: series.poster_path, episode: series._details.next_episode_to_air };
            }
            return null;
        });

    const filteredUpcoming = upcomingEpisodes.filter((ep): ep is NonNullable<typeof ep> => ep !== null);

    filteredUpcoming.sort((a, b) => new Date(a.episode.air_date).getTime() - new Date(b.episode.air_date).getTime());

    UI.renderNextAired(filteredUpcoming);
    void refreshNotificationsCenter();
}

/**
 * Configura os botões de ação na vista de detalhes da série (adicionar/remover).
 * @param seriesData - Os detalhes da série.
 */
async function setupDetailViewActions(seriesData: TMDbSeriesDetails) {
    const isAlreadyInLibrary = await S.getSeries(seriesData.id) !== undefined;
    const libraryActions = document.getElementById('library-actions') as HTMLDivElement;
    const discoverActions = document.getElementById('discover-actions') as HTMLDivElement;

    if (!libraryActions || !discoverActions) {
        console.warn("Os contentores de ações não foram encontrados no DOM.");
        return;
    }

    libraryActions.style.display = isAlreadyInLibrary ? 'flex' : 'none';
    discoverActions.style.display = isAlreadyInLibrary ? 'none' : 'flex';

    if (isAlreadyInLibrary) {
        const removeBtn = libraryActions.querySelector<HTMLButtonElement>('#v2-remove-series-btn');
        removeBtn?.addEventListener('click', () => removeSeriesFromLibrary(seriesData.id, 'series', null), { once: true });
    } else {
        const addToWatchlistBtn = discoverActions.querySelector<HTMLButtonElement>('#add-to-watchlist-btn');
        const addAndMarkAllBtn = discoverActions.querySelector<HTMLButtonElement>('#add-and-mark-all-seen-btn');

        addToWatchlistBtn?.addEventListener('click', () => handleAddSeries(seriesData, addToWatchlistBtn), { once: true });
        addAndMarkAllBtn?.addEventListener('click', () => handleAddAndMarkAllSeen(seriesData, addAndMarkAllBtn), { once: true });
    }
}

function getMainContentScrollContainer(): HTMLElement | null {
    return document.querySelector<HTMLElement>('.main-content');
}

function getVisibleMainSectionId(): string | null {
    const visibleSection = Array.from(DOM.mainContentSections).find(section => section.style.display !== 'none');
    return visibleSection?.id || null;
}

function captureDetailReturnContext() {
    const visibleSectionId = getVisibleMainSectionId();
    if (!visibleSectionId || visibleSectionId === 'series-view-section') return;
    const mainContent = getMainContentScrollContainer();
    detailReturnContext = {
        sectionId: visibleSectionId,
        scrollTop: mainContent?.scrollTop ?? 0,
    };
}

function navigateBackFromSeriesDetails() {
    const fallbackSection = 'watchlist-section';
    const targetSection = detailReturnContext?.sectionId || fallbackSection;
    const targetScrollTop = detailReturnContext?.scrollTop ?? 0;
    UI.showSection(targetSection);
    updateMainMenuActiveState(getMainMenuTargetFromSection(targetSection));
    const mainContent = getMainContentScrollContainer();
    if (mainContent) {
        requestAnimationFrame(() => {
            mainContent.scrollTop = targetScrollTop;
        });
    }
}



async function displaySeriesDetails(seriesId: number) {
    S.resetDetailViewAbortController();
    const signal = S.detailViewAbortController.signal;

    try {
        captureDetailReturnContext();
        DOM.seriesViewSection.innerHTML = '<p>A carregar detalhes da série...</p>';
        UI.showSection('series-view-section');
        
        const seriesData = await runObservedSection(
            'series-details',
            `/api/tmdb/tv/${seriesId}`,
            () => API.fetchSeriesDetails(seriesId, signal),
            { seriesId }
        );
        const creditsData = await runObservedSection(
            'series-details',
            `/api/tmdb/tv/${seriesId}/aggregate_credits`,
            () => API.fetchSeriesCredits(seriesId, signal),
            { seriesId, optional: 'credits' }
        ).catch((error) => {
            if (error instanceof Error && error.name === 'AbortError') throw error;
            console.warn('Falha ao carregar créditos da série. A vista de detalhes continuará sem elenco.', error);
            return { cast: [] };
        });
        const fallbackYear = seriesData.first_air_date ? Number(seriesData.first_air_date.split('-')[0]) : undefined;
        const fallbackOriginalTitle = seriesData.original_name && seriesData.original_name !== seriesData.name
            ? seriesData.original_name
            : undefined;
        const traktSeriesData = await API.fetchTraktData(
            seriesId,
            signal,
            seriesData.name,
            fallbackYear,
            fallbackOriginalTitle,
            seriesData.external_ids?.imdb_id
        );
        if (traktSeriesData?.traktId) {
            console.info('[match][details] Trakt match resolvido.', {
                seriesId,
                traktId: traktSeriesData.traktId,
            });
        } else {
            console.warn('[match][details] Trakt sem match confiável. Seguir com fontes restantes.', {
                seriesId,
                imdbId: seriesData.external_ids?.imdb_id || null,
                year: fallbackYear ?? null,
            });
        }
        const aggregatedMetadataPromise = runObservedSection(
            'series-details',
            `/api/aggregate/series/${seriesId}`,
            () => API.fetchAggregatedSeriesMetadata({
                seriesId,
                signal,
                tmdbOverviewPt: seriesData.overview,
                traktData: traktSeriesData,
                fallbackTitle: seriesData.name,
                fallbackYear,
                fallbackImdbId: seriesData.external_ids?.imdb_id,
            }),
            { seriesId, phase: 'aggregation' }
        ).catch((error) => {
            if (error instanceof Error && error.name === 'AbortError') throw error;
            console.warn('Falha na agregação de metadados (P3-02). A continuar com dados base.', error);
            return null;
        });

        // Fallback para trailer: se Trakt falhar e TMDb(pt-PT) não tiver vídeos,
        // tenta vídeos TMDb em en-US para recuperar o botão "Ver Trailer".
        const hasYouTubeVideo = Array.isArray(seriesData.videos?.results)
            && seriesData.videos.results.some(video => video.site === 'YouTube');
        if (!traktSeriesData?.trailerKey && !hasYouTubeVideo) {
            try {
                const fallbackVideos = await runObservedSection(
                    'series-details',
                    `/api/tmdb/tv/${seriesId}/videos?language=en-US`,
                    () => API.fetchSeriesVideos(seriesId, signal, 'en-US'),
                    { seriesId, fallbackLanguage: 'en-US' }
                );
                if (Array.isArray(fallbackVideos?.results) && fallbackVideos.results.length > 0) {
                    const currentVideos = seriesData.videos?.results || [];
                    const mergedVideos = [...currentVideos, ...fallbackVideos.results].filter((video, index, arr) =>
                        arr.findIndex(v => v.key === video.key) === index
                    );
                    seriesData.videos = { results: mergedVideos };
                }
            } catch (error) {
                console.warn('Falha ao carregar fallback de vídeos TMDb (en-US):', error);
            }
        }

        const traktId = traktSeriesData?.traktId as number | undefined;
        const seasonsToFetch = seriesData.seasons.filter(s => s.season_number !== 0);
        const seasonPromises = seasonsToFetch.map(s => API.getSeasonDetailsWithCache(seriesId, s.season_number, signal));
        const traktSeasonPromise = API.fetchTraktSeasonsData(traktId, signal);

        const [seasonResults, traktSeasonsData, aggregatedSeriesData] = await Promise.all([
            Promise.allSettled(seasonPromises),
            traktSeasonPromise,
            aggregatedMetadataPromise,
        ]);
        if (aggregatedSeriesData?.tvmazeData?.show?.id) {
            console.info('[match][details] TVMaze match resolvido.', {
                seriesId,
                tvmazeId: aggregatedSeriesData.tvmazeData.show.id,
                method: aggregatedSeriesData.tvmazeData.match?.method,
                score: aggregatedSeriesData.tvmazeData.match?.score,
            });
        } else {
            console.warn('[match][details] TVMaze sem match confiável.', { seriesId });
        }
        const allTMDbSeasonsData = seasonResults.filter((res): res is PromiseFulfilledResult<any> => res.status === 'fulfilled').map(res => res.value);

        const allEpisodesForSeries = allTMDbSeasonsData.flatMap(season => season.episodes);
        const allEpisodesMeta = allEpisodesForSeries.map(ep => ({
            id: ep.id,
            season_number: ep.season_number,
            episode_number: ep.episode_number,
        }));

        const episodeToSeasonMap: { [key: number]: number } = {};
        allTMDbSeasonsData.forEach(season => {
            season.episodes.forEach((episode: Episode) => {
                episodeToSeasonMap[episode.id] = season.season_number!;
            });
        });

        const seasons = seriesData.seasons.filter(season => season.season_number !== 0);
        S.setDetailViewData({
            allEpisodes: allEpisodesMeta,
            episodeMap: episodeToSeasonMap,
            seasons: seasons.map(s => ({ season_number: s.season_number, episode_count: s.episode_count })),
        });

        UI.renderSeriesDetails(seriesData, allTMDbSeasonsData, creditsData, traktSeriesData, traktSeasonsData, aggregatedSeriesData);

        await setupDetailViewActions(seriesData);

    } catch (error) {
        const typedError = error as Error;
        if (typedError.name === 'AbortError') {
            console.log('Fetch aborted for series details view.');
            return;
        }
        recordSectionFailure(
            'series-details',
            `/series-view/${seriesId}`,
            typedError,
            { phase: 'render' }
        );
        persistObservabilitySnapshot();
        console.error('Erro ao exibir detalhes da série:', typedError.message);
        DOM.seriesViewSection.innerHTML = `<p>Não foi possível carregar os detalhes da série. Tente novamente mais tarde.</p>`;
        const status = getErrorStatus(typedError);
        if (status === 429) {
            UI.showNotification('Demasiados pedidos em pouco tempo. Tente novamente dentro de 1 minuto.');
            return;
        }
        UI.showNotification(`Erro ao carregar série: ${typedError.message}`);
    }
}

async function displayMovieDetails(media: Series): Promise<void> {
    S.resetDetailViewAbortController();
    const signal = S.detailViewAbortController.signal;
    captureDetailReturnContext();
    DOM.seriesViewSection.innerHTML = '<p>A carregar detalhes do filme...</p>';
    UI.showSection('series-view-section');

    const movieDetails = await runObservedSection(
        'series-details',
        `/api/tmdb/movie/${media.source_id || media.id}`,
        () => API.fetchMovieDetails(media.id, signal, media.source_id),
        { mediaType: 'movie', mediaId: media.id }
    );

    const isInLibrary = isMediaInLibrary('movie', movieDetails.id);
    const isArchived = S.myArchive.some(item => item.media_type === 'movie' && item.id === movieDetails.id);
    const progressPercent = getMediaProgressPercent('movie', movieDetails.id);
    UI.renderMediaDetails(movieDetails, { progressPercent, isInLibrary, isArchived });
}

async function displayBookDetails(media: Series): Promise<void> {
    S.resetDetailViewAbortController();
    const signal = S.detailViewAbortController.signal;
    captureDetailReturnContext();
    DOM.seriesViewSection.innerHTML = '<p>A carregar detalhes do livro...</p>';
    UI.showSection('series-view-section');

    const bookDetails = await runObservedSection(
        'series-details',
        `/api/books/details`,
        () => API.fetchBookDetails(media, signal),
        { mediaType: 'book', mediaId: media.id }
    );

    const isInLibrary = isMediaInLibrary('book', bookDetails.id);
    const isArchived = S.myArchive.some(item => item.media_type === 'book' && item.id === bookDetails.id);
    const progressPercent = getMediaProgressPercent('book', bookDetails.id);
    UI.renderMediaDetails(bookDetails, { progressPercent, isInLibrary, isArchived });
}

async function displayMediaDetails(mediaType: MediaType, mediaId: number) {
    if (mediaType === 'series') {
        await displaySeriesDetails(mediaId);
        return;
    }

    const media = findMedia(mediaType, mediaId);
    if (!media) {
        UI.showNotification('Não foi possível localizar este conteúdo.');
        return;
    }

    try {
        if (mediaType === 'movie') {
            await displayMovieDetails(media);
            return;
        }
        if (mediaType === 'book') {
            await displayBookDetails(media);
            return;
        }
    } catch (error) {
        const typedError = error as Error;
        if (typedError.name === 'AbortError') return;
        recordSectionFailure(
            'series-details',
            `/media-view/${mediaType}/${mediaId}`,
            typedError,
            { phase: 'render', mediaType, mediaId }
        );
        persistObservabilitySnapshot();
        DOM.seriesViewSection.innerHTML = '<p>Não foi possível carregar os detalhes deste conteúdo.</p>';
        UI.showNotification(`Erro ao carregar detalhes: ${typedError.message}`);
    }
}

async function handleAddSeries(seriesData: TMDbSeriesDetails, button: HTMLButtonElement | null) {
    if (button) button.disabled = true;
    try {
        await addMediaToWatchlist(seriesData);
        UI.showNotification(`"${seriesData.name}" foi adicionada à sua lista 'Quero Ver'.`);
        await displaySeriesDetails(seriesData.id); // Recarrega a vista de detalhes
    } catch (error) {
        console.error("Erro ao adicionar série à lista 'Quero Ver':", error);
        UI.showNotification("Ocorreu um erro ao adicionar a série.");
        if (button) button.disabled = false;
    }
}

async function handleAddAndMarkAllSeen(seriesData: TMDbSeriesDetails, button: HTMLButtonElement | null) {
    if (button) button.disabled = true;
    try {
        await addAndMarkAllAsSeen(seriesData);
        UI.showNotification(`"${seriesData.name}" foi adicionada e marcada como vista.`);
        await displaySeriesDetails(seriesData.id);
    } catch (error) {
        console.error("Erro ao adicionar e marcar série como vista:", error);
        UI.showNotification("Ocorreu um erro ao executar a ação.");
        if (button) button.disabled = false;
    }
}

async function handleQuickAdd(series: Series, button: HTMLButtonElement) {
    await addMediaToWatchlist(series);
    UI.markButtonAsAdded(button, 'Adicionado');
}

async function handleQuickAddAndMarkAllSeen(series: Series, button: HTMLButtonElement) {
    if (series.media_type !== 'series') {
        await addMediaToWatchlist(series);
        UI.markButtonAsAdded(button, 'Adicionado');
        return;
    }
    await addAndMarkAllAsSeen(series);
    UI.markButtonAsAdded(button, 'Visto');
}

/**
 * Lida com a ação de marcar um episódio como visto.
 * @param seriesId - ID da série.
 * @param episodeId - ID do episódio.
 * @param episodeElement - O elemento HTML do episódio.
 */
async function handleMarkAsSeen(seriesId: number, episodeId: number): Promise<void> {
    const watchedSet = new Set(S.watchedState[seriesId] || []);
    const allEpisodes = S.getDetailViewData().allEpisodes;
    let episodesToMarkAsSeen = [episodeId];

    if (allEpisodes.length > 0) {
        const clickedEpisodeIndex = allEpisodes.findIndex(ep => ep.id === episodeId);

        if (clickedEpisodeIndex > 0) {
            const previousEpisodes = allEpisodes.slice(0, clickedEpisodeIndex);
            const unwatchedPrevious = previousEpisodes.filter(ep => !watchedSet.has(ep.id));
            if (unwatchedPrevious.length > 0 && await UI.showConfirmationModal(`Existem ${unwatchedPrevious.length} episódios anteriores por ver. Deseja marcá-los também como vistos?`)) {
                episodesToMarkAsSeen.push(...unwatchedPrevious.map(ep => ep.id));
            }
        }
    }

    const isFirstWatched = watchedSet.size === 0;
    await S.markEpisodesAsWatched(seriesId, episodesToMarkAsSeen);

    episodesToMarkAsSeen.forEach(idToMark => {
        const elementToMark = document.querySelector<HTMLElement>(`.episode-item[data-episode-id="${idToMark}"]`);
        if (elementToMark) {
            UI.markEpisodeAsSeen(elementToMark);
        }
    });

    UI.renderWatchlist();
    UI.renderUnseen();

    if (isFirstWatched && episodesToMarkAsSeen.length > 0) {
        UI.updateActiveNavLink('unseen-section');
    }

    const movedToArchive = await checkSeriesCompletion(seriesId);
    if (movedToArchive) {
        await setAllSeriesStatusFilterPreference('archive');
        UI.updateActiveNavLink('all-series-section');
    }
}

/**
 * Lida com a ação de desmarcar um episódio como visto.
 * @param seriesId - ID da série.
 * @param episodeId - ID do episódio.
 * @param episodeElement - O elemento HTML do episódio.
 */
async function handleUnmarkAsSeen(seriesId: number, episodeId: number): Promise<void> {
    await S.unmarkEpisodesAsWatched(seriesId, [episodeId]);
}

async function toggleEpisodeWatched(seriesId: number, episodeId: number, seasonNumber: number, episodeElement: HTMLElement) {
    // Otimização: Usar um Set para pesquisas mais rápidas (O(1) em vez de O(n)).
    const watchedSet = new Set(S.watchedState[seriesId] || []);
    const isSeen = watchedSet.has(episodeId);
    const wasInArchive = S.myArchive.some(s => s.id === seriesId);

    if (isSeen) {
        await handleUnmarkAsSeen(seriesId, episodeId);
        UI.markEpisodeAsUnseen(episodeElement);
        if (wasInArchive) {
            const series = S.getSeries(seriesId);
            if(series) await S.unarchiveSeries(series);
            UI.renderArchive();
            UI.renderUnseen();
            UI.updateActiveNavLink('unseen-section');
        } else {
            UI.renderWatchlist();
            UI.renderUnseen();
        }
    } else {
        await handleMarkAsSeen(seriesId, episodeId);
    }

    UI.updateOverallProgressBar(seriesId);
    UI.updateSeasonProgressUI(seriesId, seasonNumber);
    updateGlobalProgress();
    UI.updateKeyStats();
}

async function checkSeriesCompletion(seriesId: number): Promise<boolean> {
    try {
        const series = S.getSeries(seriesId);
        if (!series) return false;

        const watchedEpisodesCount = S.watchedState[seriesId]?.length || 0;
        let totalEpisodes = series.total_episodes;

        if (totalEpisodes === undefined || (totalEpisodes > 0 && watchedEpisodesCount >= totalEpisodes)) {
            const freshData = await API.fetchSeriesDetails(seriesId, null);
            const freshTotalEpisodes = freshData.seasons
                ? freshData.seasons
                    .filter((season) => season.season_number !== 0)
                    .reduce((acc, season) => acc + season.episode_count, 0)
                : 0;

            if (freshTotalEpisodes !== totalEpisodes) {
                series.total_episodes = freshTotalEpisodes;
                totalEpisodes = freshTotalEpisodes; // Re-assign after update
                series._details = { status: freshData.status, next_episode_to_air: freshData.next_episode_to_air, };
                series._lastUpdated = new Date().toISOString();
                await S.updateSeries(series);
            }
        }

        const isComplete = totalEpisodes !== undefined && totalEpisodes > 0 && watchedEpisodesCount >= totalEpisodes;

        if (isComplete) {
            await S.archiveSeries(series);
            UI.renderWatchlist();
            UI.renderUnseen();
            UI.renderArchive();
            UI.renderAllSeries();
            return true; // Indica que a série foi movida para o arquivo.
        }
        return false;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("Erro ao verificar a conclusão da série:", message);
        return false;
    }
}

const TOTAL_EPISODES_RETRY_COOLDOWN_MS = 60 * 1000;
const totalEpisodesRetryAt = new Map<number, number>();

async function updateGlobalProgress() {
    if (!DOM.globalProgressPercentage) {
        return;
    }

    const seriesInProgress = S.myWatchlist.filter(series => S.watchedState[series.id] && S.watchedState[series.id].length > 0);
    if (seriesInProgress.length === 0) {
        DOM.globalProgressPercentage.textContent = '0%';
        return;
    }

    const now = Date.now();
    const seriesNeedingTotals = seriesInProgress.filter(series => {
        const hasValidTotal = typeof series.total_episodes === 'number' && series.total_episodes > 0;
        if (hasValidTotal) return false;
        const retryAt = totalEpisodesRetryAt.get(series.id) ?? 0;
        return now >= retryAt;
    });

    if (seriesNeedingTotals.length > 0) {
        const updatedSeries: Series[] = [];
        await Promise.all(seriesNeedingTotals.map(async (series) => {
            try {
                const details = await API.fetchSeriesDetails(series.id, null);
                const count = details.seasons
                    ?.filter(season => season.season_number !== 0)
                    .reduce((acc, season) => acc + season.episode_count, 0) || 0;

                if (count > 0) {
                    if (series.total_episodes !== count) {
                        series.total_episodes = count;
                        updatedSeries.push(series);
                    }
                    totalEpisodesRetryAt.delete(series.id);
                    return;
                }

                // Não grava 0 em caso de payload incompleto/transitório.
                delete series.total_episodes;
                totalEpisodesRetryAt.set(series.id, Date.now() + TOTAL_EPISODES_RETRY_COOLDOWN_MS);
                console.warn(`Total de episódios indisponível para série ${series.id}. Novo retry agendado.`);
            } catch (err) {
                // Preserva o último valor conhecido e volta a tentar após cooldown.
                totalEpisodesRetryAt.set(series.id, Date.now() + TOTAL_EPISODES_RETRY_COOLDOWN_MS);
                console.error(`Failed to fetch details for series ${series.id} to update progress`, err);
            }
        }));

        if (updatedSeries.length > 0) {
            await db.watchlist.bulkPut(updatedSeries);
        }
    }

    let totalEpisodes = 0;
    let totalWatched = 0;
    seriesInProgress.forEach(series => {
        const seriesTotalEpisodes = series.total_episodes;
        if (typeof seriesTotalEpisodes === 'number' && seriesTotalEpisodes > 0) {
            totalEpisodes += seriesTotalEpisodes;
            totalWatched += S.watchedState[series.id]?.length || 0;
        }
    });

    const percentage = totalEpisodes > 0 ? Math.round((totalWatched / totalEpisodes) * 100) : 0;
    DOM.globalProgressPercentage.textContent = `${percentage}%`;
}

function setupViewToggle(toggleElement: HTMLElement, container: HTMLElement, storageKey: string, renderFunction: () => void) {
    if (!toggleElement) return;
    toggleElement.addEventListener('click', async (e) => {
        const button = (e.target as Element).closest('[data-view]');
        if (!button) return;

        const view = (button as HTMLElement).dataset.view;
        if (view) {
            await db.kvStore.put({ key: storageKey, value: view });
            await syncUserSettingsToRemoteIfNeeded();
            UI.applyViewMode(view, container, toggleElement);
            renderFunction();
        }
    });
}

async function exportData(): Promise<void> {
    DOM.settingsMenu.classList.remove('visible');
    if (!currentAuthenticatedUserId) {
        UI.showNotification('Inicie sessão para exportar a biblioteca.');
        return;
    }
    try {
        const watchedStateRecords = await db.watchedState.toArray();
        const userDataRecords = await db.userData.toArray();
        const backupData = {
            version: 3,
            format: 'seriesdb-multimedia-v1',
            timestamp: new Date().toISOString(),
            library: {
                watchlist: S.myWatchlist,
                archive: S.myArchive,
            },
            state: {
                watchedState: S.watchedState,
                userData: S.userData,
            },
            records: {
                watchedState: watchedStateRecords,
                userData: userDataRecords,
            },
            // Compatibilidade com versões antigas do import.
            watchlist: S.myWatchlist,
            archive: S.myArchive,
            watchedState: S.watchedState,
            userData: S.userData,
        } as any;
        const jsonString = JSON.stringify(backupData, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const date = new Date().toISOString().split('T')[0];
        const suggestedName = `seriesdb_backup_${date}.json`;

        if (window.showSaveFilePicker) {
            const handle = await window.showSaveFilePicker({ suggestedName, types: [{ description: 'Ficheiros JSON', accept: { 'application/json': ['.json'] } }] });
            const writable = await handle.createWritable();
            await writable.write(blob);
            await writable.close();
            UI.showNotification('Dados exportados com sucesso!');
        } else {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = suggestedName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            UI.showNotification('Download iniciado! Verifique a sua pasta de downloads.');
        }
    } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
            console.error('Erro ao exportar dados:', error);
            UI.showNotification('Ocorreu um erro ao exportar os dados.');
        }
    }
}

async function importData(): Promise<void> {
    DOM.settingsMenu.classList.remove('visible');
    if (!currentAuthenticatedUserId) {
        UI.showNotification('Inicie sessão para importar a biblioteca.');
        return;
    }
    if (!await UI.showConfirmationModal('Tem a certeza que quer importar os dados? Isto irá substituir todos os dados atuais.')) {
        return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (event: ProgressEvent<FileReader>) => {
            if (!event.target?.result) return;
            try {
                const data = JSON.parse(event.target.result as string);
                const rawWatchlist = Array.isArray(data?.library?.watchlist)
                    ? data.library.watchlist
                    : data?.watchlist;
                const rawArchive = Array.isArray(data?.library?.archive)
                    ? data.library.archive
                    : data?.archive;
                if (!Array.isArray(rawWatchlist) || !Array.isArray(rawArchive)) {
                    throw new Error('Ficheiro de backup inválido ou corrompido.');
                }

                const remappedMediaKeys = new Map<string, string>();
                const normalizeImportedLibrary = (rawCollection: unknown): Series[] => {
                    const normalizedCollection = normalizeSeriesCollection(rawCollection);
                    const dedupedByMediaKey = new Map<string, Series>();

                    normalizedCollection.forEach((entry) => {
                        const mediaType = parseMediaType(entry.media_type);
                        const originalId = Number(entry.id);
                        if (!Number.isFinite(originalId)) return;
                        const originalMediaId = Math.trunc(originalId);
                        let normalizedMediaId = originalMediaId;

                        if (mediaType === 'movie') {
                            const isScopedMovieId = normalizedMediaId >= 1_000_000_000 && normalizedMediaId < 2_000_000_000;
                            if (!isScopedMovieId) {
                                const sourceNumericId = Number(entry.source_id);
                                const movieSourceId = Number.isFinite(sourceNumericId) ? Math.trunc(sourceNumericId) : normalizedMediaId;
                                normalizedMediaId = toScopedMovieId(movieSourceId);
                            }
                        } else if (mediaType === 'book') {
                            const isScopedBookId = normalizedMediaId >= 2_000_000_000 && normalizedMediaId < 3_000_000_000;
                            if (!isScopedBookId) {
                                normalizedMediaId = toScopedBookId(entry.source_id || String(normalizedMediaId));
                            }
                        }

                        const normalizedEntry: Series = {
                            ...entry,
                            media_type: mediaType,
                            id: normalizedMediaId,
                        };

                        const originalKey = createMediaKey(mediaType, originalMediaId);
                        const normalizedKey = createMediaKey(mediaType, normalizedMediaId);
                        if (originalKey !== normalizedKey) {
                            remappedMediaKeys.set(originalKey, normalizedKey);
                        }

                        dedupedByMediaKey.set(normalizedKey, normalizedEntry);
                    });

                    return Array.from(dedupedByMediaKey.values());
                };

                const normalizeImportedWatchedItems = (
                    watchedStateObject: unknown,
                    watchedStateRecords: unknown
                ): WatchedStateItem[] => {
                    const watchedItemsMap = new Map<string, WatchedStateItem>();

                    if (watchedStateObject && typeof watchedStateObject === 'object') {
                        for (const [stateKey, rawEpisodes] of Object.entries(watchedStateObject as Record<string, unknown>)) {
                            if (!Array.isArray(rawEpisodes)) continue;
                            const parsedMedia = parseMediaKey(stateKey);
                            if (!parsedMedia) continue;

                            const sourceMediaKey = createMediaKey(parsedMedia.media_type, parsedMedia.media_id);
                            const normalizedMediaKey = remappedMediaKeys.get(sourceMediaKey) || sourceMediaKey;
                            const normalizedMedia = parseMediaKey(normalizedMediaKey);
                            if (!normalizedMedia) continue;

                            rawEpisodes.forEach((episodeId) => {
                                if (episodeId === null || episodeId === undefined) return;
                                const parsedEpisodeId = Number.parseInt(String(episodeId), 10);
                                if (Number.isNaN(parsedEpisodeId)) return;

                                const item: WatchedStateItem = {
                                    media_key: normalizedMediaKey,
                                    media_type: normalizedMedia.media_type,
                                    media_id: normalizedMedia.media_id,
                                    seriesId: normalizedMedia.media_id,
                                    episodeId: parsedEpisodeId,
                                };
                                watchedItemsMap.set(`${item.media_key}:${item.episodeId}`, item);
                            });
                        }
                    }

                    if (Array.isArray(watchedStateRecords)) {
                        watchedStateRecords.forEach((record) => {
                            if (!record || typeof record !== 'object') return;
                            const parsedRecord = record as Record<string, unknown>;
                            const rawMediaKey = typeof parsedRecord.media_key === 'string' ? parsedRecord.media_key : null;
                            let parsedMedia = rawMediaKey ? parseMediaKey(rawMediaKey) : null;
                            if (!parsedMedia) {
                                const mediaId = Number(parsedRecord.media_id ?? parsedRecord.seriesId);
                                if (!Number.isFinite(mediaId)) return;
                                parsedMedia = {
                                    media_type: parseMediaType(parsedRecord.media_type as string),
                                    media_id: Math.trunc(mediaId),
                                };
                            }

                            const sourceMediaKey = createMediaKey(parsedMedia.media_type, parsedMedia.media_id);
                            const normalizedMediaKey = remappedMediaKeys.get(sourceMediaKey) || sourceMediaKey;
                            const normalizedMedia = parseMediaKey(normalizedMediaKey);
                            if (!normalizedMedia) return;

                            const parsedEpisodeId = Number.parseInt(String(parsedRecord.episodeId), 10);
                            if (Number.isNaN(parsedEpisodeId)) return;

                            const item: WatchedStateItem = {
                                media_key: normalizedMediaKey,
                                media_type: normalizedMedia.media_type,
                                media_id: normalizedMedia.media_id,
                                seriesId: normalizedMedia.media_id,
                                episodeId: parsedEpisodeId,
                            };
                            watchedItemsMap.set(`${item.media_key}:${item.episodeId}`, item);
                        });
                    }

                    return Array.from(watchedItemsMap.values());
                };

                const normalizeImportedUserDataItems = (
                    userDataObject: unknown,
                    userDataRecords: unknown
                ): UserDataItem[] => {
                    const userDataMap = new Map<string, UserDataItem>();

                    if (userDataObject && typeof userDataObject === 'object') {
                        for (const [stateKey, rawValue] of Object.entries(userDataObject as Record<string, unknown>)) {
                            const parsedMedia = parseMediaKey(stateKey);
                            if (!parsedMedia || !rawValue || typeof rawValue !== 'object') continue;
                            const sourceMediaKey = createMediaKey(parsedMedia.media_type, parsedMedia.media_id);
                            const normalizedMediaKey = remappedMediaKeys.get(sourceMediaKey) || sourceMediaKey;
                            const normalizedMedia = parseMediaKey(normalizedMediaKey);
                            if (!normalizedMedia) continue;

                            const valueRecord = rawValue as Record<string, unknown>;
                            const rawProgress = valueRecord.progress_percent ?? valueRecord.progressPercent;
                            const progressPercent = typeof rawProgress === 'number' ? rawProgress : undefined;
                            const item: UserDataItem = {
                                media_key: normalizedMediaKey,
                                media_type: normalizedMedia.media_type,
                                media_id: normalizedMedia.media_id,
                                seriesId: normalizedMedia.media_id,
                                rating: typeof valueRecord.rating === 'number' ? valueRecord.rating : undefined,
                                notes: typeof valueRecord.notes === 'string' ? valueRecord.notes : undefined,
                                progress_percent: progressPercent,
                            };
                            userDataMap.set(item.media_key, item);
                        }
                    }

                    if (Array.isArray(userDataRecords)) {
                        userDataRecords.forEach((record) => {
                            if (!record || typeof record !== 'object') return;
                            const parsedRecord = record as Record<string, unknown>;
                            const rawMediaKey = typeof parsedRecord.media_key === 'string' ? parsedRecord.media_key : null;
                            let parsedMedia = rawMediaKey ? parseMediaKey(rawMediaKey) : null;
                            if (!parsedMedia) {
                                const mediaId = Number(parsedRecord.media_id ?? parsedRecord.seriesId);
                                if (!Number.isFinite(mediaId)) return;
                                parsedMedia = {
                                    media_type: parseMediaType(parsedRecord.media_type as string),
                                    media_id: Math.trunc(mediaId),
                                };
                            }
                            const sourceMediaKey = createMediaKey(parsedMedia.media_type, parsedMedia.media_id);
                            const normalizedMediaKey = remappedMediaKeys.get(sourceMediaKey) || sourceMediaKey;
                            const normalizedMedia = parseMediaKey(normalizedMediaKey);
                            if (!normalizedMedia) return;
                            const rawProgress = parsedRecord.progress_percent ?? parsedRecord.progressPercent;
                            const progressPercent = typeof rawProgress === 'number' ? rawProgress : undefined;

                            const item: UserDataItem = {
                                media_key: normalizedMediaKey,
                                media_type: normalizedMedia.media_type,
                                media_id: normalizedMedia.media_id,
                                seriesId: normalizedMedia.media_id,
                                rating: typeof parsedRecord.rating === 'number' ? parsedRecord.rating : undefined,
                                notes: typeof parsedRecord.notes === 'string' ? parsedRecord.notes : undefined,
                                progress_percent: progressPercent,
                            };
                            userDataMap.set(item.media_key, item);
                        });
                    }

                    return Array.from(userDataMap.values());
                };

                const normalizedWatchlist = normalizeImportedLibrary(rawWatchlist);
                const normalizedArchive = normalizeImportedLibrary(rawArchive);
                const importedWatchedState = data?.state?.watchedState ?? data?.progress?.watchedState ?? data?.watchedState;
                const importedWatchedRecords = data?.records?.watchedState ?? data?.watchedStateRecords ?? data?.user_progress;
                const importedUserData = data?.state?.userData ?? data?.progress?.userData ?? data?.userData;
                const importedUserDataRecords = data?.records?.userData ?? data?.userDataRecords ?? data?.user_notes_ratings;
                const watchedItems = normalizeImportedWatchedItems(importedWatchedState, importedWatchedRecords);
                const userDataItems = normalizeImportedUserDataItems(importedUserData, importedUserDataRecords);

                await db.transaction('rw', [db.watchlist, db.archive, db.watchedState, db.userData], async () => {
                    await db.watchlist.clear();
                    await db.archive.clear();
                    await db.watchedState.clear();
                    await db.userData.clear();
                    await db.watchlist.bulkPut(normalizedWatchlist);
                    await db.archive.bulkPut(normalizedArchive);
                    if (watchedItems.length > 0) await db.watchedState.bulkPut(watchedItems);
                    if (userDataItems.length > 0) await db.userData.bulkPut(userDataItems);
                });
                UI.showNotification('Dados importados com sucesso! A aplicação será atualizada.');
                await initializeApp();
                await markLocalLibraryMutation();
                await syncLibrarySnapshotToRemoteIfNeeded();
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                console.error('Erro ao importar dados:', message);
                UI.showNotification(`Erro ao importar: ${message}`);
            }
        };
        reader.readAsText(file);
    };
    input.click();
}

async function rescanAllSeries() {
    UI.showNotification('A procurar por novos episódios em todas as séries...');
    DOM.settingsMenu.classList.remove('visible');
    try {
        await updateNextAired(); // Esta função já tem rate-limiting
        UI.showNotification('Verificação concluída. As listas foram atualizadas.');
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('Erro durante o rescan:', message);
        UI.showNotification(`Ocorreu um erro ao procurar por atualizações: ${message}`);
    }
}

async function refetchAllMetadata(): Promise<void> {
    if (!await UI.showConfirmationModal('Isto irá recarregar todos os metadados de todas as séries da sua biblioteca a partir da API. Pode demorar algum tempo. Deseja continuar?')) {
        return;
    }
    UI.showNotification('A recarregar todos os metadados... Por favor, aguarde.');
    DOM.settingsMenu.classList.remove('visible');
    try {
        const allSeries = [...S.myWatchlist, ...S.myArchive];
        const task = async (localSeries: Series) => {
            try {
                const freshData = await API.fetchSeriesDetails(localSeries.id, null);
                const totalEpisodes = freshData.seasons?.filter(s => s.season_number !== 0).reduce((acc, s) => acc + s.episode_count, 0) || 0;
                Object.assign(localSeries, {
                    name: freshData.name,
                    overview: freshData.overview,
                    poster_path: freshData.poster_path,
                    backdrop_path: freshData.backdrop_path,
                    first_air_date: freshData.first_air_date,
                    genres: freshData.genres,
                    episode_run_time: freshData.episode_run_time?.[0] || 30,
                    total_episodes: totalEpisodes,
                    _details: { next_episode_to_air: freshData.next_episode_to_air, status: freshData.status },
                    _lastUpdated: new Date().toISOString()
                });
            } catch (err) {
                console.error(`Falha ao recarregar metadados para a série ${localSeries.name} (ID: ${localSeries.id})`, err);
            }
        };

        await processInBatches(allSeries, 10, 1000, task);

        await db.watchlist.bulkPut(S.myWatchlist);
        await db.archive.bulkPut(S.myArchive);
        await initializeApp();
        await markLocalLibraryMutation();
        await syncLibrarySnapshotToRemoteIfNeeded();
        UI.showNotification('Todos os metadados foram atualizados com sucesso.');
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('Erro ao recarregar todos os metadados:', message);
        UI.showNotification(`Ocorreu um erro geral durante a atualização dos metadados: ${message}`);
    }
}

async function initializeApp(): Promise<void> {
    try {
        if (localStorage.getItem('seriesdb.watchlist')) {
            await S.migrateFromLocalStorage();
        }

        if (isSupabaseConfigured() && !currentAuthenticatedUserId) {
            const settingsMap = await readLocalSettingsMap();
            applySettingsMapToUi(settingsMap);
            clearInMemoryLibraryState();
            renderLibraryStateFromMemory();
            UI.showSection('media-dashboard-section');
            updateMainMenuActiveState('dashboard');
            return;
        }

        const settingsMap = await S.loadStateFromDB();
        applySettingsMapToUi(settingsMap);
        UI.renderWatchlist();
        UI.renderArchive();
        UI.renderAllSeries();
        UI.renderUnseen();
        UI.renderMediaDashboard();
        setupPwaUpdateNotifications();
        await updateNextAired().catch(err => {
            recordSectionFailure('initialize', '/initialize/update-next-aired', err, { phase: 'initialize' });
            persistObservabilitySnapshot();
            console.error("Falha ao atualizar a secção 'Next Aired':", err);
        });
        await updateGlobalProgress().catch(err => {
            recordSectionFailure('initialize', '/initialize/update-global-progress', err, { phase: 'initialize' });
            persistObservabilitySnapshot();
            console.error("Falha ao atualizar o progresso global:", err);
        });
        UI.updateKeyStats();
        await refreshNotificationsCenter();

        const rawSectionFromHash = location.hash.substring(1);
        if (rawSectionFromHash === 'archive-section') {
            await setAllSeriesStatusFilterPreference('archive');
        }
        const sectionFromHash = rawSectionFromHash === 'archive-section' ? 'all-series-section' : rawSectionFromHash;
        if (sectionFromHash && document.getElementById(sectionFromHash)) {
            UI.showSection(sectionFromHash);
            updateMainMenuActiveState(getMainMenuTargetFromSection(sectionFromHash));
            if (sectionFromHash === 'media-dashboard-section') {
                UI.renderMediaDashboard();
            } else if (sectionFromHash === 'all-series-section') {
                UI.renderAllSeries();
            } else if (sectionFromHash === 'trending-section') {
                S.resetSearchAbortController();
                loadTrending('day', 'trending-scroller-day', activeSubmenuMediaTarget);
                loadTrending('week', 'trending-scroller-week', activeSubmenuMediaTarget);
            }
        } else {
            UI.showSection('media-dashboard-section');
            updateMainMenuActiveState('dashboard');
        }
    } catch (error) {
        recordSectionFailure('initialize', '/initialize/app', error, { phase: 'initialize' });
        persistObservabilitySnapshot();
        console.error("Erro crítico durante a inicialização da aplicação:", error);
        renderInitializationErrorState(error);
    }
}

function setupPwaUpdateNotifications() {
  // Esta função é importada de um módulo virtual gerado pelo vite-plugin-pwa
  // e pode não ser encontrada pelo seu editor, mas funcionará no browser.
  const updateSW = registerSW({
    async onNeedRefresh() {
      if (await UI.showConfirmationModal('Nova versão disponível. Recarregar a aplicação?')) {
        updateSW(true);
      }
    },
    onOfflineReady() {
      UI.showNotification('A aplicação está pronta para funcionar offline.');
    },
  });
}

function renderRemoteErrorWithRetry(
    container: HTMLElement,
    retryAction: () => void,
    options: { offlineMessage: string; onlineMessage: string }
) {
    const message = navigator.onLine ? options.onlineMessage : options.offlineMessage;
    container.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.className = 'remote-error-state';

    const text = document.createElement('p');
    text.className = 'empty-list-message';
    text.textContent = message;

    const retryButton = document.createElement('button');
    retryButton.type = 'button';
    retryButton.className = 'search-bar-button secondary';
    retryButton.textContent = 'Tentar novamente';
    retryButton.addEventListener('click', retryAction);

    wrapper.appendChild(text);
    wrapper.appendChild(retryButton);
    container.appendChild(wrapper);
}

function renderComingSoonState(container: HTMLElement, title: string, description: string) {
    container.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.className = 'coming-soon-state';

    const badge = document.createElement('span');
    badge.className = 'coming-soon-badge';
    badge.textContent = 'Brevemente';

    const heading = document.createElement('p');
    heading.className = 'coming-soon-title';
    heading.textContent = title;

    const text = document.createElement('p');
    text.className = 'coming-soon-description';
    text.textContent = description;

    wrapper.appendChild(badge);
    wrapper.appendChild(heading);
    wrapper.appendChild(text);
    container.appendChild(wrapper);
}

async function loadTrending(
    timeWindow: 'day' | 'week',
    containerId: string,
    mediaType: SubmenuMediaTarget = activeSubmenuMediaTarget
) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (mediaType === 'book') {
        renderComingSoonState(
            container,
            'Tendências de Livros',
            'Estamos a preparar uma fonte robusta para esta secção.'
        );
        return;
    }

    container.innerHTML = '<p>A carregar tendências...</p>';
    try {
        const section: ObservabilitySection = timeWindow === 'day' ? 'trending-day' : 'trending-week';
        const tmdbMediaType = mediaType === 'movie' ? 'movie' : 'tv';
        const data = await runObservedSection(
            section,
            `/api/tmdb/trending/${tmdbMediaType}/${timeWindow}`,
            () => API.fetchTrending(timeWindow, S.searchAbortController.signal, mediaType),
            { containerId, timeWindow, mediaType }
        );
        UI.renderTrending(data.results, container);
    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            console.log(`Trending fetch aborted for ${timeWindow}`);
        } else {
            recordSectionFailure(
                timeWindow === 'day' ? 'trending-day' : 'trending-week',
                `/trending/${timeWindow}/render`,
                error,
                { containerId }
            );
            persistObservabilitySnapshot();
            console.error(`Erro ao carregar tendências (${timeWindow}):`, error);
            renderRemoteErrorWithRetry(
                container,
                () => {
                    S.resetSearchAbortController();
                    loadTrending(timeWindow, containerId, mediaType);
                },
                {
                    offlineMessage: 'Sem ligação à internet. As tendências não podem ser carregadas offline.',
                    onlineMessage: `Não foi possível carregar as tendências (${timeWindow === 'day' ? 'hoje' : 'semana'}).`,
                }
            );
        }
    }
}

let allPopularSeries: Series[] = [];
let popularSeriesDisplayedCount = 0;
let popularSeriesCacheMediaType: SubmenuMediaTarget | null = null;
const POPULAR_SERIES_DISPLAY_BATCH_SIZE = 50;
const POPULAR_SERIES_TARGET_TOTAL = 250;
const POPULAR_FETCH_CONCURRENCY = 4;
let isPopularBootstrapping = false;
let isPopularBackgroundLoading = false;
let popularLoadToken = 0;
const TMDB_ANIMATION_GENRE_ID = 16;
let excludeAsianAnimationFromTopRated = true;

function sortPopularSeriesByRanking(seriesList: Series[]): Series[] {
    return [...seriesList].sort((a, b) => {
        const ratingDiff = (b.vote_average || 0) - (a.vote_average || 0);
        if (ratingDiff !== 0) return ratingDiff;
        return (a.name || '').localeCompare(b.name || '', 'pt-PT');
    });
}

function dedupePopularSeries(seriesList: Series[]): Series[] {
    const seenIds = new Set<number>();
    return seriesList.filter(series => {
        if (!series || typeof series.id !== 'number') return false;
        if (seenIds.has(series.id)) return false;
        seenIds.add(series.id);
        return true;
    });
}

function isAnimationSeries(series: Series): boolean {
    const maybeGenreIds = (series as unknown as { genre_ids?: number[] }).genre_ids;
    const genreIds = Array.isArray(maybeGenreIds) ? maybeGenreIds.map(Number) : [];
    if (genreIds.includes(TMDB_ANIMATION_GENRE_ID)) return true;
    if (!Array.isArray(series.genres)) return false;
    return series.genres.some((genre) => {
        const genreId = Number((genre as { id?: number }).id);
        const genreName = String((genre as { name?: string }).name || '').toLowerCase();
        return genreId === TMDB_ANIMATION_GENRE_ID || genreName === 'animation' || genreName === 'animação';
    });
}

function applyTopRatedFilters(seriesList: Series[]): Series[] {
    if (!excludeAsianAnimationFromTopRated) return seriesList;
    return seriesList.filter(series => !isAnimationSeries(series));
}

function updateTopRatedFilterToggleButton() {
    if (!DOM.toggleAsianAnimationFilterBtn) return;
    const showAnimationInTopRated = !excludeAsianAnimationFromTopRated;
    DOM.toggleAsianAnimationFilterBtn.classList.toggle('is-on', showAnimationInTopRated);
    DOM.toggleAsianAnimationFilterBtn.setAttribute('aria-pressed', String(showAnimationInTopRated));
    DOM.toggleAsianAnimationFilterBtn.setAttribute(
        'aria-label',
        showAnimationInTopRated
            ? 'Ocultar séries de animação no Top Rated'
            : 'Mostrar séries de animação no Top Rated'
    );
    if (DOM.topRatedAnimationFilterState) {
        DOM.topRatedAnimationFilterState.textContent = showAnimationInTopRated ? 'ON' : 'OFF';
    }
}

function updateTopRatedFilterControlVisibility(mediaType: SubmenuMediaTarget): void {
    const topRatedFilterControl = document.querySelector<HTMLElement>('.top-rated-filter-control');
    if (!topRatedFilterControl) return;
    topRatedFilterControl.style.display = mediaType === 'series' ? 'inline-flex' : 'none';
}

function updatePopularLoadMoreVisibility() {
    const canShowMoreNow = popularSeriesDisplayedCount < allPopularSeries.length;
    const hasMoreLoading = isPopularBootstrapping || isPopularBackgroundLoading;

    if (canShowMoreNow || hasMoreLoading) {
        DOM.popularLoadMoreContainer.style.display = 'block';
        if (DOM.popularLoadMoreBtn) {
            DOM.popularLoadMoreBtn.disabled = !canShowMoreNow;
            DOM.popularLoadMoreBtn.textContent = canShowMoreNow ? 'Ver Mais' : 'A carregar...';
        }
        return;
    }

    DOM.popularLoadMoreContainer.style.display = 'none';
    if (DOM.popularLoadMoreBtn) {
        DOM.popularLoadMoreBtn.disabled = false;
        DOM.popularLoadMoreBtn.textContent = 'Ver Mais';
    }
}

function renderVisiblePopularSeries() {
    const visibleCount = Math.min(popularSeriesDisplayedCount, allPopularSeries.length);
    DOM.popularContainer.innerHTML = '';
    UI.renderPopularSeries(allPopularSeries.slice(0, visibleCount));
}

function renderTopRatedFromCache(mediaType: SubmenuMediaTarget = activeSubmenuMediaTarget): boolean {
    updateTopRatedFilterControlVisibility(mediaType);
    if (popularSeriesCacheMediaType !== mediaType) return false;
    if (allPopularSeries.length === 0) return false;
    popularSeriesDisplayedCount = Math.max(
        POPULAR_SERIES_DISPLAY_BATCH_SIZE,
        Math.min(popularSeriesDisplayedCount, allPopularSeries.length)
    );
    renderVisiblePopularSeries();
    updatePopularLoadMoreVisibility();
    return true;
}

function mergePopularSeries(results: Series[]) {
    if (results.length === 0) return;
    allPopularSeries = sortPopularSeriesByRanking(
        dedupePopularSeries([...allPopularSeries, ...results])
    ).slice(0, POPULAR_SERIES_TARGET_TOTAL);
}

async function fetchPopularPagesChunk(
    pages: number[],
    fetchAndProcessChunk: (page: number) => Promise<{ results: Series[]; totalPages: number }>
) {
    if (pages.length === 0) return;

    const settled = await processInBatches(
        pages,
        POPULAR_FETCH_CONCURRENCY,
        0,
        async (page: number) => ({ page, chunk: await fetchAndProcessChunk(page) })
    );

    const mergedResults: Series[] = [];
    for (const result of settled) {
        if (result.status === 'rejected') throw result.reason;
        mergedResults.push(...result.value.chunk.results);
    }
    mergePopularSeries(mergedResults);
}

async function loadPopularSeries(loadMore = false, mediaType: SubmenuMediaTarget = activeSubmenuMediaTarget) {
    updateTopRatedFilterControlVisibility(mediaType);

    if (mediaType === 'book') {
        popularSeriesCacheMediaType = 'book';
        allPopularSeries = [];
        popularSeriesDisplayedCount = 0;
        renderComingSoonState(
            DOM.popularContainer,
            'Top Rated de Livros',
            'Esta secção ficará disponível assim que a integração estiver concluída.'
        );
        DOM.popularLoadMoreContainer.style.display = 'none';
        return;
    }

    if (popularSeriesCacheMediaType !== mediaType && loadMore) {
        loadMore = false;
    }

    if (loadMore) {
        if (allPopularSeries.length === 0) {
            updatePopularLoadMoreVisibility();
            return;
        }
        const currentVisibleCount = Math.min(popularSeriesDisplayedCount, allPopularSeries.length);
        popularSeriesDisplayedCount += POPULAR_SERIES_DISPLAY_BATCH_SIZE;
        popularSeriesDisplayedCount = Math.min(popularSeriesDisplayedCount, POPULAR_SERIES_TARGET_TOTAL);
        const nextVisibleCount = Math.min(popularSeriesDisplayedCount, allPopularSeries.length);

        if (nextVisibleCount > currentVisibleCount) {
            const seriesToAppend = allPopularSeries.slice(currentVisibleCount, nextVisibleCount);
            if (currentVisibleCount === 0 || DOM.popularContainer.children.length === 0) {
                renderVisiblePopularSeries();
            } else {
                UI.renderPopularSeries(seriesToAppend, currentVisibleCount + 1);
            }
        }
        updatePopularLoadMoreVisibility();
        return;
    }

    if (isPopularBootstrapping) return;

    const currentLoadToken = ++popularLoadToken;
    isPopularBootstrapping = true;
    isPopularBackgroundLoading = false;
    popularSeriesCacheMediaType = mediaType;
    allPopularSeries = [];
    popularSeriesDisplayedCount = POPULAR_SERIES_DISPLAY_BATCH_SIZE;
    DOM.popularContainer.innerHTML = mediaType === 'movie'
        ? '<p>A carregar filmes top rated...</p>'
        : '<p>A carregar séries top rated...</p>';
    updatePopularLoadMoreVisibility();

    const fetchAndProcessChunk = async (page: number): Promise<{ results: Series[]; totalPages: number }> => {
        const tmdbMediaType = mediaType === 'movie' ? 'movie' : 'tv';
        const tmdbData = await runObservedSection(
            'popular',
            `/api/tmdb/${tmdbMediaType}/top_rated`,
            () => API.fetchPopularSeries(page, mediaType),
            { page, source: `${tmdbMediaType}-top-rated`, mediaType }
        );
        return {
            results: mediaType === 'series' ? applyTopRatedFilters(tmdbData.results) : tmdbData.results,
            totalPages: tmdbData.total_pages || 0,
        };
    };

    const processRemainingChunks = async (startPage: number, totalPages: number, token: number) => {
        const maxPages = Math.max(1, totalPages);
        let page = startPage;
        while (page <= maxPages && allPopularSeries.length < POPULAR_SERIES_TARGET_TOTAL) {
            if (token !== popularLoadToken) return;
            const pagesToFetch: number[] = [];
            for (let i = 0; i < POPULAR_FETCH_CONCURRENCY && page <= maxPages; i++, page++) {
                pagesToFetch.push(page);
            }
            await fetchPopularPagesChunk(pagesToFetch, fetchAndProcessChunk);
            if (token !== popularLoadToken) return;
            renderVisiblePopularSeries();
            updatePopularLoadMoreVisibility();
        }
    };

    try {
        // Carrega o primeiro chunk e continua até garantir, no mínimo, 50 itens filtrados no primeiro render.
        const firstChunk = await fetchAndProcessChunk(1);
        if (currentLoadToken !== popularLoadToken) return;

        mergePopularSeries(firstChunk.results);
        let nextPage = 2;
        const maxPages = Math.max(1, firstChunk.totalPages);
        const initialTarget = Math.min(POPULAR_SERIES_DISPLAY_BATCH_SIZE, POPULAR_SERIES_TARGET_TOTAL);

        while (allPopularSeries.length < initialTarget && nextPage <= maxPages) {
            const pagesToFetch: number[] = [];
            for (let i = 0; i < POPULAR_FETCH_CONCURRENCY && nextPage <= maxPages; i++, nextPage++) {
                pagesToFetch.push(nextPage);
            }
            await fetchPopularPagesChunk(pagesToFetch, fetchAndProcessChunk);
            if (currentLoadToken !== popularLoadToken) return;
        }

        popularSeriesDisplayedCount = Math.min(popularSeriesDisplayedCount, allPopularSeries.length);
        renderVisiblePopularSeries();
        updatePopularLoadMoreVisibility();

        // Carrega o resto em segundo plano para chegar ao alvo total sem bloquear o "Ver Mais".
        if (nextPage <= maxPages && allPopularSeries.length < POPULAR_SERIES_TARGET_TOTAL) {
            isPopularBackgroundLoading = true;
            updatePopularLoadMoreVisibility();
            processRemainingChunks(nextPage, maxPages, currentLoadToken)
                .catch((error) => {
                    if (currentLoadToken !== popularLoadToken) return;
                    console.warn('Falha no carregamento em segundo plano do Top Rated:', error);
                })
                .finally(() => {
                    if (currentLoadToken !== popularLoadToken) return;
                    isPopularBackgroundLoading = false;
                    updatePopularLoadMoreVisibility();
                });
        }
    } catch (error) {
        if (currentLoadToken !== popularLoadToken) return;
        recordSectionFailure('popular', '/popular/render', error);
        persistObservabilitySnapshot();
        console.error('Erro ao carregar séries top rated:', error);
        renderRemoteErrorWithRetry(
            DOM.popularContainer,
            () => loadPopularSeries(false, mediaType),
            {
                offlineMessage: 'Sem ligação à internet. A secção Top Rated não está disponível offline.',
                onlineMessage: mediaType === 'movie'
                    ? 'Não foi possível carregar os filmes top rated.'
                    : 'Não foi possível carregar as séries top rated.',
            }
        );
    } finally {
        if (currentLoadToken === popularLoadToken) {
            isPopularBootstrapping = false;
            updatePopularLoadMoreVisibility();
        }
    }
}

let premieresSeriesPage = 1;
let isLoadingPremieres = false;
const loadedPremieresSeriesIds = new Set<number>();
async function loadPremieresSeries(loadMore = false, mediaType: SubmenuMediaTarget = activeSubmenuMediaTarget) {
    if (mediaType === 'book') {
        renderComingSoonState(
            DOM.premieresContainer,
            'Estreias de Livros',
            'Estamos a finalizar os dados de lançamento para livros.'
        );
        DOM.premieresLoadMoreContainer.style.display = 'none';
        return;
    }

    if (isLoadingPremieres) return;
    isLoadingPremieres = true;
    if (DOM.premieresLoadMoreBtn) {
        DOM.premieresLoadMoreBtn.disabled = true;
        DOM.premieresLoadMoreBtn.textContent = 'A carregar...';
    }

    if (!loadMore) {
        premieresSeriesPage = 1;
        loadedPremieresSeriesIds.clear();
        DOM.premieresContainer.innerHTML = mediaType === 'movie'
            ? '<p>A carregar estreias de filmes...</p>'
            : '<p>A carregar estreias...</p>';
        DOM.premieresLoadMoreContainer.style.display = 'none';
    }

    // Calcula o rank inicial para o novo lote de séries
    const startingRank = loadMore ? DOM.premieresContainer.childElementCount + 1 : 1;

    try {        
        const tmdbMediaType = mediaType === 'movie' ? 'movie' : 'tv';
        const data = await runObservedSection(
            'premieres',
            `/api/tmdb/discover/${tmdbMediaType}`,
            () => API.fetchNewPremieres(premieresSeriesPage, S.searchAbortController.signal, mediaType),
            { page: premieresSeriesPage, loadMore, mediaType }
        );
        
        if (!loadMore) {
            DOM.premieresContainer.innerHTML = '';
        }

        // Filtra as séries para excluir as que já estão na biblioteca do utilizador
        const seriesNotInLibrary = data.results.filter(
            (series) => !S.myWatchlist.some(s => s.id === series.id) && !S.myArchive.some(s => s.id === series.id)
        );
        const uniqueSeries = seriesNotInLibrary.filter(series => !loadedPremieresSeriesIds.has(series.id));

        // Na primeira carga, mostra apenas 18. Nas seguintes, mostra a página toda.
        const seriesToRender = loadMore ? uniqueSeries : uniqueSeries.slice(0, 18);
        seriesToRender.forEach(series => loadedPremieresSeriesIds.add(series.id));

        UI.renderPremieresSeries(seriesToRender, startingRank);

        if (data.page < data.total_pages) {
            DOM.premieresLoadMoreContainer.style.display = 'block';
            premieresSeriesPage = data.page + 1;
        } else {
            DOM.premieresLoadMoreContainer.style.display = 'none';
        }
    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            console.log('Premieres fetch aborted');
            return;
        }
        recordSectionFailure('premieres', '/premieres/render', error, { loadMore, mediaType });
        persistObservabilitySnapshot();
        console.error('Erro ao carregar as estreias:', error);
        renderRemoteErrorWithRetry(
            DOM.premieresContainer,
            () => loadPremieresSeries(loadMore, mediaType),
            {
                offlineMessage: 'Sem ligação à internet. A secção Estreias não está disponível offline.',
                onlineMessage: mediaType === 'movie'
                    ? 'Não foi possível carregar as estreias de filmes.'
                    : 'Não foi possível carregar as estreias.',
            }
        );
    } finally {
        isLoadingPremieres = false;
        if (DOM.premieresLoadMoreBtn) {
            DOM.premieresLoadMoreBtn.disabled = false;
            DOM.premieresLoadMoreBtn.textContent = 'Ver Mais';
        }
    }
}
// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    UI.initModalAccessibility();
    document.addEventListener(S.STATE_MUTATION_EVENT_NAME, () => {
        scheduleLibrarySnapshotSyncFromLocalMutation();
        UI.renderMediaDashboard();
        void refreshNotificationsCenter();
    });
    setupMobileTopbarControls();

    // Navigation
    DOM.mainMenuLinks.forEach(link => {
        link.addEventListener('click', async (e) => {
            e.preventDefault();
            const target = parseMainMenuTarget((link as HTMLElement).dataset.mainTarget);
            await navigateMainMenu(target);
        });
    });

    DOM.mainNavLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = (link as HTMLElement).dataset.target;
            if (targetId) {
                if (targetId === 'watchlist-section') {
                    UI.renderWatchlist();
                } else if (targetId === 'unseen-section') {
                    UI.renderUnseen();
                } else if (targetId === 'next-aired-section') {
                    if (activeSubmenuMediaTarget !== 'series') {
                        UI.showNotification('Próximo Episódio disponível apenas para séries.');
                        return;
                    }
                    void updateNextAired();
                } else if (targetId === 'media-dashboard-section') {
                    UI.renderMediaDashboard();
                } else if (targetId === 'all-series-section') {
                    UI.renderAllSeries();
                } else if (targetId === 'trending-section') {
                    S.resetSearchAbortController();
                    loadTrending('day', 'trending-scroller-day', activeSubmenuMediaTarget);
                    loadTrending('week', 'trending-scroller-week', activeSubmenuMediaTarget);
                } else if (targetId === 'popular-section') {
                    if (!renderTopRatedFromCache(activeSubmenuMediaTarget)) {
                        S.resetSearchAbortController();
                        loadPopularSeries(false, activeSubmenuMediaTarget);
                    }
                } else if (targetId === 'premieres-section') {
                    S.resetSearchAbortController();
                    loadPremieresSeries(false, activeSubmenuMediaTarget);
                }
                UI.showSection(targetId);
                updateMainMenuActiveState(getMainMenuTargetFromSection(targetId));
            }
        });
    });

    // View Toggles
    setupViewToggle(DOM.watchlistViewToggle, DOM.watchlistContainer, C.WATCHLIST_VIEW_MODE_KEY, UI.renderWatchlist);
    setupViewToggle(DOM.unseenViewToggle, DOM.unseenContainer, C.UNSEEN_VIEW_MODE_KEY, UI.renderUnseen);
    setupViewToggle(DOM.archiveViewToggle, DOM.archiveContainer, C.ARCHIVE_VIEW_MODE_KEY, UI.renderArchive);
    setupViewToggle(DOM.allSeriesViewToggle, DOM.allSeriesContainer, C.ALL_SERIES_VIEW_MODE_KEY, UI.renderAllSeries);
    setupViewToggle(DOM.popularViewToggle, DOM.popularContainer, 'popular_view_mode', () => {
        if (!renderTopRatedFromCache(activeSubmenuMediaTarget)) {
            S.resetSearchAbortController();
            loadPopularSeries(false, activeSubmenuMediaTarget);
        }
    });
    setupViewToggle(DOM.premieresViewToggle, DOM.premieresContainer, 'premieres_view_mode', () => loadPremieresSeries(false, activeSubmenuMediaTarget));

    DOM.allSeriesGenreFilter?.addEventListener('change', (event) => {
        const { value } = event.target as HTMLSelectElement;
        S.setAllSeriesGenreFilter(value);
        UI.renderAllSeries();
    });

    DOM.allSeriesMediaFilter?.addEventListener('change', async (event) => {
        const { value } = event.target as HTMLSelectElement;
        const normalizedMediaType = normalizeAllSeriesMediaFilter(value, 'all');
        await setAllSeriesMediaFilterPreference(normalizedMediaType);
        S.setAllSeriesGenreFilter('all');
        if (DOM.allSeriesGenreFilter) {
            DOM.allSeriesGenreFilter.value = 'all';
        }
        UI.renderAllSeries();
    });

    DOM.allSeriesStatusFilter?.addEventListener('change', async (event) => {
        const { value } = event.target as HTMLSelectElement;
        const normalizedStatus = normalizeAllSeriesStatusFilter(value, 'all');
        await setAllSeriesStatusFilterPreference(normalizedStatus);
        UI.renderAllSeries();
    });

    DOM.backToDashboardFromLibraryBtn?.addEventListener('click', () => {
        UI.renderMediaDashboard();
        UI.showSection('media-dashboard-section');
        updateMainMenuActiveState('dashboard');
    });

    DOM.mediaDashboardSection?.addEventListener('click', async (event) => {
        const target = event.target as HTMLElement;
        const card = target.closest<HTMLButtonElement>('.dashboard-media-card');
        if (!card) return;
        const cardMediaType = normalizeAllSeriesMediaFilter(card.dataset.mediaType, 'all');
        if (cardMediaType === 'all') return;
        await setAllSeriesMediaFilterPreference(cardMediaType);
        await setAllSeriesStatusFilterPreference('all');
        S.setAllSeriesGenreFilter('all');
        if (DOM.allSeriesGenreFilter) {
            DOM.allSeriesGenreFilter.value = 'all';
        }
        UI.renderAllSeries();
        UI.showSection('all-series-section');
        if (cardMediaType === 'series' || cardMediaType === 'movie' || cardMediaType === 'book') {
            updateMainMenuActiveState(cardMediaType);
        } else {
            updateMainMenuActiveState('library');
        }
    });

    // Header Search
    const setSearchMediaType = (mediaType: MediaType) => {
        selectedSearchMediaType = mediaType;
        DOM.addSeriesHeaderInput.placeholder = getSearchPlaceholder(mediaType);
    };

    setSearchMediaType(parseMediaType(DOM.searchMediaTypeSelect?.value));

    const performSearch = () => {
        const query = DOM.addSeriesHeaderInput.value.trim();
        const mediaType = selectedSearchMediaType;
        const endpoint = mediaType === 'series'
            ? '/api/tmdb/search/tv'
            : mediaType === 'movie'
                ? '/api/tmdb/search/movie'
                : '/api/books/search';
        const mediaLabel = getMediaTypeLabel(mediaType).toLowerCase();
        if (query.length > 1) {
            S.resetSearchAbortController();
            DOM.searchResultsContainer.innerHTML = '<p>A pesquisar...</p>';
            UI.showSection('add-series-section');
            const menuTarget: MainMenuTarget = mediaType === 'movie' ? 'movie' : mediaType === 'book' ? 'book' : 'series';
            updateMainMenuActiveState(menuTarget);
            runObservedSection(
                'search',
                endpoint,
                () => API.searchByMediaType(mediaType, query, S.searchAbortController.signal),
                { queryLength: query.length, mediaType }
            )
                .then(data => {
                    S.setCurrentSearchResults(data.results);
                    UI.renderSearchResults(data.results);
                })
                .catch(error => {
                    if (error.name === 'AbortError') {
                        console.log('Search aborted');
                    } else {
                        console.error(`Erro ao pesquisar ${mediaLabel}:`, error);
                        renderRemoteErrorWithRetry(
                            DOM.searchResultsContainer,
                            () => performSearch(),
                            {
                                offlineMessage: 'Sem ligação à internet. A pesquisa remota não está disponível offline.',
                                onlineMessage: 'Não foi possível realizar a pesquisa.',
                            }
                        );
                    }
                });
        } else if (query.length === 0) {
            DOM.searchResultsContainer.innerHTML = `<p>${getSearchEmptyMessage(mediaType)}</p>`;
        }
    };

    const debouncedSearch = debounce(performSearch, 300);

    DOM.searchMediaTypeSelect?.addEventListener('change', () => {
        setSearchMediaType(parseMediaType(DOM.searchMediaTypeSelect.value));
        if (DOM.addSeriesHeaderInput.value.trim().length > 1) {
            debouncedSearch.cancel();
            performSearch();
        }
    });

    DOM.addSeriesHeaderInput.addEventListener('input', () => {
        S.resetSearchAbortController();
        debouncedSearch();
    });

    DOM.addSeriesHeaderButton.addEventListener('click', performSearch);

    DOM.addSeriesHeaderInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            debouncedSearch.cancel(); // Cancela qualquer pesquisa debounced pendente
            performSearch();
        }
    });

    // Acessibilidade: Navegação por teclado para elementos interativos
    DOM.dashboard.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
            const target = e.target as HTMLElement;
            // Ativa elementos interativos que não são botões/links nativos mas têm o comportamento esperado
            const interactiveElement = target.closest<HTMLElement>('.status-icon, .star-container, .action-icon, .series-item, .add-btn, .remove-btn, .trailer-btn, .mark-season-seen-btn, .cast-show-more-btn, .dashboard-recent-item, .dashboard-upcoming-item');
            if (interactiveElement) {
                e.preventDefault(); // Previne o scroll da página ao usar a barra de espaço
                interactiveElement.click(); // Dispara o evento de clique existente, reutilizando a lógica
            }
        }
    });

    // Dashboard clicks
    DOM.dashboard.addEventListener('click', async (e) => {
        const target = e.target as Element;

        const removeBtn = target.closest('.remove-btn');
        if (removeBtn) {
            e.stopPropagation(); // Impede que o clique "borbulhe" para o watchlist-item
            const parentItem = removeBtn.closest('.watchlist-item') as HTMLElement | null;
            const mediaType = parseMediaType(parentItem?.dataset.mediaType);
            removeSeriesFromLibrary(
                parseInt((removeBtn as HTMLElement).dataset.seriesId!, 10),
                mediaType,
                parentItem
            );
            return;
        }

        const addSeriesQuickBtn = target.closest('.add-series-quick-btn');
        if (addSeriesQuickBtn) {
            const seriesId = parseInt((addSeriesQuickBtn as HTMLElement).dataset.seriesId!, 10);
            const mediaType = parseMediaType((addSeriesQuickBtn as HTMLElement).dataset.mediaType);
            const seriesToAdd = S.currentSearchResults.find((s: Series) => s.id === seriesId && s.media_type === mediaType);
            if (seriesToAdd) {
                await handleQuickAdd(seriesToAdd, addSeriesQuickBtn as HTMLButtonElement);
            }
            return;
        }

        const markAllSeenQuickBtn = target.closest('.mark-all-seen-quick-btn');
        if (markAllSeenQuickBtn) {
            const seriesId = parseInt((markAllSeenQuickBtn as HTMLElement).dataset.seriesId!, 10);
            const mediaType = parseMediaType((markAllSeenQuickBtn as HTMLElement).dataset.mediaType);
            const seriesToAdd = S.currentSearchResults.find((s: Series) => s.id === seriesId && s.media_type === mediaType);
            if (seriesToAdd) {
                await handleQuickAddAndMarkAllSeen(seriesToAdd, markAllSeenQuickBtn as HTMLButtonElement);
            }
            return;
        }

        const seriesItem = target.closest('.watchlist-item, .top-rated-item, .trending-card, .search-result-item, .dashboard-recent-item, .dashboard-upcoming-item');
        if (seriesItem) {
            const typedSeriesItem = seriesItem as HTMLElement;
            const mediaType = parseMediaType(typedSeriesItem.dataset.mediaType);
            document.dispatchEvent(new CustomEvent('display-media-details', {
                detail: {
                    mediaType,
                    mediaId: parseInt(typedSeriesItem.dataset.seriesId!, 10)
                }
            }));
            return;
        }

        const backToPreviousSectionBtn = target.closest('#back-to-previous-section-btn');
        if (backToPreviousSectionBtn) {
            navigateBackFromSeriesDetails();
            return;
        }

        const mediaAddBtn = target.closest('#media-add-watchlist-btn');
        if (mediaAddBtn) {
            const mediaType = parseMediaType(DOM.seriesViewSection.dataset.mediaType);
            const mediaId = parseInt(DOM.seriesViewSection.dataset.mediaId || '', 10);
            const media = findMedia(mediaType, mediaId);
            if (!media) {
                UI.showNotification('Não foi possível localizar o conteúdo para adicionar.');
                return;
            }
            await addMediaToWatchlist(media);
            UI.showNotification(`"${media.name}" foi adicionado à biblioteca.`);
            await refreshLibraryViewsAfterMediaChange(mediaType);
            await displayMediaDetails(mediaType, mediaId);
            return;
        }

        const mediaRemoveBtn = target.closest('#media-remove-from-library-btn');
        if (mediaRemoveBtn) {
            const mediaType = parseMediaType(DOM.seriesViewSection.dataset.mediaType);
            const mediaId = parseInt(DOM.seriesViewSection.dataset.mediaId || '', 10);
            const removedMediaSnapshot = findMedia(mediaType, mediaId);
            await removeSeriesFromLibrary(mediaId, mediaType, null);
            if (removedMediaSnapshot) {
                UI.renderMediaDetails(removedMediaSnapshot, {
                    progressPercent: 0,
                    isInLibrary: false,
                    isArchived: false
                });
            } else {
                navigateBackFromSeriesDetails();
            }
            return;
        }

        const mediaArchiveToggleBtn = target.closest('#media-archive-toggle-btn');
        if (mediaArchiveToggleBtn) {
            const mediaType = parseMediaType(DOM.seriesViewSection.dataset.mediaType);
            const mediaId = parseInt(DOM.seriesViewSection.dataset.mediaId || '', 10);
            const media = S.getMediaItem(mediaType, mediaId);
            if (!media) {
                UI.showNotification('Não foi possível localizar o conteúdo na biblioteca.');
                return;
            }
            const isArchived = S.myArchive.some(item => item.media_type === mediaType && item.id === mediaId);
            if (isArchived) {
                await S.unarchiveSeries(media);
                UI.showNotification('Movido para Quero Ver.');
            } else {
                await S.archiveSeries(media);
                UI.showNotification('Movido para Arquivo.');
            }
            await refreshLibraryViewsAfterMediaChange(mediaType);
            await displayMediaDetails(mediaType, mediaId);
            return;
        }

        const movieToggleSeenBtn = target.closest('#movie-toggle-seen-btn');
        if (movieToggleSeenBtn) {
            const mediaId = parseInt(DOM.seriesViewSection.dataset.mediaId || '', 10);
            const currentProgress = getMediaProgressPercent('movie', mediaId);
            const nextProgress = currentProgress >= 100 ? 0 : 100;
            await S.updateMediaProgress('movie', mediaId, nextProgress);
            const moveResult = await syncMediaLibrarySectionWithProgress('movie', mediaId, nextProgress);
            if (moveResult === 'archived') {
                UI.showNotification('Filme marcado como visto e movido para Arquivo.');
            } else if (moveResult === 'watchlist') {
                UI.showNotification('Filme marcado como não visto e movido para Quero Ver.');
            } else {
                UI.showNotification(nextProgress >= 100 ? 'Filme marcado como visto.' : 'Filme marcado como não visto.');
            }
            await refreshLibraryViewsAfterMediaChange('movie');
            await displayMediaDetails('movie', mediaId);
            return;
        }

        const bookSaveProgressBtn = target.closest('#book-progress-save-btn');
        if (bookSaveProgressBtn) {
            const mediaId = parseInt(DOM.seriesViewSection.dataset.mediaId || '', 10);
            const progressInput = DOM.seriesViewSection.querySelector<HTMLInputElement>('#book-progress-range');
            const progressValue = progressInput ? parseInt(progressInput.value, 10) : 0;
            await S.updateMediaProgress('book', mediaId, progressValue);
            const moveResult = await syncMediaLibrarySectionWithProgress('book', mediaId, progressValue);
            if (moveResult === 'archived') {
                UI.showNotification('Livro concluído e movido para Arquivo.');
            } else if (moveResult === 'watchlist') {
                UI.showNotification('Livro movido para Quero Ver.');
            } else {
                UI.showNotification('Progresso de leitura atualizado.');
            }
            await refreshLibraryViewsAfterMediaChange('book');
            await displayMediaDetails('book', mediaId);
            return;
        }

        const statusIcon = target.closest('.status-icon');
        if (statusIcon) {
            const episodeItem = statusIcon.closest('.episode-item');
            if (episodeItem) {
                const { seriesId, episodeId, seasonNumber } = (episodeItem as HTMLElement).dataset;
                toggleEpisodeWatched(parseInt(seriesId!), parseInt(episodeId!), parseInt(seasonNumber!), episodeItem as HTMLElement);
            }
            return;
        }

        const showMoreCastBtn = target.closest('.cast-show-more-btn');
        if (showMoreCastBtn) {
            const remainingCastData = (showMoreCastBtn as HTMLElement).dataset.remainingCast;
            if (remainingCastData) {
                const remainingPeople: TMDbPerson[] = JSON.parse(remainingCastData);
                const peopleList = showMoreCastBtn.closest('.v2-info-card')!.querySelector('.v2-people-list')!;
                const fragment = document.createDocumentFragment();
                remainingPeople.forEach((person: any) => {
                    const personElement = UI.createPersonElement(person); // This function needs to be created or moved to UI
                    fragment.appendChild(personElement);
                });
                peopleList.appendChild(fragment);
                showMoreCastBtn.parentElement!.remove();
            }
            return;
        }

        const viewAllRatingsBtn = target.closest('.view-all-btn');
        if (viewAllRatingsBtn) {
            UI.openAllRatingsModal();
            return;
        }

        const star = target.closest('.star-container');
        if (star) {
            const ratingContainer = star.closest('.star-rating');
            if (!ratingContainer) return;
            const containerDataset = (ratingContainer as HTMLElement).dataset;
            const mediaType = parseMediaType(containerDataset.mediaType);
            const mediaId = parseInt(containerDataset.mediaId || containerDataset.seriesId || '', 10);
            if (Number.isNaN(mediaId)) return;
            const stateKey = mediaType === 'series' ? String(mediaId) : createMediaKey(mediaType, mediaId);
            const value = parseInt((star as HTMLElement).dataset.value!, 10);
            const currentRating = S.userData[stateKey]?.rating || 0;
            const newRating = (value === currentRating) ? 0 : value; // Toggle off
            await S.updateMediaRating(mediaType, mediaId, newRating);
            UI.renderStars(ratingContainer as HTMLElement, newRating);
            return;
        }

        const infoIcon = target.closest('.action-icon.fa-info-circle');
        if (infoIcon) {
            const episodeItem = infoIcon.closest('.episode-item');
            if (episodeItem) {
                const { title, overview, stillPathLarge } = (episodeItem as HTMLElement).dataset;
                UI.openEpisodeModal(title!, overview!, stillPathLarge!);
            }
            return;
        }

        const refreshBtn = target.closest('#refresh-metadata-btn');
        if (refreshBtn) {
            const seriesId = (DOM.seriesViewSection as HTMLElement).dataset.seriesId;
            if (seriesId) {
                UI.showNotification('A atualizar metadados...');
                await displaySeriesDetails(parseInt(seriesId, 10));
            }
            return;
        }

        const refreshMediaBtn = target.closest('#media-refresh-details-btn');
        if (refreshMediaBtn) {
            const mediaType = parseMediaType(DOM.seriesViewSection.dataset.mediaType);
            const mediaId = parseInt(DOM.seriesViewSection.dataset.mediaId || '', 10);
            if (!Number.isNaN(mediaId)) {
                UI.showNotification('A atualizar detalhes...');
                await displayMediaDetails(mediaType, mediaId);
            }
            return;
        }

        const markAllBtn = target.closest('#mark-all-seen-btn');
        if (markAllBtn) {
            const seriesId = parseInt((DOM.seriesViewSection as HTMLElement).dataset.seriesId!, 10);
            if (seriesId) {
                UI.showNotification('A marcar todos os episódios como vistos...');

                const { allEpisodes, seasons } = S.getDetailViewData();
                const allEpisodeIds = allEpisodes.map(ep => ep.id);

                if (allEpisodeIds.length > 0) {
                    await S.markEpisodesAsWatched(seriesId, allEpisodeIds);

                    document.querySelectorAll('.episode-item').forEach(el => UI.markEpisodeAsSeen(el as HTMLElement));
                    
                    seasons.forEach(season => UI.updateSeasonProgressUI(seriesId, season.season_number));
                    
                    UI.updateOverallProgressBar(seriesId);

                    const movedToArchive = await checkSeriesCompletion(seriesId);
                    updateGlobalProgress();
                    UI.updateKeyStats();

                    if (movedToArchive) {
                        await setAllSeriesStatusFilterPreference('archive');
                        UI.updateActiveNavLink('all-series-section');
                    }
                    UI.showNotification('Todos os episódios foram marcados como vistos.');
                } else {
                    UI.showNotification('Não foram encontrados episódios para marcar.');
                }
            }
            return;
        }

        const markSeasonBtn = target.closest('.mark-season-seen-btn');
        if (markSeasonBtn) {
            e.preventDefault();
            e.stopPropagation();
            const seasonDetailsElement = markSeasonBtn.closest('.season-details');
            if (seasonDetailsElement) {
                const seriesId = parseInt((seasonDetailsElement as HTMLElement).dataset.seriesId!, 10);
                const seasonNumber = parseInt((seasonDetailsElement as HTMLElement).dataset.seasonNumber!, 10);
                
                const allEpisodes = S.getDetailViewData().allEpisodes;
                const seasonEpisodeIds = allEpisodes
                    .filter(ep => ep.season_number === seasonNumber)
                    .map(ep => ep.id);

                if (seasonEpisodeIds.length === 0) return;

                const isFullyWatched = markSeasonBtn.classList.contains('fully-watched');
                const wasInArchive = S.myArchive.some(s => s.id === seriesId);

                if (isFullyWatched) { // A desmarcar
                    await S.unmarkEpisodesAsWatched(seriesId, seasonEpisodeIds);
                    seasonDetailsElement.querySelectorAll('.episode-item').forEach(el => UI.markEpisodeAsUnseen(el as HTMLElement));

                    if (wasInArchive) {
                        const series = S.getSeries(seriesId);
                        if(series) await S.unarchiveSeries(series);
                    }

                    UI.renderWatchlist();
                    UI.renderUnseen();
                    UI.renderArchive();

                    if ((S.watchedState[seriesId]?.length || 0) === 0) {
                        UI.updateActiveNavLink('watchlist-section');
                    } else if (wasInArchive) {
                        UI.updateActiveNavLink('unseen-section');
                    }
                } else { // A marcar
                    await S.markEpisodesAsWatched(seriesId, seasonEpisodeIds);
                    seasonDetailsElement.querySelectorAll('.episode-item').forEach(el => UI.markEpisodeAsSeen(el as HTMLElement));

                    const movedToArchive = await checkSeriesCompletion(seriesId);
                    if (movedToArchive) {
                        await setAllSeriesStatusFilterPreference('archive');
                        UI.updateActiveNavLink('all-series-section');
                    } else {
                        UI.renderWatchlist();
                        UI.renderUnseen();
                    }
                }

                UI.updateSeasonProgressUI(seriesId, seasonNumber);
                UI.updateOverallProgressBar(seriesId);
                updateGlobalProgress();
                UI.updateKeyStats();
            }
            return;
        }

        const trailerBtn = target.closest('.trailer-btn');
        if (trailerBtn) {
            const videoKey = (trailerBtn as HTMLElement).dataset.videoKey;
            if (videoKey) {
                UI.openTrailerModal(videoKey);
            }
            return;
        }
    });

    DOM.popularLoadMoreBtn?.addEventListener('click', () => {
        loadPopularSeries(true, activeSubmenuMediaTarget);
    });

    DOM.premieresLoadMoreBtn?.addEventListener('click', () => {
        loadPremieresSeries(true, activeSubmenuMediaTarget);
    });

    // Modals
    DOM.modalCloseBtn?.addEventListener('click', UI.closeEpisodeModal);
    DOM.episodeModal?.addEventListener('click', (e: MouseEvent) => e.target === DOM.episodeModal && UI.closeEpisodeModal());
    DOM.trailerModalCloseBtn?.addEventListener('click', UI.closeTrailerModal);
    DOM.trailerModal?.addEventListener('click', (e: MouseEvent) => e.target === DOM.trailerModal && UI.closeTrailerModal());
    DOM.notificationOkBtn?.addEventListener('click', UI.closeNotificationModal);
    DOM.notificationModal?.addEventListener('click', (e: MouseEvent) => e.target === DOM.notificationModal && UI.closeNotificationModal());
    DOM.notificationsBtn?.addEventListener('click', async (event) => {
        event.stopPropagation();
        if (!notificationsMenuOpen) {
            DOM.settingsMenu?.classList.remove('visible');
            await refreshNotificationsCenter();
        }
        toggleNotificationsMenu();
    });
    DOM.notificationsMenu?.addEventListener('click', (event) => {
        event.stopPropagation();
    });
    DOM.notificationsMarkAllReadBtn?.addEventListener('click', async (event) => {
        event.stopPropagation();
        await markAllNotificationsAsRead();
    });
    DOM.notificationsClearBtn?.addEventListener('click', async (event) => {
        event.stopPropagation();
        await clearNotificationsCenter();
    });
    DOM.notificationsMenuList?.addEventListener('click', async (event) => {
        const target = event.target as Element;
        const item = target.closest<HTMLButtonElement>('.notification-item');
        if (!item) return;

        const notificationId = item.dataset.notificationId;
        if (notificationId) {
            await markNotificationsAsRead([notificationId]);
        }

        const mediaId = Number(item.dataset.mediaId);
        const mediaType = parseMediaType(item.dataset.mediaType);
        closeNotificationsMenu();
        if (isMobileViewport()) {
            closeMobileTopbarPanel();
        }

        if (Number.isFinite(mediaId)) {
            document.dispatchEvent(new CustomEvent('display-media-details', {
                detail: { mediaType, mediaId }
            }));
        }
    });
    DOM.openLibrarySearchBtn?.addEventListener('click', UI.openLibrarySearchModal);
    DOM.librarySearchModalCloseBtn?.addEventListener('click', UI.closeLibrarySearchModal);
    DOM.librarySearchModal?.addEventListener('click', (e: MouseEvent) => e.target === DOM.librarySearchModal && UI.closeLibrarySearchModal());
    DOM.allRatingsModalCloseBtn?.addEventListener('click', UI.closeAllRatingsModal);
    DOM.allRatingsModal?.addEventListener('click', (e: MouseEvent) => {
        if (e.target === DOM.allRatingsModal) UI.closeAllRatingsModal();
        const summaryItem = (e.target as Element).closest('.rating-summary-item');
        if (summaryItem) {
            const rating = parseInt((summaryItem as HTMLElement).dataset.rating!, 10);
            UI.openSeriesByRatingModal(rating);
        }
    });

    DOM.librarySearchModalInput?.addEventListener('input', UI.performModalLibrarySearch);

    DOM.seriesByRatingModalResults?.addEventListener('click', (e) => {
        const topRatedItem = (e.target as Element).closest('.top-rated-item');
        if (topRatedItem) {
            const seriesId = parseInt((topRatedItem as HTMLElement).dataset.seriesId!, 10);
            const mediaType = parseMediaType((topRatedItem as HTMLElement).dataset.mediaType);
            document.dispatchEvent(new CustomEvent('display-media-details', { detail: { mediaType, mediaId: seriesId } }));
            UI.closeSeriesByRatingModal();
            UI.closeAllRatingsModal();
        }
    });

    let notesSaveTimeout: number;
    DOM.dashboard?.addEventListener('input', (e) => {
        const bookProgressRange = (e.target as Element).closest('#book-progress-range') as HTMLInputElement | null;
        if (bookProgressRange) {
            const progressValue = DOM.seriesViewSection.querySelector<HTMLElement>('#book-progress-value');
            if (progressValue) progressValue.textContent = `${bookProgressRange.value}%`;
            return;
        }

        const notesTextarea = (e.target as Element).closest('.user-notes-textarea');
        if (notesTextarea) {
            clearTimeout(notesSaveTimeout);
            notesSaveTimeout = window.setTimeout(async () => {
                const mediaType = parseMediaType((notesTextarea as HTMLElement).dataset.mediaType);
                const mediaId = parseInt((notesTextarea as HTMLElement).dataset.mediaId || (notesTextarea as HTMLElement).dataset.seriesId || '', 10);
                if (Number.isNaN(mediaId)) return;
                const notes = (notesTextarea as HTMLTextAreaElement).value;
                await S.updateMediaNotes(mediaType, mediaId, notes);
                console.log(`Notas para ${mediaType}:${mediaId} guardadas.`);
            }, 1500);
        }
    });
    DOM.seriesByRatingModalCloseBtn?.addEventListener('click', UI.closeSeriesByRatingModal);
    DOM.seriesByRatingModal?.addEventListener('click', (e: MouseEvent) => e.target === DOM.seriesByRatingModal && UI.closeSeriesByRatingModal());

    // Settings & Theme
    DOM.themeToggleBtn?.addEventListener('click', async () => {
        const currentTheme = document.body.classList.contains('light-theme') ? 'light' : 'dark';
        const newTheme = currentTheme === 'light' ? 'dark' : 'light';
        await db.kvStore.put({ key: C.THEME_STORAGE_KEY, value: newTheme });
        await syncUserSettingsToRemoteIfNeeded();
        UI.applyTheme(newTheme);
    });
    DOM.settingsBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        closeNotificationsMenu();
        DOM.settingsMenu.classList.toggle('visible');
    });
    document.addEventListener('click', (e: MouseEvent) => {
        const target = e.target as Node;
        if (DOM.settingsMenu && DOM.settingsBtn && !DOM.settingsMenu.contains(target) && !DOM.settingsBtn.contains(target)) {
            DOM.settingsMenu.classList.remove('visible');
        }
        if (DOM.notificationsMenu && DOM.notificationsBtn && !DOM.notificationsMenu.contains(target) && !DOM.notificationsBtn.contains(target)) {
            closeNotificationsMenu();
        }
        if (
            mobileTopbarPanelOpen &&
            DOM.mobileTopbarControls &&
            !DOM.mobileTopbarControls.contains(target)
        ) {
            closeMobileTopbarPanel();
        }
    });
    document.addEventListener('keydown', (event: KeyboardEvent) => {
        if (event.key !== 'Escape') return;
        if (DOM.settingsMenu?.classList.contains('visible')) {
            DOM.settingsMenu.classList.remove('visible');
        }
        if (notificationsMenuOpen) {
            closeNotificationsMenu();
        }
        if (mobileTopbarPanelOpen) {
            closeMobileTopbarPanel();
        }
    });
    DOM.exportDataBtn?.addEventListener('click', exportData);
    DOM.importDataBtn?.addEventListener('click', importData);
    DOM.authLoginBtn?.addEventListener('click', () => {
        DOM.settingsMenu.classList.remove('visible');
        if (isMobileViewport()) {
            closeMobileTopbarPanel();
        }
        openAuthModal('login');
    });
    DOM.authSignupBtn?.addEventListener('click', () => {
        DOM.settingsMenu.classList.remove('visible');
        if (isMobileViewport()) {
            closeMobileTopbarPanel();
        }
        openAuthModal('signup');
    });
    DOM.authLogoutBtn?.addEventListener('click', async () => {
        DOM.settingsMenu.classList.remove('visible');
        if (isMobileViewport()) {
            closeMobileTopbarPanel();
        }
        if (!isSupabaseConfigured()) return;
        if (!currentAuthenticatedUserId) {
            UI.showNotification('Utilizador sem sessão ativa.');
            setAuthStatusLabel('Sem sessão iniciada', 'default');
            return;
        }
        try {
            const session = await getCurrentSession();
            if (!session?.user) {
                setAuthenticatedUi(null);
                clearInMemoryLibraryState();
                renderLibraryStateFromMemory();
                UI.showNotification('Utilizador sem sessão ativa.');
                return;
            }
            lastSignOutReason = 'manual';
            await signOutCurrentUser();
        } catch (error) {
            const message = getErrorMessage(error);
            lastSignOutReason = null;
            console.error('[auth] Erro ao terminar sessão.', error);
            UI.showNotification(`Não foi possível terminar sessão: ${message}`);
        }
    });
    DOM.authForm?.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (authFormBusy || !isSupabaseConfigured()) return;

        const email = DOM.authEmailInput.value.trim();
        const password = DOM.authPasswordInput.value;
        const displayName = DOM.authDisplayNameInput.value.trim();
        clearAuthInlineFeedback();

        if (!email || !password) {
            setAuthInlineFeedback('Preencha email e password.');
            setAuthFormLoadingState(false);
            return;
        }

        if (authFormMode === 'signup' && !displayName) {
            setAuthInlineFeedback('Defina um nome a apresentar.');
            setAuthFormLoadingState(false);
            return;
        }

        if (authFormMode === 'signup' && displayName.length < 3) {
            setAuthInlineFeedback('O nome a apresentar deve ter pelo menos 3 caracteres.');
            setAuthFormLoadingState(false);
            return;
        }

        if (authFormMode === 'signup' && password.length < 8) {
            setAuthInlineFeedback('A password deve ter pelo menos 8 caracteres.');
            setAuthFormLoadingState(false);
            return;
        }

        setAuthFormLoadingState(true);
        try {
            if (authFormMode === 'signup') {
                const displayNameCheck = await checkDisplayNameAvailability(displayName);
                if (!displayNameCheck.available) {
                    setAuthInlineFeedback('Este nome a apresentar já existe. Escolha outro nome.');
                    setAuthFormLoadingState(false);
                    return;
                }
                const normalizedDisplayName = displayNameCheck.normalizedName?.trim() || displayName;
                DOM.authDisplayNameInput.value = normalizedDisplayName;
                const response = await signUpWithPassword({ email, password, displayName: normalizedDisplayName });
                const identityCount = Array.isArray((response.data.user as any)?.identities)
                    ? (response.data.user as any).identities.length
                    : null;
                const maybeExistingAccount = identityCount === 0;
                if (maybeExistingAccount) {
                    setAuthModalMode('login');
                    DOM.authEmailInput.value = email;
                    DOM.authPasswordInput.value = '';
                    setAuthInlineFeedback('Este email já pode estar registado. Tente entrar com a sua password.');
                    setAuthFormLoadingState(false);
                    return;
                }
                const requiresConfirmation = !response.data.session;
                closeAuthModal();
                if (requiresConfirmation) {
                    UI.showNotification('Se o email for novo, foi enviado um link de confirmação. Se já existir, use Entrar.');
                } else {
                    UI.showNotification('Conta criada e sessão iniciada.');
                }
            } else {
                await signInWithPassword(email, password);
                closeAuthModal();
            }
        } catch (error) {
            const message = getErrorMessage(error);
            console.error('[auth] Erro no submit de autenticação.', error);
            setAuthInlineFeedback(`Falha na autenticação: ${message}`);
            setAuthFormLoadingState(false);
        }
    });
    DOM.authToggleModeBtn?.addEventListener('click', () => {
        if (authFormBusy) return;
        setAuthModalMode(authFormMode === 'login' ? 'signup' : 'login');
        DOM.authDisplayNameInput.value = '';
    });
    DOM.authModalCloseBtn?.addEventListener('click', closeAuthModal);
    DOM.authModal?.addEventListener('click', (e: MouseEvent) => {
        if (e.target === DOM.authModal) closeAuthModal();
    });
    DOM.toggleAsianAnimationFilterBtn?.addEventListener('click', async () => {
        excludeAsianAnimationFromTopRated = !excludeAsianAnimationFromTopRated;
        await db.kvStore.put({
            key: C.TOP_RATED_EXCLUDE_ASIAN_ANIMATION_KEY,
            value: excludeAsianAnimationFromTopRated,
        });
        await syncUserSettingsToRemoteIfNeeded();
        updateTopRatedFilterToggleButton();
        UI.showNotification(
            excludeAsianAnimationFromTopRated
                ? 'Séries de animação ocultadas no Top Rated.'
                : 'Séries de animação visíveis no Top Rated.'
        );

        const popularSection = document.getElementById('popular-section');
        if (popularSection && popularSection.style.display !== 'none') {
            S.resetSearchAbortController();
            loadPopularSeries(false, activeSubmenuMediaTarget);
        }
    });
    DOM.rescanSeriesBtn?.addEventListener('click', rescanAllSeries);
    DOM.refetchDataBtn?.addEventListener('click', refetchAllMetadata);

    DOM.confirmBtn?.addEventListener('click', () => UI.closeConfirmationModal(true));
    DOM.cancelBtn?.addEventListener('click', () => UI.closeConfirmationModal(false));
    DOM.confirmationModal?.addEventListener('click', (e: MouseEvent) => {
        if (e.target === DOM.confirmationModal) UI.closeConfirmationModal(false);
    });
    
    document.getElementById('export-stats-btn')?.addEventListener('click', () => {
        // Exportar o gráfico de géneros para PNG
        const genresChart = S.charts['genresChart'];
        if (genresChart) {
            exportChartToPNG(genresChart, 'grafico_generos.png');
        }

        // Exportar a lista de séries mais bem avaliadas para CSV
        const ratedSeriesWithData = [...S.myWatchlist, ...S.myArchive]
            .map(series => {
                const mediaType = series.media_type || 'series';
                const mediaKey = mediaType === 'series' ? String(series.id) : createMediaKey(mediaType, series.id);
                return { series, rating: S.userData[mediaKey]?.rating };
            })
            .filter((item): item is { series: Series; rating: number } => !!item.rating && item.rating > 0);

        ratedSeriesWithData.sort((a, b) => b.rating - a.rating);

        if (ratedSeriesWithData.length > 0) {
            const headers = {
                name: 'Série',
                rating: 'A Sua Avaliação',
                vote_average: 'Avaliação Pública'
            };
            const dataForCSV = ratedSeriesWithData.map(item => ({
                name: item.series.name,
                rating: item.rating,
                vote_average: (item.series as any).vote_average || 'N/A'
            }));
            exportDataToCSV(dataForCSV, headers, 'series_mais_avaliadas.csv');
        }
        UI.showNotification('Exportação de estatísticas concluída!');
    });

    // Listener para o evento personalizado que mostra os detalhes da série
    document.addEventListener('display-media-details', ((e: CustomEvent) => {
        const mediaType = parseMediaType(e.detail.mediaType);
        const mediaId = Number(e.detail.mediaId);
        if (!Number.isFinite(mediaId)) return;
        displayMediaDetails(mediaType, mediaId);
    }) as EventListener);

    document.addEventListener('display-series-details', ((e: CustomEvent) => {
        const seriesId = Number(e.detail.seriesId);
        if (!Number.isFinite(seriesId)) return;
        displayMediaDetails('series', seriesId);
    }) as EventListener);

    void (async () => {
        await initializeAuthState();
        await initializeApp();
    })();
});
