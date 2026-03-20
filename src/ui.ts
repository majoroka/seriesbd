import { el, hexToRgb, getTranslatedSeasonName, formatHoursMinutes, formatCertification, animateValue, animateDuration, formatDuration, translateGenreName } from './utils';
import * as DOM from './dom';
import * as S from './state';
import * as API from './api';
import { DASHBOARD_NEWS_ENHANCED_ENABLED } from './constants';
import Chart, { ChartType } from 'chart.js/auto';
import { Series, TMDbSeriesDetails, TMDbSeason, TMDbCredits, TraktData, TraktSeason, Episode, Genre, AggregatedSeriesMetadata, MediaType, DashboardNewsItem, NewsMediaTypeHint } from './types';
import { createMediaKey } from './media';

declare module 'chart.js' {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    interface PluginOptionsByType<TType extends ChartType> {
        doughnutCenterText?: {
            animatedValue: number;
        };
    }
}

let confirmationResolve: ((value: boolean) => void) | null = null;
const FOCUSABLE_SELECTOR = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const modalStack: { overlay: HTMLDivElement; returnFocus: HTMLElement | null }[] = [];
let modalA11yInitialized = false;
let scopedLibraryMediaType: 'all' | MediaType = 'all';
let scopedStatsMediaType: 'all' | MediaType = 'all';

export function setScopedLibraryMediaType(mediaType: 'all' | MediaType): void {
    if (mediaType === 'series' || mediaType === 'movie' || mediaType === 'book' || mediaType === 'all') {
        scopedLibraryMediaType = mediaType;
        return;
    }
    scopedLibraryMediaType = 'all';
}

export function setScopedStatsMediaType(mediaType: 'all' | MediaType): void {
    if (mediaType === 'series' || mediaType === 'movie' || mediaType === 'book' || mediaType === 'all') {
        scopedStatsMediaType = mediaType;
        return;
    }
    scopedStatsMediaType = 'all';
}

function getMediaTypeLabel(mediaType: MediaType): string {
    if (mediaType === 'movie') return 'Filme';
    if (mediaType === 'book') return 'Livro';
    return 'Série';
}

function getMediaTypeChipClass(mediaType: MediaType, extraClass = ''): string {
    const base = `media-type-chip media-type-chip--${mediaType}`;
    return extraClass ? `${base} ${extraClass}` : base;
}

function buildExternalImageProxyUrl(rawUrl: string): string {
    const normalizedUrl = String(rawUrl || '').trim();
    if (!normalizedUrl) return '';
    if (normalizedUrl.startsWith('/api/news-image?url=')) return normalizedUrl;
    if (/^https?:\/\//i.test(normalizedUrl)) {
        return `/api/news-image?url=${encodeURIComponent(normalizedUrl)}`;
    }
    if (normalizedUrl.startsWith('//')) {
        return `/api/news-image?url=${encodeURIComponent(`https:${normalizedUrl}`)}`;
    }
    return normalizedUrl;
}

function buildPosterUrl(
    posterPath: string | null | undefined,
    tmdbSize: string,
    fallback: string
): string {
    if (!posterPath) return fallback;
    const normalizedPath = String(posterPath).trim();
    if (!normalizedPath) return fallback;
    if (/^https?:\/\//i.test(normalizedPath) || normalizedPath.startsWith('//')) {
        return buildExternalImageProxyUrl(normalizedPath);
    }
    return `https://image.tmdb.org/t/p/${tmdbSize}${normalizedPath}`;
}

function decodeHtmlEntities(rawValue: string): string {
    return rawValue.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entityRaw) => {
        const entity = String(entityRaw || '').toLowerCase();
        if (!entity) return match;
        if (entity.startsWith('#x')) {
            const code = Number.parseInt(entity.slice(2), 16);
            return Number.isFinite(code) ? String.fromCodePoint(code) : match;
        }
        if (entity.startsWith('#')) {
            const code = Number.parseInt(entity.slice(1), 10);
            return Number.isFinite(code) ? String.fromCodePoint(code) : match;
        }
        const map: Record<string, string> = {
            amp: '&',
            lt: '<',
            gt: '>',
            quot: '"',
            apos: "'",
            nbsp: ' ',
        };
        return map[entity] ?? match;
    });
}

function sanitizePlainText(value: unknown): string {
    const raw = String(value || '');
    if (!raw) return '';
    const withoutTags = raw
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<\/p>/gi, ' ')
        .replace(/<[^>]*>/g, ' ');
    const decoded = decodeHtmlEntities(withoutTags);
    return decoded.replace(/\s+/g, ' ').trim();
}

function getSafeOverviewText(value: unknown): string {
    const sanitized = sanitizePlainText(value);
    return sanitized || 'Sinopse não disponível.';
}

function createPosterImage(
    src: string,
    alt: string,
    className: string,
    fallbackSrc: string
): HTMLImageElement {
    const img = el('img', { src, alt, class: className, loading: 'lazy' }) as HTMLImageElement;
    if (/^https?:\/\//i.test(src)) {
        img.referrerPolicy = 'no-referrer';
    }
    img.addEventListener('error', () => {
        if (img.dataset.fallbackApplied === '1') return;
        img.dataset.fallbackApplied = '1';
        img.src = fallbackSrc;
    });
    return img;
}

function getMediaStateKey(series: Series): string {
    const mediaType = series.media_type || 'series';
    return mediaType === 'series' ? String(series.id) : createMediaKey(mediaType, series.id);
}

function getMediaProgressPercent(series: Series): number {
    const mediaType = series.media_type || 'series';
    if (mediaType === 'series') {
        const watchedCount = S.watchedState[series.id]?.length || 0;
        const totalEpisodes = series.total_episodes || 0;
        if (totalEpisodes <= 0) return 0;
        return Math.max(0, Math.min(100, (watchedCount / totalEpisodes) * 100));
    }
    const progress = S.userData[getMediaStateKey(series)]?.progress_percent;
    if (typeof progress !== 'number' || Number.isNaN(progress)) return 0;
    return Math.max(0, Math.min(100, progress));
}

function getMediaRating(series: Series): number {
    const rating = S.userData[getMediaStateKey(series)]?.rating;
    return typeof rating === 'number' ? rating : 0;
}

// UI Update Functions
export function showSection(targetId: string) {
    DOM.mainContentSections.forEach(section => {
        section.style.display = 'none';
    });

    // Update URL hash without causing a page jump or adding to history
    const newHash = `#${targetId}`;
    if (history.replaceState) {
        // This prevents the page from jumping and creating a new history entry
        history.replaceState(null, '', newHash);
    }

    const targetSection = document.getElementById(targetId);
    if (targetSection) {
        targetSection.style.display = 'block';
    }

    const activeLink = document.querySelector(`.nav-link[data-target="${targetId}"]`);
    if (activeLink) {
        DOM.mainNavLinks.forEach(link => link.classList.remove('active'));
        activeLink.classList.add('active');
    }

    if (targetId === 'stats-section') {
        const stats = updateKeyStats(true);
        renderStatistics(stats);
    }
    if (targetId === 'media-dashboard-section') {
        requestAnimationFrame(() => {
            renderMediaDashboard();
        });
    }
}

export function updateActiveNavLink(targetId: string) {
    const activeLink = document.querySelector(`.nav-link[data-target="${targetId}"]`);
    if (activeLink) {
        DOM.mainNavLinks.forEach(link => link.classList.remove('active'));
        activeLink.classList.add('active');
    }
}

export function applyViewMode(view: string, container: HTMLElement, toggle: HTMLElement) {
    if (!container || !toggle) return;
    const gridButton = toggle.querySelector('[data-view="grid"]');
    const listButton = toggle.querySelector('[data-view="list"]');
    if (view === 'grid') {
        container.classList.add('grid-view');
        gridButton?.classList.add('active');
        listButton?.classList.remove('active');
    } else {
        container.classList.remove('grid-view');
        listButton?.classList.add('active');
        gridButton?.classList.remove('active');
    }
}

export function applyTheme(theme: string) {
    if (DOM.themeToggleBtn) {
        document.body.classList.toggle('light-theme', theme === 'light');
        const isLightTheme = theme === 'light';
        const label = isLightTheme ? 'Mudar para tema escuro' : 'Mudar para tema claro';
        const icon = isLightTheme ? 'fa-moon' : 'fa-sun';
        DOM.themeToggleBtn.innerHTML = `<i class="fas ${icon}"></i> ${label}`;
        DOM.themeToggleBtn.title = label;
        DOM.themeToggleBtn.setAttribute('aria-label', label);
    }
    const statsSection = document.getElementById('stats-section');
    if (statsSection && statsSection.style.display !== 'none') {
        requestAnimationFrame(() => {
            const stats = updateKeyStats();
            renderStatistics(stats);
        });
    }
    const dashboardSection = document.getElementById('media-dashboard-section');
    if (dashboardSection && dashboardSection.style.display !== 'none') {
        requestAnimationFrame(() => {
            renderMediaDashboard();
        });
    }
}

function focusModal(overlay: HTMLDivElement, preferredFocus?: HTMLElement | null) {
    const content = overlay.querySelector<HTMLElement>('.modal-content');
    const focusableElements = Array.from(
        (content || overlay).querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
    ).filter(el => el.offsetParent !== null || el.getClientRects().length > 0);

    const target = preferredFocus && (preferredFocus.offsetParent !== null || preferredFocus.getClientRects().length > 0)
        ? preferredFocus
        : (focusableElements[0] || content);

    target?.focus();
}

function showModal(overlay: HTMLDivElement, preferredFocus?: HTMLElement | null) {
    const currentFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const existingIndex = modalStack.findIndex(item => item.overlay === overlay);
    if (existingIndex !== -1) modalStack.splice(existingIndex, 1);
    modalStack.push({ overlay, returnFocus: currentFocus });

    overlay.style.display = 'flex';
    overlay.setAttribute('aria-hidden', 'false');
    setTimeout(() => {
        overlay.classList.add('visible');
        focusModal(overlay, preferredFocus);
    }, 10);
}

function hideModal(overlay: HTMLDivElement, afterHide?: () => void) {
    const stackIndex = modalStack.findIndex(item => item.overlay === overlay);
    const wasTopModal = stackIndex === modalStack.length - 1;
    const stackItem = stackIndex >= 0 ? modalStack[stackIndex] : null;

    overlay.classList.remove('visible');
    setTimeout(() => {
        overlay.style.display = 'none';
        overlay.setAttribute('aria-hidden', 'true');
        if (stackIndex >= 0) {
            modalStack.splice(stackIndex, 1);
        }
        afterHide?.();

        if (!wasTopModal) return;
        if (stackItem?.returnFocus && document.contains(stackItem.returnFocus)) {
            stackItem.returnFocus.focus();
            return;
        }
        const newTopModal = modalStack[modalStack.length - 1];
        if (newTopModal) {
            focusModal(newTopModal.overlay);
        }
    }, 300);
}

function closeTopModal() {
    const topModal = modalStack[modalStack.length - 1]?.overlay;
    if (!topModal) return;
    switch (topModal.id) {
        case 'episode-modal':
            closeEpisodeModal();
            break;
        case 'trailer-modal':
            closeTrailerModal();
            break;
        case 'library-search-modal':
            closeLibrarySearchModal();
            break;
        case 'all-ratings-modal':
            closeAllRatingsModal();
            break;
        case 'series-by-rating-modal':
            closeSeriesByRatingModal();
            break;
        case 'notification-modal':
            closeNotificationModal();
            break;
        case 'confirmation-modal':
            closeConfirmationModal(false);
            break;
        case 'auth-modal':
            closeAuthModal();
            break;
        default:
            break;
    }
}

function trapFocusWithinModal(event: KeyboardEvent, overlay: HTMLDivElement) {
    const content = overlay.querySelector<HTMLElement>('.modal-content');
    const focusableElements = Array.from(
        (content || overlay).querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
    ).filter(el => el.offsetParent !== null || el.getClientRects().length > 0);

    if (focusableElements.length === 0) {
        event.preventDefault();
        content?.focus();
        return;
    }

    const first = focusableElements[0];
    const last = focusableElements[focusableElements.length - 1];
    const active = document.activeElement as HTMLElement | null;
    const isInsideModal = !!active && overlay.contains(active);

    if (event.shiftKey) {
        if (!isInsideModal || active === first) {
            event.preventDefault();
            last.focus();
        }
        return;
    }

    if (!isInsideModal || active === last) {
        event.preventDefault();
        first.focus();
    }
}

export function initModalAccessibility() {
    if (modalA11yInitialized) return;
    modalA11yInitialized = true;

    document.addEventListener('keydown', (event: KeyboardEvent) => {
        const topModal = modalStack[modalStack.length - 1]?.overlay;
        if (!topModal) return;

        if (event.key === 'Escape') {
            event.preventDefault();
            closeTopModal();
            return;
        }

        if (event.key === 'Tab') {
            trapFocusWithinModal(event, topModal);
        }
    });
}

// Modal Functions
export function openEpisodeModal(title: string, overview: string, imageUrl: string) {
    DOM.modalTitle.textContent = title;
    DOM.modalSynopsis.textContent = getSafeOverviewText(overview);
    DOM.modalImage.src = imageUrl;
    showModal(DOM.episodeModal, DOM.modalCloseBtn);
}

export function closeEpisodeModal() {
    hideModal(DOM.episodeModal, () => {
        DOM.episodeModal.style.display = 'none';
        DOM.modalImage.src = '';
        DOM.modalTitle.textContent = '';
        DOM.modalSynopsis.textContent = '';
    });
}

export function openTrailerModal(videoKey: string) {
    DOM.trailerIframe.src = `https://www.youtube.com/embed/${videoKey}?autoplay=1&rel=0`;
    showModal(DOM.trailerModal, DOM.trailerModalCloseBtn);
}

export function closeTrailerModal() {
    hideModal(DOM.trailerModal, () => {
        DOM.trailerModal.style.display = 'none';
        DOM.trailerIframe.src = '';
    });
}

export function openLibrarySearchModal() {
    DOM.librarySearchModalInput.value = '';
    DOM.librarySearchModalResults.innerHTML = '<p>Comece a escrever para pesquisar na sua biblioteca.</p>';
    showModal(DOM.librarySearchModal, DOM.librarySearchModalInput);
}

export function closeLibrarySearchModal() {
    hideModal(DOM.librarySearchModal);
}

export function openAuthModal() {
    showModal(DOM.authModal, DOM.authEmailInput);
}

export function closeAuthModal() {
    hideModal(DOM.authModal);
}

export function openAllRatingsModal() {
    const summary = buildStatsSummary();
    const allRatingsTitle = document.getElementById('all-ratings-modal-title');
    if (allRatingsTitle) {
        allRatingsTitle.textContent = `As Minhas Avaliações (${summary.meta.ratingPlural})`;
    }
    renderRatingsSummary();
    showModal(DOM.allRatingsModal, DOM.allRatingsModalCloseBtn);
}

export function closeAllRatingsModal() {
    hideModal(DOM.allRatingsModal);
}

export function openSeriesByRatingModal(rating: number) {
    const summary = buildStatsSummary();
    DOM.seriesByRatingModalTitle.textContent = `${summary.meta.ratingPlural} com ${rating} Estrela${rating > 1 ? 's' : ''}`;
    renderRatedSeriesByRating(rating);
    showModal(DOM.seriesByRatingModal, DOM.seriesByRatingModalCloseBtn);
}

export function closeSeriesByRatingModal() {
    hideModal(DOM.seriesByRatingModal);
}

export function showNotification(message: string) {
    const isAuthModalVisible = DOM.authModal?.getAttribute('aria-hidden') === 'false';
    if (isAuthModalVisible && DOM.authInlineFeedback) {
        DOM.authInlineFeedback.textContent = message;
        DOM.authInlineFeedback.hidden = false;
        DOM.authInlineFeedback.classList.remove('info');
        return;
    }
    DOM.notificationMessage.textContent = message;
    showModal(DOM.notificationModal, DOM.notificationOkBtn);
}

export function closeNotificationModal() {
    hideModal(DOM.notificationModal);
}

export function showConfirmationModal(message: string): Promise<boolean> {
    DOM.confirmationMessage.textContent = message;
    showModal(DOM.confirmationModal, DOM.confirmBtn);

    return new Promise<boolean>((resolve) => {
        confirmationResolve = resolve;
    });
}

export function closeConfirmationModal(result: boolean) {
    hideModal(DOM.confirmationModal);
    if (confirmationResolve) {
        confirmationResolve(result);
        confirmationResolve = null;
    }
}

// Rendering Functions
export function renderNextAired(episodeList: { seriesName: string, seriesPoster: string | null, episode: Episode }[]) {
    DOM.nextAiredListContainer.innerHTML = '';
    if (episodeList.length === 0) {
        DOM.nextAiredListContainer.innerHTML = '<p>Nenhum episódio agendado para as séries que está a ver.</p>';
        return;
    }
    episodeList.forEach(item => {
        const { seriesName, seriesPoster, episode } = item;
        const airDate = new Date(episode.air_date).getTime();
        let formattedDate = !isNaN(airDate) ? new Date(airDate).toLocaleDateString('pt-PT', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Data inválida';
        const posterPath = buildPosterUrl(
            seriesPoster,
            'w92',
            '/placeholders/poster.svg'
        );
        let episodeNumber = (episode.season_number !== undefined && episode.episode_number !== undefined) ? `S${String(episode.season_number).padStart(2, '0')}E${String(episode.episode_number).padStart(2, '0')}` : '';
        const itemElement = el('div', { class: 'episode-item-small' }, [
            createPosterImage(
                posterPath,
                `Poster de ${seriesName}`,
                'next-aired-poster',
                '/placeholders/poster.svg'
            ),
            el('span', { class: 'episode-info', text: `${seriesName} ${episodeNumber}` }),
            el('span', { class: 'episode-date', text: formattedDate })
        ]);
        DOM.nextAiredListContainer.appendChild(itemElement);
    });
}

export function renderSearchResults(resultsList: Series[]) {
    DOM.searchResultsContainer.innerHTML = '';
    if (resultsList.length === 0) {
        DOM.searchResultsContainer.appendChild(el('p', { text: 'Nenhum resultado encontrado.' }));
        return;
    }
    resultsList.forEach(series => {
        const posterPath = buildPosterUrl(
            series.poster_path,
            'w185',
            '/placeholders/poster.svg'
        );
        const releaseYear = series.first_air_date ? `(${new Date(series.first_air_date).getFullYear()})` : '';
        const mediaType = series.media_type || 'series';
        const mediaTypeLabel = getMediaTypeLabel(mediaType);
        const isInLibrary = S.myWatchlist.some(s => s.media_type === mediaType && s.id === series.id)
            || S.myArchive.some(s => s.media_type === mediaType && s.id === series.id);
        const allowMarkAllSeen = mediaType === 'series';
        
        const actionButtons = isInLibrary 
            ? el('div', { class: 'search-result-actions' }, [el('span', { class: 'in-library-label' }, ['Na Biblioteca ', el('i', { class: 'fas fa-check-circle' })])])
            : el('div', { class: 'search-result-actions' }, [
                el('button', {
                    class: 'v2-action-btn icon-only add-series-quick-btn',
                    'data-series-id': String(series.id),
                    'data-media-type': mediaType,
                    title: `Adicionar ${mediaTypeLabel.toLowerCase()} à Biblioteca`
                }, [el('i', { class: 'fas fa-plus' })]),
                allowMarkAllSeen
                    ? el('button', {
                        class: 'v2-action-btn icon-only mark-all-seen-quick-btn',
                        'data-series-id': String(series.id),
                        'data-media-type': mediaType,
                        title: 'Adicionar e Marcar Tudo Como Visto'
                    }, [el('i', { class: 'fas fa-check-double' })])
                    : null
            ]);

        const item = el('div', { class: 'search-result-item', 'data-series-id': String(series.id), 'data-media-type': mediaType }, [
            createPosterImage(
                posterPath,
                `Poster de ${series.name}`,
                'search-result-poster',
                '/placeholders/poster.svg'
            ),
            el('div', { class: 'search-result-info' }, [
                el('h3', {}, [
                    `${series.name} ${releaseYear}`,
                    mediaType !== 'series' ? ' ' : null,
                    mediaType !== 'series' ? el('span', { class: getMediaTypeChipClass(mediaType), text: mediaTypeLabel }) : null
                ]),
                el('p', { text: getSafeOverviewText(series.overview) })
            ]),
            actionButtons
        ]);
        DOM.searchResultsContainer.appendChild(item);
    });
}

export function renderTrending(seriesList: Series[], container: HTMLElement) {
    if (!container) return; // Early exit if container is not valid

    container.innerHTML = ''; // Limpa o conteúdo anterior

    if (seriesList.length === 0) {
        container.innerHTML = '<p class="empty-list-message">Não foi possível carregar as tendências.</p>';
        return;
    }

    const scroller = el('div', { class: 'column_content flex scroller loaded' });

    seriesList.forEach(series => {
        const posterPath = buildPosterUrl(
            series.poster_path,
            'w220_and_h330_face',
            '/placeholders/poster.svg'
        );
        const releaseDate = series.first_air_date ? new Date(series.first_air_date).toLocaleDateString('pt-PT', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Data desconhecida';
        const voteAverage = (series.vote_average || 0).toFixed(1);
        const releaseYear = series.first_air_date ? `(${new Date(series.first_air_date).getFullYear()})` : '';

        const mediaType = series.media_type || 'series';
        const card = el('div', { class: 'trending-card', 'data-series-id': String(series.id), 'data-media-type': mediaType }, [
            el('div', { class: 'image' }, [
                el('div', { class: 'wrapper' }, [
                    createPosterImage(
                        posterPath,
                        series.name,
                        'poster',
                        '/placeholders/poster.svg'
                    )
                ]),
                el('div', { class: 'consensus' }, [
                    el('div', {
                        class: 'user_score_chart',
                        'data-rating': voteAverage,
                    })
                ])
            ]),
            el('div', { class: 'content' }, [
                el('h2', {}, [el('a', { text: `${series.name} ${releaseYear}` })]),
                el('p', { text: releaseDate })
            ])
        ]);

        scroller.appendChild(card);
    });
    container.appendChild(scroller);
}

export function renderWatchlist() {
    const viewMode = DOM.watchlistContainer.classList.contains('grid-view') ? 'grid' : 'list';
    DOM.watchlistContainer.innerHTML = '';
    const seriesToWatch = S.myWatchlist
        .filter((series) => scopedLibraryMediaType === 'all' || (series.media_type || 'series') === scopedLibraryMediaType)
        .filter((series) => {
        const mediaType = series.media_type || 'series';
        if (mediaType === 'series') {
            return !S.watchedState[series.id] || S.watchedState[series.id].length === 0;
        }
        if (mediaType === 'movie') return true;
        return getMediaProgressPercent(series) === 0;
    });
    if (seriesToWatch.length === 0) {
        if (scopedLibraryMediaType === 'book') {
            DOM.watchlistContainer.innerHTML = '<p class="empty-list-message">Nenhum livro novo para começar.</p>';
        } else if (scopedLibraryMediaType === 'movie') {
            DOM.watchlistContainer.innerHTML = '<p class="empty-list-message">Nenhum filme novo para começar.</p>';
        } else {
            DOM.watchlistContainer.innerHTML = '<p class="empty-list-message">Nenhum conteúdo novo para começar. Adicione itens ou veja o separador "A Ver".</p>';
        }
        return;
    }
    seriesToWatch.forEach(series => {
        const seriesItemElement = createSeriesItemElement(series, false, viewMode, false);
        DOM.watchlistContainer.appendChild(seriesItemElement);
    });
}

export function renderUnseen() {
    const viewMode = DOM.unseenContainer.classList.contains('grid-view') ? 'grid' : 'list';
    DOM.unseenContainer.innerHTML = '';
    const seriesInProgress = S.myWatchlist
        .filter((series) => scopedLibraryMediaType === 'all' || (series.media_type || 'series') === scopedLibraryMediaType)
        .filter(series => {
        const mediaType = series.media_type || 'series';
        if (mediaType === 'series') {
            const watchedCount = S.watchedState[series.id]?.length || 0;
            const totalEpisodes = series.total_episodes || 0;
            if (totalEpisodes > 0) {
                return watchedCount > 0 && watchedCount < totalEpisodes;
            }
            return watchedCount > 0;
        }
        const progressPercent = getMediaProgressPercent(series);
        return progressPercent > 0 && progressPercent < 100;
    });
    if (seriesInProgress.length === 0) {
        if (scopedLibraryMediaType === 'book') {
            DOM.unseenContainer.innerHTML = '<p class="empty-list-message">Nenhum livro em leitura.</p>';
        } else if (scopedLibraryMediaType === 'movie') {
            DOM.unseenContainer.innerHTML = '<p class="empty-list-message">Nenhum filme em progresso.</p>';
        } else {
            DOM.unseenContainer.innerHTML = '<p class="empty-list-message">Nenhum conteúdo em progresso.</p>';
        }
        return;
    }
    seriesInProgress.forEach(series => {
        const seriesItemElement = createSeriesItemElement(series, false, viewMode, true);
        DOM.unseenContainer.appendChild(seriesItemElement);
    });
}

export function renderArchive() {
    if (!DOM.archiveContainer) return;
    const viewMode = DOM.archiveContainer.classList.contains('grid-view') ? 'grid' : 'list';
    DOM.archiveContainer.innerHTML = '';
    S.myArchive.sort((a, b) => a.name.localeCompare(b.name));
    if (S.myArchive.length === 0) {
        DOM.archiveContainer.innerHTML = '<p class="empty-list-message">O seu arquivo está vazio.</p>';
        return;
    }
    S.myArchive.forEach(series => {
        const seriesItemElement = createSeriesItemElement(series, false, viewMode, false);
        DOM.archiveContainer.appendChild(seriesItemElement);
    });
}

type LibraryStatusFilter = 'watchlist' | 'unseen' | 'archive';
type DashboardCardType = MediaType | 'all';
type DashboardMetrics = {
    total: number;
    inProgress: number;
    completed: number;
};
type DashboardRecentEntry = {
    item: Series;
    progress: number;
    statusLabel: string;
    statusClass: 'is-complete' | 'is-progress' | 'is-pending';
};
type DashboardUpcomingEntry = {
    item: Series;
    date: Date;
    label: string;
    source: 'library' | 'suggested-series' | 'suggested-movie' | 'suggested-book';
};
type DashboardSuggestionEntry = {
    item: Series;
    reason: string;
};
type DashboardNewsState = 'idle' | 'loading' | 'ready' | 'error';
type DashboardContentFilter = 'all' | 'series' | 'movie' | 'book';
type DashboardPanelKey = 'news' | 'upcoming' | 'recent' | 'suggestions';

type DashboardTopGenre = {
    label: string;
    normalized: string;
    count: number;
    movieGenreId: number | null;
    bookQuery: string;
};

const DASHBOARD_TOP_GENRES_LIMIT = 3;
const DASHBOARD_UPCOMING_VISIBLE_LIMIT = 18;
const DASHBOARD_UPCOMING_LIBRARY_LIMIT = 6;
const DASHBOARD_UPCOMING_SERIES_SUGGESTED_LIMIT = 6;
const DASHBOARD_UPCOMING_MOVIE_SUGGESTED_LIMIT = 6;
const DASHBOARD_UPCOMING_BOOK_SUGGESTED_LIMIT = 4;
const DASHBOARD_UPCOMING_MAX_SERIES_SUGGESTIONS = 6;
const DASHBOARD_UPCOMING_MAX_MOVIE_SUGGESTIONS = 6;
const DASHBOARD_UPCOMING_MAX_BOOK_SUGGESTIONS = 4;
const DASHBOARD_UPCOMING_RECENT_BOOK_DAYS = 365;
const DASHBOARD_UPCOMING_CACHE_TTL_MS = 20 * 60 * 1000;
const DASHBOARD_SUGGESTED_MAX_PER_MEDIA = 4;
const DASHBOARD_SUGGESTED_MAX_TOTAL = 12;
const DASHBOARD_SUGGESTED_CACHE_TTL_MS = 20 * 60 * 1000;
const DASHBOARD_SUGGESTED_HISTORY_MIN_ITEMS = 5;
const DASHBOARD_NEWS_LIMIT = 24;
const DASHBOARD_NEWS_CACHE_TTL_MS = 15 * 60 * 1000;
let dashboardSuggestedUpcomingEntries: DashboardUpcomingEntry[] = [];
let dashboardUpcomingCacheSignature = '';
let dashboardUpcomingCacheExpiresAt = 0;
let dashboardUpcomingInFlight: Promise<void> | null = null;
let dashboardUpcomingRequestVersion = 0;
let dashboardSuggestedRecommendationEntries: DashboardSuggestionEntry[] = [];
let dashboardSuggestedCacheSignature = '';
let dashboardSuggestedCacheExpiresAt = 0;
let dashboardSuggestedInFlight: Promise<void> | null = null;
let dashboardSuggestedRequestVersion = 0;
let dashboardNewsEntries: DashboardNewsItem[] = [];
let dashboardNewsState: DashboardNewsState = 'idle';
let dashboardNewsCacheExpiresAt = 0;
let dashboardNewsInFlight: Promise<void> | null = null;
let dashboardNewsRequestVersion = 0;
const dashboardPanelFilters: Record<DashboardPanelKey, DashboardContentFilter> = {
    news: 'all',
    upcoming: 'all',
    recent: 'all',
    suggestions: 'all',
};

const DASHBOARD_NEWS_STOPWORDS = new Set([
    'para', 'com', 'from', 'that', 'this', 'sobre', 'will', 'into', 'through', 'after', 'before', 'sobre',
    'uma', 'umas', 'uns', 'the', 'and', 'mais', 'como', 'quando', 'where', 'what', 'have', 'novo', 'nova',
    'series', 'série', 'filme', 'livro', 'media', 'show', 'shows', 'book', 'books', 'movie', 'movies',
]);

const MOVIE_GENRE_ID_BY_KEY: Record<string, number> = {
    action: 28,
    acao: 28,
    adventure: 12,
    aventura: 12,
    animation: 16,
    animacao: 16,
    comedy: 35,
    comedia: 35,
    crime: 80,
    documentary: 99,
    documentario: 99,
    drama: 18,
    family: 10751,
    familia: 10751,
    fantasy: 14,
    fantasia: 14,
    history: 36,
    historia: 36,
    horror: 27,
    terror: 27,
    music: 10402,
    musica: 10402,
    mystery: 9648,
    misterio: 9648,
    romance: 10749,
    'science fiction': 878,
    'ficcao cientifica': 878,
    'ficcao cientifica e fantasia': 878,
    thriller: 53,
    war: 10752,
    guerra: 10752,
    western: 37,
    faroeste: 37,
};

function resolveLibraryStatus(series: Series): LibraryStatusFilter {
    const mediaType = series.media_type || 'series';
    const isArchived = S.myArchive.some(item => item.media_type === mediaType && item.id === series.id);
    if (isArchived) return 'archive';

    if (mediaType === 'series') {
        const watchedCount = S.watchedState[series.id]?.length || 0;
        return watchedCount > 0 ? 'unseen' : 'watchlist';
    }

    const progressPercent = getMediaProgressPercent(series);
    return progressPercent > 0 && progressPercent < 100 ? 'unseen' : 'watchlist';
}

function resolveDashboardProgress(series: Series): number {
    const mediaType = series.media_type || 'series';
    if (mediaType !== 'series') {
        return getMediaProgressPercent(series);
    }

    const watchedCount = S.watchedState[series.id]?.length || 0;
    const totalEpisodes = series.total_episodes || 0;
    if (totalEpisodes > 0) {
        return Math.max(0, Math.min(100, (watchedCount / totalEpisodes) * 100));
    }
    return watchedCount > 0 ? 1 : 0;
}

function isItemArchived(item: Series): boolean {
    const mediaType = item.media_type || 'series';
    return S.myArchive.some((archived) => archived.media_type === mediaType && archived.id === item.id);
}

function getItemStatusLabel(item: Series, progress: number): string {
    const mediaType = item.media_type || 'series';
    const archived = isItemArchived(item);
    if (archived || progress >= 100) {
        return mediaType === 'book' ? 'LIDO' : 'VISTO';
    }
    if (progress > 0) {
        return mediaType === 'book' ? 'A LER' : 'A VER';
    }
    return mediaType === 'book' ? 'QUERO LER' : 'QUERO VER';
}

function getItemStatusClass(item: Series, progress: number): 'is-complete' | 'is-progress' | 'is-pending' {
    const archived = isItemArchived(item);
    if (archived || progress >= 100) return 'is-complete';
    if (progress > 0) return 'is-progress';
    return 'is-pending';
}

function getItemConsumedHours(item: Series): number {
    const mediaType = item.media_type || 'series';
    if (mediaType === 'series') {
        const watchedCount = S.watchedState[item.id]?.length || 0;
        const totalEpisodes = item.total_episodes || 0;
        const runtimeMinutes = typeof item.episode_run_time === 'number' && item.episode_run_time > 0
            ? item.episode_run_time
            : 30;
        if (watchedCount > 0) {
            return (watchedCount * runtimeMinutes) / 60;
        }
        if (isItemArchived(item) && totalEpisodes > 0) {
            return (totalEpisodes * runtimeMinutes) / 60;
        }
        return 0;
    }

    const baseProgress = resolveDashboardProgress(item);
    const progressPercent = isItemArchived(item) && baseProgress <= 0 ? 100 : baseProgress;
    if (mediaType === 'movie') {
        const runtimeMinutes = typeof item.episode_run_time === 'number' && item.episode_run_time > 0
            ? item.episode_run_time
            : 110;
        return (runtimeMinutes * Math.max(0, Math.min(100, progressPercent))) / 100 / 60;
    }

    const estimatedBookHours = 8;
    return (estimatedBookHours * Math.max(0, Math.min(100, progressPercent))) / 100;
}

function computeDashboardMetrics(mediaType: DashboardCardType): DashboardMetrics {
    const allLibraryItems = [...S.myWatchlist, ...S.myArchive];
    const mediaItems = mediaType === 'all'
        ? allLibraryItems
        : allLibraryItems.filter(item => (item.media_type || 'series') === mediaType);
    let inProgress = 0;
    let completed = 0;

    mediaItems.forEach((item) => {
        const archived = isItemArchived(item);
        if (archived) {
            completed += 1;
            return;
        }

        const progress = resolveDashboardProgress(item);
        if (progress >= 100) {
            completed += 1;
            return;
        }
        if (progress > 0) {
            inProgress += 1;
        }
    });

    return {
        total: mediaItems.length,
        inProgress,
        completed,
    };
}

function getLastTwelveMonthTimeline(): { labels: string[]; keys: string[] } {
    const labels: string[] = [];
    const keys: string[] = [];
    const now = new Date();
    for (let offset = 11; offset >= 0; offset -= 1) {
        const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
        const shortMonth = date.toLocaleDateString('pt-PT', { month: 'short' }).replace('.', '');
        const yearShort = date.getFullYear().toString().slice(-2);
        labels.push(`${shortMonth.charAt(0).toUpperCase() + shortMonth.slice(1)} ${yearShort}`);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        keys.push(monthKey);
    }
    return { labels, keys };
}

function renderDashboardEvolutionChart(): void {
    if (!DOM.dashboardEvolutionChart) return;
    const ctx = DOM.dashboardEvolutionChart.getContext('2d');
    if (!ctx) return;

    const { labels, keys } = getLastTwelveMonthTimeline();
    const keyToIndex = new Map<string, number>(keys.map((key, index) => [key, index]));
    const evolutionBuckets: Record<MediaType, number[]> = {
        series: new Array(labels.length).fill(0),
        movie: new Array(labels.length).fill(0),
        book: new Array(labels.length).fill(0),
    };

    const allItems = [...S.myWatchlist, ...S.myArchive];
    allItems.forEach((item) => {
        const mediaType = item.media_type || 'series';
        const consumedHours = getItemConsumedHours(item);
        if (!Number.isFinite(consumedHours) || consumedHours <= 0) return;
        const anchorDateRaw = item._lastUpdated || item.first_air_date || '';
        const anchorDate = new Date(anchorDateRaw);
        if (Number.isNaN(anchorDate.getTime())) return;
        const monthKey = `${anchorDate.getFullYear()}-${String(anchorDate.getMonth() + 1).padStart(2, '0')}`;
        const bucketIndex = keyToIndex.get(monthKey);
        if (typeof bucketIndex !== 'number') return;
        evolutionBuckets[mediaType][bucketIndex] += consumedHours;
    });

    if (S.charts.dashboardEvolution) {
        S.charts.dashboardEvolution.destroy();
    }

    S.charts.dashboardEvolution = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Séries',
                    data: evolutionBuckets.series.map((value) => Number(value.toFixed(1))),
                    borderColor: '#47ABD2',
                    backgroundColor: 'rgba(71, 171, 210, 0.12)',
                    borderWidth: 4,
                    tension: 0.35,
                    fill: true,
                    pointRadius: 3,
                    pointHoverRadius: 5,
                    pointStyle: 'line',
                },
                {
                    label: 'Filmes',
                    data: evolutionBuckets.movie.map((value) => Number(value.toFixed(1))),
                    borderColor: '#F08F44',
                    backgroundColor: 'rgba(240, 143, 68, 0.12)',
                    borderWidth: 4,
                    tension: 0.35,
                    fill: true,
                    pointRadius: 3,
                    pointHoverRadius: 5,
                    pointStyle: 'line',
                },
                {
                    label: 'Livros',
                    data: evolutionBuckets.book.map((value) => Number(value.toFixed(1))),
                    borderColor: '#7DC86E',
                    backgroundColor: 'rgba(125, 200, 110, 0.12)',
                    borderWidth: 4,
                    tension: 0.35,
                    fill: true,
                    pointRadius: 3,
                    pointHoverRadius: 5,
                    pointStyle: 'line',
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        color: getComputedStyle(document.body).getPropertyValue('--text-secondary').trim(),
                        usePointStyle: true,
                        pointStyle: 'line',
                        pointStyleWidth: 46,
                        boxWidth: 52,
                        boxHeight: 10,
                        padding: 16,
                    },
                },
            },
            scales: {
                x: {
                    ticks: {
                        color: getComputedStyle(document.body).getPropertyValue('--text-secondary').trim(),
                        autoSkip: true,
                        maxRotation: 0,
                    },
                    grid: {
                        color: getComputedStyle(document.body).getPropertyValue('--chart-grid-color').trim(),
                    },
                },
                y: {
                    beginAtZero: true,
                    ticks: {
                        color: getComputedStyle(document.body).getPropertyValue('--text-secondary').trim(),
                        callback: (value: string | number) => `${value}h`,
                    },
                    grid: {
                        color: getComputedStyle(document.body).getPropertyValue('--chart-grid-color').trim(),
                    },
                },
            },
        } as any,
    });
}

function renderDashboardGenresChart(): void {
    if (!DOM.dashboardGenresLegend) return;

    const allItems = [...S.myWatchlist, ...S.myArchive];
    const genreCounts: Record<string, number> = {};
    allItems.forEach((item) => {
        (item.genres || []).forEach((genre) => {
            const translated = translateGenreName(genre.name) || genre.name;
            if (!translated) return;
            genreCounts[translated] = (genreCounts[translated] || 0) + 1;
        });
    });

    const sortedGenres = Object.entries(genreCounts).sort(([, a], [, b]) => b - a);
    const topGenres = sortedGenres.slice(0, 5);
    const otherCount = sortedGenres.slice(5).reduce((sum, [, count]) => sum + count, 0);
    if (otherCount > 0) topGenres.push(['Outros', otherCount]);

    const values = topGenres.map(([, count]) => count);
    const hasData = values.length > 0;
    const total = values.reduce((sum, value) => sum + value, 0);
    const palette = ['#47ABD2', '#D24665', '#7DC86E', '#F08F44', '#6DB0FF', '#BED984'];

    if (S.charts.dashboardGenres) {
        S.charts.dashboardGenres.destroy();
        delete S.charts.dashboardGenres;
    }

    DOM.dashboardGenresLegend.innerHTML = '';
    if (!hasData) {
        DOM.dashboardGenresLegend.innerHTML = '<li class="dashboard-legend-empty">Sem dados de género suficientes.</li>';
        return;
    }

    topGenres.forEach(([name, count], index) => {
        const percentage = total > 0 ? Math.round((count / total) * 100) : 0;
        const item = el('li', { class: 'dashboard-legend-item' }, [
            el('div', { class: 'dashboard-legend-head' }, [
                el('span', {
                    class: 'dashboard-legend-color',
                    style: `background-color: ${palette[index % palette.length]}`,
                }),
                el('span', { class: 'dashboard-legend-label', text: name }),
                el('span', { class: 'dashboard-legend-value', text: `${percentage}%` }),
            ]),
            el('div', { class: 'dashboard-legend-track' }, [
                el('span', {
                    class: 'dashboard-legend-fill',
                    style: `width:${percentage}%;background-color:${palette[index % palette.length]}`,
                }),
            ]),
        ]);
        DOM.dashboardGenresLegend.appendChild(item);
    });
}

function formatDashboardNewsDate(value: string | null): string {
    if (!value) return 'Sem data';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return 'Sem data';
    return parsed.toLocaleDateString('pt-PT', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
    }).replace('.', '');
}

function getDashboardNewsBadgeLabel(mediaTypeHint: NewsMediaTypeHint): string {
    if (mediaTypeHint === 'series') return 'SÉRIE';
    if (mediaTypeHint === 'movie') return 'FILME';
    if (mediaTypeHint === 'book') return 'LIVRO';
    return 'MEDIA';
}

function getDashboardNewsBadgeClass(mediaTypeHint: NewsMediaTypeHint): string {
    if (mediaTypeHint === 'series') return 'is-suggestion-series';
    if (mediaTypeHint === 'movie') return 'is-suggestion-movie';
    if (mediaTypeHint === 'book') return 'is-suggestion-book';
    return 'is-pending';
}

function getDashboardPanelFiltersRoot(panel: DashboardPanelKey): HTMLDivElement | null {
    if (panel === 'news') return DOM.dashboardNewsFilters;
    if (panel === 'upcoming') return DOM.dashboardUpcomingFilters;
    if (panel === 'recent') return DOM.dashboardRecentFilters;
    if (panel === 'suggestions') return DOM.dashboardSuggestionsFilters;
    return null;
}

function renderDashboardPanelFilters(panel: DashboardPanelKey): void {
    const root = getDashboardPanelFiltersRoot(panel);
    if (!root) return;
    const activeFilter = dashboardPanelFilters[panel];
    root.querySelectorAll<HTMLButtonElement>('.dashboard-panel-filter').forEach((button) => {
        const filter = (button.dataset.dashboardFilter || 'all') as DashboardContentFilter;
        const isActive = filter === activeFilter;
        button.classList.toggle('is-active', isActive);
        button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
}

function renderAllDashboardPanelFilters(): void {
    renderDashboardPanelFilters('news');
    renderDashboardPanelFilters('upcoming');
    renderDashboardPanelFilters('recent');
    renderDashboardPanelFilters('suggestions');
}

export function setDashboardPanelFilter(panel: DashboardPanelKey, filter: DashboardContentFilter): void {
    dashboardPanelFilters[panel] = filter;
    renderDashboardPanelFilters(panel);
    if (panel === 'news') {
        renderDashboardNewsPanel();
        return;
    }
    if (panel === 'upcoming') {
        renderDashboardUpcomingReleases();
        return;
    }
    if (panel === 'recent') {
        renderDashboardRecentCarousel();
        return;
    }
    renderDashboardSuggestionsCarousel();
}

function buildDashboardNewsKeywordWeights(): Map<string, number> {
    const weights = new Map<string, number>();
    [...S.myWatchlist, ...S.myArchive].forEach((item) => {
        const source = `${item.name || ''} ${item.original_name || ''}`;
        const tokens = normalizeGenreToken(source)
            .split(' ')
            .map((token) => token.trim())
            .filter((token) => token.length >= 4 && !DASHBOARD_NEWS_STOPWORDS.has(token));
        tokens.forEach((token) => {
            weights.set(token, (weights.get(token) || 0) + 1);
        });
    });

    return new Map(
        Array.from(weights.entries())
            .sort(([, a], [, b]) => b - a)
            .slice(0, 12)
    );
}

function buildDashboardMediaTypeWeights(): Record<DashboardContentFilter, number> {
    const weights: Record<DashboardContentFilter, number> = {
        all: 0,
        series: 0,
        movie: 0,
        book: 0,
    };

    [...S.myWatchlist, ...S.myArchive].forEach((item) => {
        const mediaType = item.media_type || 'series';
        if (mediaType === 'series' || mediaType === 'movie' || mediaType === 'book') {
            weights[mediaType] += 1;
        }
    });

    return weights;
}

function computeDashboardNewsRelevance(
    item: DashboardNewsItem,
    topGenres: DashboardTopGenre[],
    keywordWeights: Map<string, number>,
    mediaTypeWeights: Record<DashboardContentFilter, number>
): number {
    const haystack = normalizeGenreToken(`${item.title} ${item.summary} ${item.source}`);
    let score = 0;

    topGenres.forEach((genre, index) => {
        if (!genre.normalized || !haystack.includes(genre.normalized)) return;
        score += ((topGenres.length - index) * 6) + Math.min(genre.count, 5);
    });

    keywordWeights.forEach((weight, token) => {
        if (!haystack.includes(token)) return;
        score += Math.min(weight, 4) + 1;
    });

    if (item.mediaTypeHint === 'series' || item.mediaTypeHint === 'movie' || item.mediaTypeHint === 'book') {
        score += mediaTypeWeights[item.mediaTypeHint] || 0;
    }

    if (item.imageUrl) score += 2;
    return score;
}

function matchesDashboardContentFilter(mediaType: string | null | undefined, filter: DashboardContentFilter): boolean {
    if (filter === 'all') return true;
    return mediaType === filter;
}

function getVisibleDashboardNewsEntries(): DashboardNewsItem[] {
    const filtered = dashboardNewsEntries.filter((item) => {
        return matchesDashboardContentFilter(item.mediaTypeHint, dashboardPanelFilters.news);
    });

    const hasHistory = (S.myWatchlist.length + S.myArchive.length) > 0;
    const topGenres = buildTopDashboardGenres();
    const keywordWeights = buildDashboardNewsKeywordWeights();
    const mediaTypeWeights = buildDashboardMediaTypeWeights();
    const scoreById = new Map<string, number>();
    return [...filtered].sort((a, b) => {
        const aTs = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
        const bTs = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
        if (!DASHBOARD_NEWS_ENHANCED_ENABLED || !hasHistory) {
            return bTs - aTs;
        }

        const scoreA = scoreById.get(a.id) ?? computeDashboardNewsRelevance(a, topGenres, keywordWeights, mediaTypeWeights);
        const scoreB = scoreById.get(b.id) ?? computeDashboardNewsRelevance(b, topGenres, keywordWeights, mediaTypeWeights);
        scoreById.set(a.id, scoreA);
        scoreById.set(b.id, scoreB);
        const scoreDelta = scoreB - scoreA;
        if (scoreDelta !== 0) return scoreDelta;
        return bTs - aTs;
    }).slice(0, 8);
}

function getDashboardNewsImageSrc(item: DashboardNewsItem): string | null {
    const raw = String(item.imageUrl || '').trim();
    if (!raw) return null;
    return buildExternalImageProxyUrl(raw);
}

function createDashboardNewsMedia(item: DashboardNewsItem): HTMLElement {
    const imageSrc = getDashboardNewsImageSrc(item);
    if (imageSrc) {
        return createPosterImage(
            imageSrc,
            `Imagem da notícia ${item.title}`,
            'dashboard-news-image',
            '/placeholders/poster.svg'
        );
    }

    const sourceInitials = item.source
        .split(/\s+/)
        .map((chunk) => chunk.charAt(0))
        .join('')
        .slice(0, 3)
        .toUpperCase();

    return el('div', { class: 'dashboard-news-image dashboard-news-image--placeholder', 'aria-hidden': 'true' }, [
        el('span', { class: 'dashboard-news-placeholder-type', text: getDashboardNewsBadgeLabel(item.mediaTypeHint) }),
        el('strong', { class: 'dashboard-news-placeholder-source', text: sourceInitials || 'RSS' }),
    ]);
}

function buildDashboardNewsMetaText(item: DashboardNewsItem): string {
    const source = sanitizePlainText(item.source) || 'Fonte';
    const date = formatDashboardNewsDate(item.publishedAt);
    return `${source} • ${date}`;
}

function renderDashboardNewsPanel(): void {
    if (!DOM.dashboardNewsList) return;
    renderDashboardPanelFilters('news');

    if (dashboardNewsState === 'loading' && dashboardNewsEntries.length === 0) {
        DOM.dashboardNewsList.innerHTML = `
            <div class="dashboard-news-state dashboard-news-state--loading">
                <p>A carregar notícias recentes...</p>
            </div>
        `;
        return;
    }

    if (dashboardNewsState === 'error' && dashboardNewsEntries.length === 0) {
        DOM.dashboardNewsList.innerHTML = `
            <div class="dashboard-news-state dashboard-news-state--error">
                <p>Não foi possível carregar notícias neste momento.</p>
                <button type="button" class="btn btn-secondary dashboard-news-retry-btn" id="dashboard-news-retry-btn">Tentar novamente</button>
            </div>
        `;
        const retryBtn = document.getElementById('dashboard-news-retry-btn') as HTMLButtonElement | null;
        retryBtn?.addEventListener('click', () => {
            dashboardNewsCacheExpiresAt = 0;
            dashboardNewsState = 'idle';
            renderDashboardNewsPanel();
            void ensureDashboardNews();
        }, { once: true });
        return;
    }

    const visibleItems = getVisibleDashboardNewsEntries();
    if (visibleItems.length === 0) {
        DOM.dashboardNewsList.innerHTML = `
            <div class="dashboard-news-state">
                <p>${dashboardNewsEntries.length === 0 ? 'Ainda não existem notícias disponíveis.' : 'Sem notícias para este filtro.'}</p>
            </div>
        `;
        return;
    }

    DOM.dashboardNewsList.innerHTML = '';
    visibleItems.forEach((item) => {
        const badgeClass = getDashboardNewsBadgeClass(item.mediaTypeHint);
        const article = el('a', {
            class: 'dashboard-recent-item dashboard-news-item',
            href: item.url,
            target: '_blank',
            rel: 'noopener noreferrer',
            role: 'listitem',
            title: `${item.title} • ${item.source}`,
            'aria-label': `Abrir notícia: ${item.title}`,
        }, [
            createDashboardNewsMedia(item),
            el('div', { class: 'dashboard-recent-content dashboard-news-content' }, [
                el('p', { class: 'dashboard-news-meta-line', text: buildDashboardNewsMetaText(item) }),
                el('h4', { text: item.title }),
                el('span', { class: `dashboard-status-badge dashboard-news-badge ${badgeClass}`, text: getDashboardNewsBadgeLabel(item.mediaTypeHint) }),
                el('p', { class: 'dashboard-news-summary', text: sanitizePlainText(item.summary) || 'Sem resumo disponível.' }),
            ]),
        ]);
        DOM.dashboardNewsList.appendChild(article);
    });
}

async function ensureDashboardNews(force = false): Promise<void> {
    const now = Date.now();
    if (!force && dashboardNewsEntries.length > 0 && now < dashboardNewsCacheExpiresAt) {
        dashboardNewsState = 'ready';
        return;
    }
    if (dashboardNewsInFlight) return;

    const requestVersion = ++dashboardNewsRequestVersion;
    dashboardNewsState = dashboardNewsEntries.length > 0 && !force ? 'ready' : 'loading';
    renderDashboardNewsPanel();

    dashboardNewsInFlight = (async () => {
        const items = await API.fetchDashboardNews(DASHBOARD_NEWS_LIMIT, 'all');
        if (requestVersion !== dashboardNewsRequestVersion) return;
        dashboardNewsEntries = items;
        dashboardNewsState = 'ready';
        dashboardNewsCacheExpiresAt = Date.now() + DASHBOARD_NEWS_CACHE_TTL_MS;
        renderDashboardNewsPanel();
    })()
        .catch((error) => {
            console.warn('[dashboard] Falha ao carregar notícias RSS.', error);
            if (requestVersion !== dashboardNewsRequestVersion) return;
            dashboardNewsState = dashboardNewsEntries.length > 0 ? 'ready' : 'error';
            renderDashboardNewsPanel();
        })
        .finally(() => {
            if (requestVersion === dashboardNewsRequestVersion) {
                dashboardNewsInFlight = null;
            }
        });
}

function renderDashboardRecentCarousel(): void {
    if (!DOM.dashboardRecentCarousel) return;

    const archiveRecent = [...S.myArchive].reverse();
    const inProgress = [...S.myWatchlist]
        .filter((item) => resolveDashboardProgress(item) > 0)
        .sort((a, b) => resolveDashboardProgress(b) - resolveDashboardProgress(a));

    const merged = [...archiveRecent, ...inProgress];
    const uniqueRecent: DashboardRecentEntry[] = [];
    const seen = new Set<string>();

    merged.forEach((item) => {
        const mediaType = item.media_type || 'series';
        const key = `${mediaType}:${item.id}`;
        if (seen.has(key)) return;
        seen.add(key);

        const progress = resolveDashboardProgress(item);
        uniqueRecent.push({
            item,
            progress,
            statusLabel: getItemStatusLabel(item, progress),
            statusClass: getItemStatusClass(item, progress),
        });
    });

    const filter = dashboardPanelFilters.recent;
    const visibleItems = uniqueRecent
        .filter(({ item }) => matchesDashboardContentFilter(item.media_type || 'series', filter))
        .slice(0, 12);
    DOM.dashboardRecentCarousel.innerHTML = '';

    renderDashboardPanelFilters('recent');

    if (visibleItems.length === 0) {
        DOM.dashboardRecentCarousel.innerHTML = `<p class="dashboard-empty-message">${
            uniqueRecent.length === 0
                ? 'Ainda não existem conteúdos vistos/lidos recentemente.'
                : 'Sem conteúdos recentes para este filtro.'
        }</p>`;
        return;
    }

    visibleItems.forEach(({ item, statusLabel, statusClass }) => {
        const mediaType = item.media_type || 'series';
        const posterPath = buildPosterUrl(item.poster_path, 'w185', '/placeholders/poster.svg');
        const releaseYear = item.first_air_date && !Number.isNaN(new Date(item.first_air_date).getTime())
            ? ` (${new Date(item.first_air_date).getFullYear()})`
            : '';
        const card = el('article', {
            class: 'dashboard-recent-item',
            'data-series-id': String(item.id),
            'data-media-type': mediaType,
            role: 'listitem',
            tabindex: '0',
            'aria-label': `Abrir detalhe de ${item.name}`,
            title: `Abrir detalhe de ${item.name}`,
        }, [
            createPosterImage(posterPath, `Poster de ${item.name}`, 'dashboard-recent-poster', '/placeholders/poster.svg'),
            el('div', { class: 'dashboard-recent-content' }, [
                el('h4', { text: `${item.name}${releaseYear}` }),
                el('span', { class: `dashboard-status-badge ${statusClass}`, text: statusLabel }),
            ]),
        ]);
        DOM.dashboardRecentCarousel.appendChild(card);
    });
}

function renderDashboardSuggestionsCarousel(): void {
    if (!DOM.dashboardSuggestionsCarousel) return;

    const topGenres = buildTopDashboardGenres();
    void ensureDashboardRecommendations(topGenres);

    const filter = dashboardPanelFilters.suggestions;
    const visibleItems = dashboardSuggestedRecommendationEntries
        .filter(({ item }) => matchesDashboardContentFilter(item.media_type || 'series', filter))
        .slice(0, DASHBOARD_SUGGESTED_MAX_TOTAL);
    DOM.dashboardSuggestionsCarousel.innerHTML = '';

    renderDashboardPanelFilters('suggestions');

    if (visibleItems.length === 0) {
        DOM.dashboardSuggestionsCarousel.innerHTML = dashboardSuggestedInFlight
            ? '<p class="dashboard-empty-message">A preparar sugestões para ti...</p>'
            : `<p class="dashboard-empty-message">${
                dashboardSuggestedRecommendationEntries.length === 0
                    ? 'Adiciona mais conteúdos para gerar sugestões personalizadas.'
                    : 'Sem sugestões para este filtro.'
            }</p>`;
        return;
    }

    visibleItems.forEach(({ item, reason }) => {
        const mediaType = item.media_type || 'series';
        const posterPath = buildPosterUrl(item.poster_path, 'w185', '/placeholders/poster.svg');
        const releaseYear = item.first_air_date && !Number.isNaN(new Date(item.first_air_date).getTime())
            ? ` (${new Date(item.first_air_date).getFullYear()})`
            : '';
        const badgeLabel = mediaType === 'book' ? 'LIVRO' : mediaType === 'movie' ? 'FILME' : 'SÉRIE';
        const badgeClass = mediaType === 'book'
            ? 'is-suggestion-book'
            : mediaType === 'movie'
                ? 'is-suggestion-movie'
                : 'is-suggestion-series';

        const card = el('article', {
            class: 'dashboard-recent-item dashboard-recent-item--suggested',
            'data-series-id': String(item.id),
            'data-media-type': mediaType,
            role: 'listitem',
            tabindex: '0',
            'aria-label': `Abrir sugestão de ${item.name}`,
            title: `${item.name} • ${reason}`,
        }, [
            createPosterImage(posterPath, `Poster de ${item.name}`, 'dashboard-recent-poster', '/placeholders/poster.svg'),
            el('div', { class: 'dashboard-recent-content' }, [
                el('h4', { text: `${item.name}${releaseYear}` }),
                el('span', { class: `dashboard-status-badge ${badgeClass}`, text: badgeLabel }),
            ]),
        ]);
        DOM.dashboardSuggestionsCarousel.appendChild(card);
    });
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

function formatDashboardUpcomingDate(date: Date): string {
    const day = date.toLocaleDateString('pt-PT', { day: '2-digit' });
    const month = date.toLocaleDateString('pt-PT', { month: 'short' }).replace('.', '').toUpperCase();
    return `${day} ${month}`;
}

function toLocalDateKey(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function normalizeGenreToken(value: string): string {
    return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function resolveMovieGenreId(normalizedGenre: string): number | null {
    if (!normalizedGenre) return null;
    const direct = MOVIE_GENRE_ID_BY_KEY[normalizedGenre];
    if (typeof direct === 'number') return direct;
    const matchedKey = Object.keys(MOVIE_GENRE_ID_BY_KEY).find((key) =>
        normalizedGenre.includes(key) || key.includes(normalizedGenre)
    );
    if (!matchedKey) return null;
    const value = MOVIE_GENRE_ID_BY_KEY[matchedKey];
    return typeof value === 'number' ? value : null;
}

function buildTopDashboardGenres(): DashboardTopGenre[] {
    const counts = new Map<string, { label: string; count: number }>();
    [...S.myWatchlist, ...S.myArchive].forEach((item) => {
        (item.genres || []).forEach((genre) => {
            const rawLabel = translateGenreName(genre?.name) || genre?.name || '';
            const label = String(rawLabel).trim();
            const normalized = normalizeGenreToken(label);
            if (!normalized) return;
            const current = counts.get(normalized);
            if (current) {
                current.count += 1;
                return;
            }
            counts.set(normalized, { label, count: 1 });
        });
    });

    return Array.from(counts.entries())
        .sort(([, a], [, b]) => b.count - a.count)
        .slice(0, DASHBOARD_TOP_GENRES_LIMIT)
        .map(([normalized, data]) => ({
            label: data.label,
            normalized,
            count: data.count,
            movieGenreId: resolveMovieGenreId(normalized),
            bookQuery: data.label,
        }));
}

function getDashboardMediaKey(item: Series): string {
    const mediaType = item.media_type || 'series';
    return `${mediaType}:${item.id}`;
}

function dedupeSeriesByMedia(items: Series[]): Series[] {
    const deduped = new Map<string, Series>();
    items.forEach((item) => {
        const key = getDashboardMediaKey(item);
        if (!deduped.has(key)) {
            deduped.set(key, item);
        }
    });
    return Array.from(deduped.values());
}

function pickSuggestionItems(
    candidates: Series[],
    expectedMediaType: MediaType,
    libraryKeys: Set<string>,
    usedKeys: Set<string>,
    limit: number
): Series[] {
    const picked: Series[] = [];
    candidates.forEach((candidate) => {
        if (picked.length >= limit) return;
        const mediaType = candidate.media_type || 'series';
        if (mediaType !== expectedMediaType) return;
        const hasPoster = typeof candidate.poster_path === 'string' && candidate.poster_path.trim().length > 0;
        if (!hasPoster) return;
        const key = getDashboardMediaKey(candidate);
        if (libraryKeys.has(key) || usedKeys.has(key)) return;
        if (!candidate.id || !candidate.name) return;
        usedKeys.add(key);
        picked.push(candidate);
    });
    return picked;
}

function buildDashboardSuggestedMediaPayload(): Series[] {
    const allItems = [
        ...dashboardSuggestedUpcomingEntries.map((entry) => entry.item),
        ...dashboardSuggestedRecommendationEntries.map((entry) => entry.item),
    ];
    return dedupeSeriesByMedia(allItems);
}

function syncDashboardSuggestedMediaStore(): void {
    S.setDashboardSuggestedMedia(buildDashboardSuggestedMediaPayload());
}

async function fetchSuggestedSeriesEntries(
    topGenres: DashboardTopGenre[],
    libraryKeys: Set<string>,
    preferHistory: boolean
): Promise<DashboardSuggestionEntry[]> {
    const candidates: Series[] = [];
    if (preferHistory) {
        const queries = topGenres.map((genre) => genre.label.trim()).filter((label) => label.length >= 2).slice(0, 2);
        const searchResults = await Promise.allSettled(
            queries.map((query) => API.searchSeries(query, new AbortController().signal))
        );
        searchResults.forEach((result) => {
            if (result.status !== 'fulfilled') return;
            candidates.push(...result.value.results);
        });
    }

    if (candidates.length < DASHBOARD_SUGGESTED_MAX_PER_MEDIA) {
        try {
            const trending = await API.fetchTrending('week', new AbortController().signal, 'series');
            candidates.push(...trending.results);
        } catch (error) {
            console.warn('[dashboard] Falha ao carregar sugestões de séries em tendência.', error);
        }
    }

    if (candidates.length < DASHBOARD_SUGGESTED_MAX_PER_MEDIA) {
        try {
            const topRated = await API.fetchPopularSeries(1, 'series');
            candidates.push(...topRated.results);
        } catch (error) {
            console.warn('[dashboard] Falha ao carregar sugestões de séries top rated.', error);
        }
    }

    const dedupedCandidates = dedupeSeriesByMedia(candidates);
    const usedKeys = new Set<string>();
    const picked = pickSuggestionItems(dedupedCandidates, 'series', libraryKeys, usedKeys, DASHBOARD_SUGGESTED_MAX_PER_MEDIA);
    const reason = preferHistory && topGenres[0]?.label
        ? `Baseado em ${topGenres[0].label}`
        : 'Baseado nas tendências';
    return picked.map((item) => ({ item, reason }));
}

async function fetchSuggestedMovieEntries(
    topGenres: DashboardTopGenre[],
    libraryKeys: Set<string>,
    preferHistory: boolean
): Promise<DashboardSuggestionEntry[]> {
    const candidates: Series[] = [];
    if (preferHistory) {
        const queries = topGenres.map((genre) => genre.label.trim()).filter((label) => label.length >= 2).slice(0, 2);
        const searchResults = await Promise.allSettled(
            queries.map((query) => API.searchMovies(query, new AbortController().signal))
        );
        searchResults.forEach((result) => {
            if (result.status !== 'fulfilled') return;
            candidates.push(...result.value.results);
        });
    }

    if (candidates.length < DASHBOARD_SUGGESTED_MAX_PER_MEDIA) {
        try {
            const trending = await API.fetchTrending('week', new AbortController().signal, 'movie');
            candidates.push(...trending.results);
        } catch (error) {
            console.warn('[dashboard] Falha ao carregar sugestões de filmes em tendência.', error);
        }
    }

    if (candidates.length < DASHBOARD_SUGGESTED_MAX_PER_MEDIA) {
        try {
            const topRated = await API.fetchPopularSeries(1, 'movie');
            candidates.push(...topRated.results);
        } catch (error) {
            console.warn('[dashboard] Falha ao carregar sugestões de filmes top rated.', error);
        }
    }

    const dedupedCandidates = dedupeSeriesByMedia(candidates);
    const usedKeys = new Set<string>();
    const picked = pickSuggestionItems(dedupedCandidates, 'movie', libraryKeys, usedKeys, DASHBOARD_SUGGESTED_MAX_PER_MEDIA);
    const reason = preferHistory && topGenres[0]?.label
        ? `Baseado em ${topGenres[0].label}`
        : 'Baseado nas tendências';
    return picked.map((item) => ({ item, reason }));
}

async function fetchSuggestedBookEntries(
    topGenres: DashboardTopGenre[],
    libraryKeys: Set<string>,
    preferHistory: boolean
): Promise<DashboardSuggestionEntry[]> {
    const candidates: Series[] = [];
    const preferredQueries = topGenres
        .map((genre) => genre.bookQuery.trim())
        .filter((query) => query.length >= 2)
        .slice(0, 3)
        .map((query) => `subject:${query}`);
    const fallbackQueries = ['subject:fiction', 'subject:drama'];
    const queries = preferHistory && preferredQueries.length > 0 ? preferredQueries : fallbackQueries;

    const searchResults = await Promise.allSettled(
        queries.map((query) => API.searchBooks(query, new AbortController().signal))
    );
    searchResults.forEach((result) => {
        if (result.status !== 'fulfilled') return;
        candidates.push(...result.value.results);
    });

    if (candidates.length < DASHBOARD_SUGGESTED_MAX_PER_MEDIA) {
        try {
            const bestsellers = await API.searchBooks('bestsellers', new AbortController().signal);
            candidates.push(...bestsellers.results);
        } catch (error) {
            console.warn('[dashboard] Falha ao carregar sugestões de livros populares.', error);
        }
    }

    const dedupedCandidates = dedupeSeriesByMedia(candidates);
    const usedKeys = new Set<string>();
    const picked = pickSuggestionItems(dedupedCandidates, 'book', libraryKeys, usedKeys, DASHBOARD_SUGGESTED_MAX_PER_MEDIA);
    const reason = preferHistory && topGenres[0]?.label
        ? `Baseado em ${topGenres[0].label}`
        : 'Baseado em preferências gerais';
    return picked.map((item) => ({ item, reason }));
}

function interleaveSuggestionEntries(
    seriesEntries: DashboardSuggestionEntry[],
    movieEntries: DashboardSuggestionEntry[],
    bookEntries: DashboardSuggestionEntry[]
): DashboardSuggestionEntry[] {
    const pools = [seriesEntries, movieEntries, bookEntries];
    const indexes = [0, 0, 0];
    const picked: DashboardSuggestionEntry[] = [];
    const seenKeys = new Set<string>();

    while (picked.length < DASHBOARD_SUGGESTED_MAX_TOTAL) {
        let addedInRound = false;
        for (let poolIndex = 0; poolIndex < pools.length; poolIndex += 1) {
            const pool = pools[poolIndex];
            const idx = indexes[poolIndex];
            if (idx >= pool.length) continue;
            indexes[poolIndex] += 1;
            const candidate = pool[idx];
            const key = getDashboardMediaKey(candidate.item);
            if (seenKeys.has(key)) continue;
            seenKeys.add(key);
            picked.push(candidate);
            addedInRound = true;
            if (picked.length >= DASHBOARD_SUGGESTED_MAX_TOTAL) break;
        }
        if (!addedInRound) break;
    }

    return picked;
}

async function ensureDashboardRecommendations(topGenres: DashboardTopGenre[]): Promise<void> {
    const libraryCount = S.myWatchlist.length + S.myArchive.length;
    const signature = [
        `watchlist:${S.myWatchlist.length}`,
        `archive:${S.myArchive.length}`,
        ...topGenres.map((genre) => `${genre.normalized}:${genre.count}`),
    ].join('|');

    const now = Date.now();
    if (
        signature === dashboardSuggestedCacheSignature
        && now < dashboardSuggestedCacheExpiresAt
    ) {
        return;
    }
    if (dashboardSuggestedInFlight) return;

    const requestVersion = ++dashboardSuggestedRequestVersion;
    const libraryKeys = new Set(
        [...S.myWatchlist, ...S.myArchive].map((item) => getDashboardMediaKey(item))
    );
    const preferHistory = libraryCount >= DASHBOARD_SUGGESTED_HISTORY_MIN_ITEMS && topGenres.length > 0;

    dashboardSuggestedInFlight = (async () => {
        const [seriesEntries, movieEntries, bookEntries] = await Promise.all([
            fetchSuggestedSeriesEntries(topGenres, libraryKeys, preferHistory).catch(() => []),
            fetchSuggestedMovieEntries(topGenres, libraryKeys, preferHistory).catch(() => []),
            fetchSuggestedBookEntries(topGenres, libraryKeys, preferHistory).catch(() => []),
        ]);

        if (requestVersion !== dashboardSuggestedRequestVersion) return;
        dashboardSuggestedRecommendationEntries = interleaveSuggestionEntries(seriesEntries, movieEntries, bookEntries);
        dashboardSuggestedCacheSignature = signature;
        dashboardSuggestedCacheExpiresAt = Date.now() + DASHBOARD_SUGGESTED_CACHE_TTL_MS;
        syncDashboardSuggestedMediaStore();
        renderDashboardSuggestionsCarousel();
    })()
        .catch((error) => {
            console.warn('[dashboard] Falha ao gerar sugestões para ti.', error);
        })
        .finally(() => {
            if (requestVersion === dashboardSuggestedRequestVersion) {
                dashboardSuggestedInFlight = null;
            }
        });
}

function dedupeUpcomingEntries(entries: DashboardUpcomingEntry[]): DashboardUpcomingEntry[] {
    const deduped = new Map<string, DashboardUpcomingEntry>();
    entries.forEach((entry) => {
        const mediaType = entry.item.media_type || 'series';
        const key = `${mediaType}:${entry.item.id}:${toLocalDateKey(entry.date)}`;
        const existing = deduped.get(key);
        if (!existing) {
            deduped.set(key, entry);
            return;
        }
        if (existing.source !== 'library' && entry.source === 'library') {
            deduped.set(key, entry);
        }
    });
    return Array.from(deduped.values());
}

function sortUpcomingEntriesForSuggestion(entries: DashboardUpcomingEntry[]): DashboardUpcomingEntry[] {
    return [...entries].sort((a, b) => {
        const aRating = typeof a.item.vote_average === 'number' ? a.item.vote_average : 0;
        const bRating = typeof b.item.vote_average === 'number' ? b.item.vote_average : 0;
        if (bRating !== aRating) return bRating - aRating;
        return a.date.getTime() - b.date.getTime();
    });
}

function selectDashboardUpcomingEntries(
    entries: DashboardUpcomingEntry[],
    limit: number,
    filter: DashboardContentFilter
): DashboardUpcomingEntry[] {
    if (entries.length <= limit) return entries;

    const libraryEntries = entries
        .filter((entry) => entry.source === 'library')
        .sort((a, b) => a.date.getTime() - b.date.getTime());
    const suggestedSeriesEntries = sortUpcomingEntriesForSuggestion(
        entries.filter((entry) => entry.source === 'suggested-series')
    );
    const suggestedMovieEntries = sortUpcomingEntriesForSuggestion(
        entries.filter((entry) => entry.source === 'suggested-movie')
    );
    const suggestedBookEntries = sortUpcomingEntriesForSuggestion(
        entries.filter((entry) => entry.source === 'suggested-book')
    );

    if (filter === 'series') {
        return [...libraryEntries, ...suggestedSeriesEntries].slice(0, limit);
    }
    if (filter === 'movie') {
        return [...libraryEntries, ...suggestedMovieEntries].slice(0, limit);
    }
    if (filter === 'book') {
        return [...libraryEntries, ...suggestedBookEntries].slice(0, limit);
    }

    const selected = [
        ...libraryEntries.slice(0, DASHBOARD_UPCOMING_LIBRARY_LIMIT),
        ...suggestedSeriesEntries.slice(0, DASHBOARD_UPCOMING_SERIES_SUGGESTED_LIMIT),
        ...suggestedMovieEntries.slice(0, DASHBOARD_UPCOMING_MOVIE_SUGGESTED_LIMIT),
    ];

    if (selected.length < limit) {
        selected.push(...suggestedBookEntries.slice(0, Math.min(DASHBOARD_UPCOMING_BOOK_SUGGESTED_LIMIT, limit - selected.length)));
    }

    return selected.slice(0, limit);
}

function getLibraryUpcomingEntries(today: Date): DashboardUpcomingEntry[] {
    const entries: DashboardUpcomingEntry[] = [];
    [...S.myWatchlist, ...S.myArchive].forEach((item) => {
        const mediaType = item.media_type || 'series';
        const firstDate = parseDateOnly(item.first_air_date);
        if (firstDate && firstDate >= today) {
            entries.push({
                item,
                date: firstDate,
                label: mediaType === 'book' ? 'Lançamento' : 'Estreia',
                source: 'library',
            });
        }

        if (mediaType === 'series') {
            const nextEpisodeDate = parseDateOnly(item._details?.next_episode_to_air?.air_date || null);
            if (nextEpisodeDate && nextEpisodeDate >= today) {
                entries.push({
                    item,
                    date: nextEpisodeDate,
                    label: 'Novo episódio',
                    source: 'library',
                });
            }
        }
    });
    return entries;
}

async function fetchSuggestedSeriesUpcomingEntries(
    today: Date,
    libraryKeys: Set<string>
): Promise<DashboardUpcomingEntry[]> {
    const todayIso = today.toISOString().slice(0, 10);
    const deduped = new Map<string, DashboardUpcomingEntry>();
    const responses = await Promise.allSettled([
        API.fetchNewPremieres(1, null, 'series', {
            fromDate: todayIso,
            sortBy: 'first_air_date.asc',
            withOriginalLanguage: false,
        }),
    ]);

    responses.forEach((result) => {
        if (result.status !== 'fulfilled') return;
        result.value.results.forEach((series) => {
            const date = parseDateOnly(series.first_air_date);
            if (!date || date < today) return;
            const mediaType = series.media_type || 'series';
            if (mediaType !== 'series') return;
            const hasPoster = typeof series.poster_path === 'string' && series.poster_path.trim().length > 0;
            const hasOverview = typeof series.overview === 'string' && series.overview.trim().length > 0;
            if (!hasPoster || !hasOverview) return;
            const mediaKey = `${mediaType}:${series.id}`;
            if (libraryKeys.has(mediaKey)) return;
            const candidate: DashboardUpcomingEntry = {
                item: series,
                date,
                label: 'Estreia sugerida',
                source: 'suggested-series',
            };
            const existing = deduped.get(mediaKey);
            if (!existing || date < existing.date) {
                deduped.set(mediaKey, candidate);
            }
        });
    });

    return Array.from(deduped.values())
        .sort((a, b) => a.date.getTime() - b.date.getTime())
        .slice(0, DASHBOARD_UPCOMING_MAX_SERIES_SUGGESTIONS);
}

async function fetchSuggestedMovieUpcomingEntries(
    today: Date,
    libraryKeys: Set<string>
): Promise<DashboardUpcomingEntry[]> {
    const todayIso = today.toISOString().slice(0, 10);
    const responses = await Promise.allSettled([
        API.fetchNewPremieres(1, null, 'movie', {
            fromDate: todayIso,
            sortBy: 'primary_release_date.asc',
            withOriginalLanguage: false,
        }),
    ]);

    const deduped = new Map<string, DashboardUpcomingEntry>();
    responses.forEach((result) => {
        if (result.status !== 'fulfilled') return;
        result.value.results.forEach((movie) => {
            const date = parseDateOnly(movie.first_air_date);
            if (!date || date < today) return;
            const mediaType = movie.media_type || 'movie';
            if (mediaType !== 'movie') return;
            const hasPoster = typeof movie.poster_path === 'string' && movie.poster_path.trim().length > 0;
            const hasOverview = typeof movie.overview === 'string' && movie.overview.trim().length > 0;
            if (!hasPoster || !hasOverview) return;
            const mediaKey = `${mediaType}:${movie.id}`;
            if (libraryKeys.has(mediaKey)) return;
            const candidate: DashboardUpcomingEntry = {
                item: movie,
                date,
                label: 'Estreia sugerida',
                source: 'suggested-movie',
            };
            const existing = deduped.get(mediaKey);
            if (!existing || date < existing.date) {
                deduped.set(mediaKey, candidate);
            }
        });
    });

    return Array.from(deduped.values())
        .sort((a, b) => a.date.getTime() - b.date.getTime())
        .slice(0, DASHBOARD_UPCOMING_MAX_MOVIE_SUGGESTIONS);
}

async function fetchSuggestedBookUpcomingEntries(
    topGenres: DashboardTopGenre[],
    today: Date,
    libraryKeys: Set<string>
): Promise<DashboardUpcomingEntry[]> {
    const queries = Array.from(
        new Set(
            topGenres
                .map((genre) => genre.bookQuery.trim())
                .filter((query) => query.length >= 2)
        )
    );
    if (queries.length === 0) return [];

    const responses = await Promise.allSettled(
        queries.map((query) => API.searchBooks(`subject:${query}`, new AbortController().signal))
    );
    const recentLimit = new Date(today);
    recentLimit.setDate(recentLimit.getDate() - DASHBOARD_UPCOMING_RECENT_BOOK_DAYS);

    const deduped = new Map<string, DashboardUpcomingEntry>();
    responses.forEach((result) => {
        if (result.status !== 'fulfilled') return;
        result.value.results.forEach((book) => {
            const mediaType = book.media_type || 'book';
            if (mediaType !== 'book') return;
            const date = parseDateOnly(book.first_air_date);
            if (!date) return;
            const isFuture = date >= today;
            if (!isFuture && date < recentLimit) return;
            const mediaKey = `${mediaType}:${book.id}`;
            if (libraryKeys.has(mediaKey)) return;

            const candidate: DashboardUpcomingEntry = {
                item: book,
                date,
                label: isFuture ? 'Lançamento sugerido' : 'Novidade do género',
                source: 'suggested-book',
            };
            const existing = deduped.get(mediaKey);
            if (!existing) {
                deduped.set(mediaKey, candidate);
                return;
            }
            const existingIsFuture = existing.date >= today;
            if (!existingIsFuture && isFuture) {
                deduped.set(mediaKey, candidate);
                return;
            }
            if (isFuture && candidate.date < existing.date) {
                deduped.set(mediaKey, candidate);
                return;
            }
            if (!isFuture && !existingIsFuture && candidate.date > existing.date) {
                deduped.set(mediaKey, candidate);
            }
        });
    });

    return Array.from(deduped.values())
        .sort((a, b) => {
            const aFuture = a.date >= today;
            const bFuture = b.date >= today;
            if (aFuture !== bFuture) return aFuture ? -1 : 1;
            if (aFuture && bFuture) return a.date.getTime() - b.date.getTime();
            return b.date.getTime() - a.date.getTime();
        })
        .slice(0, DASHBOARD_UPCOMING_MAX_BOOK_SUGGESTIONS);
}

async function ensureDashboardUpcomingSuggestions(topGenres: DashboardTopGenre[], today: Date): Promise<void> {
    const signature = topGenres.map((genre) => `${genre.normalized}:${genre.count}`).join('|');
    const now = Date.now();
    if (
        signature === dashboardUpcomingCacheSignature
        && now < dashboardUpcomingCacheExpiresAt
    ) {
        return;
    }
    if (dashboardUpcomingInFlight) return;

    const requestVersion = ++dashboardUpcomingRequestVersion;
    const libraryKeys = new Set(
        [...S.myWatchlist, ...S.myArchive].map((item) => `${item.media_type || 'series'}:${item.id}`)
    );

    dashboardUpcomingInFlight = (async () => {
        const [seriesSuggestions, movieSuggestions, bookSuggestions] = await Promise.all([
            fetchSuggestedSeriesUpcomingEntries(today, libraryKeys).catch(() => []),
            fetchSuggestedMovieUpcomingEntries(today, libraryKeys).catch(() => []),
            topGenres.length > 0
                ? fetchSuggestedBookUpcomingEntries(topGenres, today, libraryKeys).catch(() => [])
                : Promise.resolve([]),
        ]);
        if (requestVersion !== dashboardUpcomingRequestVersion) return;
        dashboardSuggestedUpcomingEntries = [...seriesSuggestions, ...movieSuggestions, ...bookSuggestions];
        syncDashboardSuggestedMediaStore();
        dashboardUpcomingCacheSignature = signature;
        dashboardUpcomingCacheExpiresAt = Date.now() + DASHBOARD_UPCOMING_CACHE_TTL_MS;
        renderDashboardUpcomingReleases();
    })()
        .catch((error) => {
            console.warn('[dashboard] Falha ao carregar sugestões de lançamentos por género.', error);
        })
        .finally(() => {
            if (requestVersion === dashboardUpcomingRequestVersion) {
                dashboardUpcomingInFlight = null;
            }
        });
}

function renderDashboardUpcomingReleases(): void {
    if (!DOM.dashboardUpcomingList) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const libraryEntries = getLibraryUpcomingEntries(today);
    const sortedEntries = dedupeUpcomingEntries([...libraryEntries, ...dashboardSuggestedUpcomingEntries])
        .sort((a, b) => a.date.getTime() - b.date.getTime());
    const topGenres = buildTopDashboardGenres();
    void ensureDashboardUpcomingSuggestions(topGenres, today);

    const filter = dashboardPanelFilters.upcoming;
    const filteredEntries = sortedEntries
        .filter(({ item }) => matchesDashboardContentFilter(item.media_type || 'series', filter));
    const visibleEntries = selectDashboardUpcomingEntries(filteredEntries, DASHBOARD_UPCOMING_VISIBLE_LIMIT, filter);

    DOM.dashboardUpcomingList.innerHTML = '';
    renderDashboardPanelFilters('upcoming');

    if (visibleEntries.length === 0) {
        DOM.dashboardUpcomingList.innerHTML = `<p class="dashboard-empty-message">${
            sortedEntries.length === 0
                ? 'Sem lançamentos futuros registados para já.'
                : 'Sem lançamentos para este filtro.'
        }</p>`;
        return;
    }

    visibleEntries.forEach(({ item, date, label }) => {
        const mediaType = item.media_type || 'series';
        const posterPath = buildPosterUrl(item.poster_path, 'w185', '/placeholders/poster.svg');
        const badgeClass = mediaType === 'movie'
            ? 'is-suggestion-movie'
            : mediaType === 'book'
                ? 'is-suggestion-book'
                : 'is-suggestion-series';
        const entryElement = el('article', {
            class: 'dashboard-recent-item dashboard-upcoming-item',
            'data-series-id': String(item.id),
            'data-media-type': mediaType,
            role: 'listitem',
            tabindex: '0',
            'aria-label': `Abrir detalhe de ${item.name}`,
            title: `Abrir detalhe de ${item.name}`,
        }, [
            createPosterImage(posterPath, `Poster de ${item.name}`, 'dashboard-upcoming-poster', '/placeholders/poster.svg'),
            el('div', { class: 'dashboard-recent-content dashboard-upcoming-content' }, [
                el('p', { class: 'dashboard-upcoming-date', text: formatDashboardUpcomingDate(date) }),
                el('h4', { class: 'dashboard-upcoming-title', text: item.name }),
                el('span', { class: `dashboard-status-badge ${badgeClass}`, text: getMediaTypeLabel(mediaType).toUpperCase() }),
                el('p', { class: 'dashboard-upcoming-label', text: label }),
            ]),
        ]);
        DOM.dashboardUpcomingList.appendChild(entryElement);
    });
}

export function renderMediaDashboard() {
    if (!DOM.dashboardMediaCards || DOM.dashboardMediaCards.length === 0) return;
    DOM.dashboardMediaCards.forEach((card) => {
        const rawType = card.dataset.mediaType || 'series';
        const mediaType: DashboardCardType = rawType === 'movie' || rawType === 'book' || rawType === 'all'
            ? rawType
            : 'series';
        const metrics = computeDashboardMetrics(mediaType);
        const total = card.querySelector<HTMLElement>('[data-metric="total"]');
        const inProgress = card.querySelector<HTMLElement>('[data-metric="in-progress"]');
        const completed = card.querySelector<HTMLElement>('[data-metric="completed"]');
        if (total) total.textContent = String(metrics.total);
        if (inProgress) inProgress.textContent = String(metrics.inProgress);
        if (completed) completed.textContent = String(metrics.completed);

        const metricRows = card.querySelectorAll<HTMLElement>('.dashboard-media-card-metrics > div');
        metricRows.forEach((row) => {
            const metricValue = row.querySelector<HTMLElement>('dd[data-metric]');
            const metricKey = metricValue?.dataset.metric;
            let percentage = 0;
            if (metricKey === 'total') {
                percentage = metrics.total > 0 ? 100 : 0;
            } else if (metricKey === 'in-progress') {
                percentage = metrics.total > 0 ? (metrics.inProgress / metrics.total) * 100 : 0;
            } else if (metricKey === 'completed') {
                percentage = metrics.total > 0 ? (metrics.completed / metrics.total) * 100 : 0;
            }
            const safePercentage = Math.max(0, Math.min(100, Number(percentage.toFixed(1))));
            row.style.setProperty('--metric-progress', `${safePercentage}%`);
            row.setAttribute('aria-label', `${metricKey || 'metric'}: ${safePercentage}%`);
        });
    });

    const isDashboardVisible = DOM.mediaDashboardSection && DOM.mediaDashboardSection.style.display !== 'none';
    if (!isDashboardVisible) return;

    renderAllDashboardPanelFilters();
    renderDashboardNewsPanel();
    void ensureDashboardNews();
    renderDashboardRecentCarousel();
    renderDashboardSuggestionsCarousel();
    renderDashboardUpcomingReleases();
}

function updateAllSeriesGenreFilterOptions(allSeries: Series[]) {
    if (!DOM.allSeriesGenreFilter) return;
    const select = DOM.allSeriesGenreFilter;
    const uniqueGenres = new Map<number, string>();
    allSeries.forEach(series => {
        (series.genres || []).forEach(genre => {
            if (genre && typeof genre.id === 'number') {
                uniqueGenres.set(genre.id, genre.name);
            }
        });
    });

    const sortedGenres = Array.from(uniqueGenres.entries()).sort((a, b) =>
        a[1].localeCompare(b[1], 'pt-PT', { sensitivity: 'base' })
    );

    const newOptions = [
        ['all', 'Todos os Géneros'] as [string, string],
        ...sortedGenres.map(([id, name]) => [String(id), translateGenreName(name)] as [string, string])
    ];
    const currentSignature = Array.from(select.options).map(option => `${option.value}:${option.textContent}`).join('|');
    const newSignature = newOptions.map(([value, label]) => `${value}:${label}`).join('|');

    if (currentSignature !== newSignature) {
        select.innerHTML = '';
        newOptions.forEach(([value, label]) => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = label;
            select.appendChild(option);
        });
    }

    const desiredValue = S.allSeriesGenreFilter;
    const hasDesired = newOptions.some(([value]) => value === desiredValue);
    select.value = hasDesired ? desiredValue : 'all';
    if (!hasDesired && desiredValue !== 'all') {
        S.setAllSeriesGenreFilter('all');
    }
    select.disabled = sortedGenres.length === 0;
}

export function renderAllSeries() {
    if (!DOM.allSeriesContainer) return;
    const viewMode = DOM.allSeriesContainer.classList.contains('grid-view') ? 'grid' : 'list';
    DOM.allSeriesContainer.innerHTML = '';
    const allSeries = [...S.myWatchlist, ...S.myArchive];
    allSeries.sort((a, b) => a.name.localeCompare(b.name));
    if (DOM.allSeriesMediaFilter) {
        const desiredMediaType = S.allSeriesMediaFilter;
        const allowedMediaTypes = ['all', 'series', 'movie', 'book'];
        DOM.allSeriesMediaFilter.value = allowedMediaTypes.includes(desiredMediaType) ? desiredMediaType : 'all';
    }
    const selectedMediaType = S.allSeriesMediaFilter;
    const mediaFilteredSeries = selectedMediaType === 'all'
        ? allSeries
        : allSeries.filter(series => (series.media_type || 'series') === selectedMediaType);
    if (DOM.allSeriesStatusFilter) {
        const desiredStatus = S.allSeriesStatusFilter;
        const allowedStatuses = ['all', 'watchlist', 'unseen', 'archive'];
        DOM.allSeriesStatusFilter.value = allowedStatuses.includes(desiredStatus) ? desiredStatus : 'all';
    }
    const selectedStatus = S.allSeriesStatusFilter;
    const statusFilteredSeries = selectedStatus === 'all'
        ? mediaFilteredSeries
        : mediaFilteredSeries.filter(series => resolveLibraryStatus(series) === selectedStatus);
    updateAllSeriesGenreFilterOptions(statusFilteredSeries);
    const selectedGenreId = S.allSeriesGenreFilter;
    const filteredSeries = selectedGenreId === 'all'
        ? statusFilteredSeries
        : statusFilteredSeries.filter(series => (series.genres || []).some(genre => genre.id === Number(selectedGenreId)));

    if (filteredSeries.length === 0) {
        if (allSeries.length === 0) {
            DOM.allSeriesContainer.innerHTML = '<p class="empty-list-message">Nenhum conteúdo na sua biblioteca. Adicione conteúdos através da pesquisa.</p>';
        } else if (mediaFilteredSeries.length === 0) {
            DOM.allSeriesContainer.innerHTML = '<p class="empty-list-message">Nenhum conteúdo encontrado para o tipo selecionado.</p>';
        } else if (statusFilteredSeries.length === 0) {
            DOM.allSeriesContainer.innerHTML = '<p class="empty-list-message">Nenhum conteúdo encontrado para o estado selecionado.</p>';
        } else {
            DOM.allSeriesContainer.innerHTML = '<p class="empty-list-message">Nenhum conteúdo encontrado para o género selecionado.</p>';
        }
        return;
    }

    filteredSeries.forEach(series => {
        const seriesItemElement = createSeriesItemElement(series, true, viewMode, false);
        DOM.allSeriesContainer.appendChild(seriesItemElement);
    });
}

export function renderPopularSeries(seriesList: Series[], startingRank: number = 1) {
    const viewMode = DOM.popularContainer.classList.contains('grid-view') ? 'grid' : 'list';

    if (seriesList.length === 0) {
        DOM.popularContainer.innerHTML = '<p class="empty-list-message">Nenhuma série top rated encontrada.</p>';
        return;
    }

    seriesList.forEach((series, index) => {
        const seriesItemElement = createSeriesItemElement(series, false, viewMode, false, true, true, startingRank + index);
        DOM.popularContainer.appendChild(seriesItemElement);
    });
}

export function renderPremieresSeries(seriesList: Series[], startingRank: number = 1) {
    const viewMode = DOM.premieresContainer.classList.contains('grid-view') ? 'grid' : 'list';    
    if (seriesList.length === 0 && DOM.premieresContainer.innerHTML === '') {
        DOM.premieresContainer.innerHTML = '<p class="empty-list-message">Nenhuma série em estreia encontrada.</p>';
        return;
    }

    seriesList.forEach((series, index) => {
        const rank = startingRank + index;
        const seriesItemElement = createSeriesItemElement(series, false, viewMode, false, true, true, rank);
        DOM.premieresContainer.appendChild(seriesItemElement);
    });
}

function createSeriesItemElement(series: Series, showStatus = false, viewMode = 'list', showUnwatchedBadge = false, showRatingCircle = false, isDiscovery = false, rank?: number): HTMLElement {
    const posterPath = buildPosterUrl(
        series.poster_path,
        'w185',
        '/placeholders/poster.svg'
    );
    const releaseYear = series.first_air_date ? `(${new Date(series.first_air_date).getFullYear()})` : '';
    const mediaType = series.media_type || 'series';
    const mediaTypeLabel = getMediaTypeLabel(mediaType);
    const watchedCount = S.watchedState[series.id]?.length || 0;
    const totalEpisodes = series.total_episodes || 0;
    const nonSeriesProgress = getMediaProgressPercent(series);
    const progressPercentage = mediaType === 'series'
        ? (totalEpisodes > 0 ? (watchedCount / totalEpisodes) * 100 : 0)
        : nonSeriesProgress;
    const isSeriesInProgress = watchedCount > 0 && progressPercentage < 100;

    const unwatchedCount = totalEpisodes > 0 ? totalEpisodes - watchedCount : 0;
    let unwatchedBadge = null;
    // Mostra o badge se a flag `showUnwatchedBadge` estiver ativa (secção "A Ver")
    // OU se a série estiver em progresso (para a secção "Todas").
    if (mediaType === 'series' && (showUnwatchedBadge || isSeriesInProgress) && unwatchedCount > 0 && viewMode === 'grid') {
        unwatchedBadge = el('div', { class: 'unwatched-badge', text: unwatchedCount });
    }

    let ratingCircle = null;
    if (showRatingCircle && viewMode === 'grid') {
        const voteAverage = (series.vote_average || 0).toFixed(1);
        ratingCircle = el('div', { class: 'consensus grid-view-rating' }, [
            el('div', { class: 'user_score_chart', 'data-rating': voteAverage })
        ]);
    }

    const posterElement = el('div', { class: 'watchlist-poster-wrapper' }, [
        createPosterImage(
            posterPath,
            `Poster de ${series.name}`,
            'watchlist-poster-img',
            '/placeholders/poster.svg'
        ),
        unwatchedBadge,
        ratingCircle,
    ]);

    let progressElement = null;
    if (!isDiscovery && (progressPercentage > 0 || S.myArchive.some(s => s.media_type === mediaType && s.id === series.id))) {
        let progressBarClass = '';
        if (progressPercentage >= 100) progressBarClass = 'complete';
        else if (progressPercentage > 0) progressBarClass = 'in-progress';
        progressElement = el('div', { class: 'list-item-progress' }, [
            el('div', { class: 'progress-bar-container' }, [el('div', { class: `progress-bar ${progressBarClass}`, style: `width: ${progressPercentage}%;` })]),
            el('span', { text: `${Math.round(progressPercentage)}%` })
        ]);
    } else if (isDiscovery && viewMode === 'list') {
        // Para as secções de descoberta (Top Rated, Estreias), mostra a avaliação pública em vez do progresso
        const publicRating = (series.vote_average || 0).toFixed(1);
        progressElement = el('div', { class: 'public-rating-in-list' }, [
            el('i', { class: 'fas fa-star' }),
            el('span', { text: publicRating })
        ]);
    }
    let statusElement = null;
    if (showStatus) {
        let statusText = '';
        if (S.myArchive.some(s => s.media_type === mediaType && s.id === series.id)) statusText = 'Arquivo';
        else if (S.myWatchlist.some(s => s.media_type === mediaType && s.id === series.id)) {
            if (mediaType === 'series') {
                statusText = (watchedCount > 0) ? 'A Ver' : 'Quero Ver';
            } else if (progressPercentage >= 100) {
                statusText = mediaType === 'movie' ? 'Visto' : 'Concluído';
            } else if (progressPercentage > 0) {
                statusText = mediaType === 'movie' ? 'A Ver' : 'Em leitura';
            } else {
                statusText = mediaType === 'book' ? 'Por ler' : 'Quero Ver';
            }
        }
        if (statusText) statusElement = el('span', { class: 'series-status-label', text: statusText });
    }
    const overview = getSafeOverviewText(series.overview);
    const overviewElement = viewMode === 'grid' ? null : el('p', { text: overview });

    // Cria o elemento do título, adicionando o ranking se aplicável
    const titleChildren: (Node | string)[] = [];
    if (rank !== undefined && isDiscovery) {
        titleChildren.push(el('span', { class: 'discovery-rank-text', text: `${rank}.` }));
    }
    titleChildren.push(`${series.name} ${releaseYear}`);
    const showMediaTypeChip = showStatus || mediaType !== 'series';
    if (showMediaTypeChip && viewMode === 'list') {
        titleChildren.push(' ');
        titleChildren.push(el('span', { class: getMediaTypeChipClass(mediaType), text: mediaTypeLabel }));
    }
    const titleElement = el('h3', {}, titleChildren);
    const mediaTypeChipInGrid = viewMode === 'grid' && showMediaTypeChip
        ? el('span', { class: getMediaTypeChipClass(mediaType, 'media-type-chip-grid'), text: mediaTypeLabel })
        : null;

    const titleInList = viewMode === 'list' ? titleElement : null;
    const statusInList = viewMode === 'list' ? statusElement : null;
    const titleInGrid = viewMode === 'grid' ? titleElement : null;
    const statusInGrid = viewMode === 'grid' ? statusElement : null;
    const gridMetaChips = [statusInGrid, mediaTypeChipInGrid].filter(Boolean) as HTMLElement[];
    const metaChipsInGrid = viewMode === 'grid' && gridMetaChips.length > 0
        ? el('div', { class: 'watchlist-meta-chips' }, gridMetaChips)
        : null;
    const watchlistInfo = el('div', { class: 'watchlist-info' }, [
        el('div', { class: 'watchlist-title-wrapper' }, [titleInList, statusInList]),
        progressElement,
        overviewElement,
        titleInGrid,
        metaChipsInGrid
    ]);
    return el('div', { class: 'watchlist-item', 'data-series-id': String(series.id), 'data-media-type': mediaType }, [
        posterElement,
        watchlistInfo,
    ]);
}

export function renderMediaDetails(
    media: Series,
    options: { progressPercent: number; isInLibrary: boolean; isArchived: boolean }
) {
    const detailSection = DOM.seriesViewSection;
    detailSection.innerHTML = '';

    const mediaType = media.media_type || 'series';
    const mediaTypeLabel = getMediaTypeLabel(mediaType);
    const releaseYear = media.first_air_date ? `(${new Date(media.first_air_date).getFullYear()})` : '';
    const releaseDate = media.first_air_date && !Number.isNaN(new Date(media.first_air_date).getTime())
        ? new Date(media.first_air_date).toLocaleDateString('pt-PT')
        : 'Data desconhecida';
    const posterPath = buildPosterUrl(
        media.poster_path,
        'w300_and_h450_bestv2',
        '/placeholders/poster.svg'
    );
    const backdropPath = buildPosterUrl(media.backdrop_path, 'w1280', '');
    const effectiveBackdrop = backdropPath || posterPath;
    const progressPercent = Math.max(0, Math.min(100, Math.round(options.progressPercent || 0)));
    const genres = (media.genres || []).map((g) => g?.name).filter(Boolean).join(', ') || 'N/A';
    const publicRatingValue = typeof media.vote_average === 'number' ? media.vote_average : 0;
    const publicRating = publicRatingValue > 0 ? publicRatingValue.toFixed(1) : 'N/A';
    const mediaStateKey = getMediaStateKey(media);
    const currentUserData = S.userData[mediaStateKey] || {};
    const currentUserRating = Math.max(0, Math.min(10, currentUserData.rating || 0));
    const currentUserNotes = currentUserData.notes || '';
    const runtimeMinutes = typeof media.episode_run_time === 'number' ? media.episode_run_time : 0;
    const runtimeText = runtimeMinutes > 0 ? formatHoursMinutes(runtimeMinutes) : 'N/A';
    const sourceProviderLabel = (() => {
        if (media.source_provider === 'tmdb_movie') return 'TMDb';
        if (media.source_provider === 'google_books') return 'Google Books';
        if (media.source_provider === 'open_library') return 'Open Library';
        if (media.source_provider === 'presenca') return 'Presenca';
        return media.source_provider || 'N/A';
    })();
    const progressLabel = mediaType === 'movie'
        ? (progressPercent >= 100 ? 'Visto' : 'Por ver')
        : (progressPercent >= 100 ? 'Concluído' : progressPercent > 0 ? 'Em leitura' : 'Por ler');
    const progressCounter = mediaType === 'movie'
        ? (progressPercent >= 100 ? '100% concluído' : '0% concluído')
        : `${progressPercent}% leitura`;
    const progressHTML = `<div class="v2-overview-progress"><div class="v2-progress-bar-container"><div class="v2-progress-bar" style="width: ${progressPercent}%;"></div></div><div class="v2-progress-text"><span>${Math.round(progressPercent)}%</span><span>${progressCounter}</span></div></div>`;
    const findMediaTrailerKey = () => {
        const videos = media.videos?.results;
        if (!Array.isArray(videos) || videos.length === 0) return null;
        const youtubeVideos = videos.filter((video) => video.site === 'YouTube');
        if (youtubeVideos.length === 0) return null;
        const priorities = [
            (video: { type: string; official?: boolean }) => video.type === 'Trailer' && video.official === true,
            (video: { type: string }) => video.type === 'Trailer',
            (video: { type: string; official?: boolean }) => video.type === 'Teaser' && video.official === true,
            (video: { type: string }) => video.type === 'Teaser',
            (video: { official?: boolean }) => video.official === true,
        ];
        for (const match of priorities) {
            const found = youtubeVideos.find(match);
            if (found?.key) return found.key;
        }
        return youtubeVideos[0]?.key || null;
    };
    const mediaTrailerKey = mediaType === 'movie' ? findMediaTrailerKey() : null;
    const ratingEntries = publicRatingValue > 0
        ? [{
            key: mediaType === 'movie' ? 'tmdb' : 'books',
            label: mediaType === 'movie' ? 'TMDb' : sourceProviderLabel,
            value: publicRatingValue,
            color: mediaType === 'movie' ? 'var(--primary-accent)' : 'var(--tvmaze-accent)',
        }]
        : [];
    const averageRating = ratingEntries.length > 0
        ? ratingEntries.reduce((sum, entry) => sum + entry.value, 0) / ratingEntries.length
        : 0;
    const publicRatingsElement = ratingEntries.length > 0 ? el('div', { class: 'v2-public-ratings' }, [
        el('p', { class: 'v2-action-label', text: 'Avaliações' }),
        el('div', { class: 'concentric-chart-wrapper' }, [
            el('div', { class: 'concentric-chart rings-1' }, [
                el('div', {
                    class: 'chart-ring outer',
                    style: `--progress: ${ratingEntries[0].value * 10}%; --color: ${ratingEntries[0].color};`
                }),
                el('div', { class: 'chart-center' }, [el('span', { class: 'chart-average', text: averageRating.toFixed(1) })])
            ]),
            el('div', { class: 'chart-legend' }, ratingEntries.map((entry) =>
                el('div', { class: 'legend-item' }, [
                    el('span', { class: 'legend-color', style: `background-color: ${entry.color};` }),
                    el('span', { class: 'legend-text', text: `${entry.label}:` }),
                    el('strong', { class: 'legend-value', text: entry.value.toFixed(1) })
                ])
            ))
        ])
    ]) : null;
    const topFacts = [
        { type: 'text', value: releaseDate },
        { type: 'certification', value: mediaTypeLabel },
        { type: 'text', value: genres },
        mediaType === 'movie' ? { type: 'text', value: runtimeText } : null,
    ].filter((fact): fact is { type: 'text' | 'certification'; value: string } => Boolean(fact?.value && fact.value !== 'N/A'));
    const factsElements = topFacts.flatMap((fact, index) => {
        const nodes: (Node | HTMLElement)[] = [];
        if (index > 0) nodes.push(el('span', { class: 'separator-dot', html: ' &bull; ' }));
        nodes.push(fact.type === 'certification'
            ? el('span', { class: 'v2-certification', text: fact.value })
            : document.createTextNode(fact.value));
        return nodes;
    });
    const metadataItems = mediaType === 'movie'
        ? [
            { label: 'Status', value: progressLabel },
            { label: 'Géneros', value: genres },
            { label: 'Duração', value: runtimeText },
            { label: 'Fonte', value: sourceProviderLabel },
            { label: 'ID Fonte', value: media.source_id || String(media.id) },
            { label: 'Avaliação Pública', value: publicRating === 'N/A' ? 'N/A' : `${publicRating}/10` },
        ]
        : [
            { label: 'Estado Leitura', value: progressLabel },
            { label: 'Géneros', value: genres },
            { label: 'Publicado', value: releaseDate },
            { label: 'Fonte', value: sourceProviderLabel },
            { label: 'ID Fonte', value: media.source_id || String(media.id) },
            { label: 'Progresso', value: `${progressPercent}%` },
        ];

    const actionButtons: (HTMLElement | null)[] = [
        el('button', { id: 'back-to-previous-section-btn', class: 'v2-action-btn icon-only', type: 'button', title: 'Voltar à secção anterior', 'aria-label': 'Voltar à secção anterior' }, [
            el('i', { class: 'fas fa-arrow-left' }),
        ]),
        el('button', { id: 'media-refresh-details-btn', class: 'v2-action-btn icon-only', type: 'button', title: 'Atualizar detalhes', 'aria-label': 'Atualizar detalhes' }, [
            el('i', { class: 'fas fa-sync-alt' }),
        ]),
    ];

    if (options.isInLibrary) {
        actionButtons.push(
            el('button', {
                id: 'media-archive-toggle-btn',
                class: 'v2-action-btn icon-only',
                type: 'button',
                title: options.isArchived ? 'Mover para Quero Ver' : 'Mover para Arquivo',
                'aria-label': options.isArchived ? 'Mover para Quero Ver' : 'Mover para Arquivo'
            }, [el('i', { class: options.isArchived ? 'fas fa-undo' : 'fas fa-archive' })]),
            el('button', {
                id: 'media-remove-from-library-btn',
                class: 'v2-action-btn icon-only',
                type: 'button',
                title: 'Remover da biblioteca',
                'aria-label': 'Remover da biblioteca'
            }, [el('i', { class: 'fas fa-trash-alt' })]),
        );
    } else {
        actionButtons.push(
            el('button', {
                id: 'media-add-watchlist-btn',
                class: 'v2-action-btn icon-only',
                type: 'button',
                title: 'Adicionar à biblioteca',
                'aria-label': 'Adicionar à biblioteca'
            }, [el('i', { class: 'fas fa-plus' })]),
        );
    }

    const progressControls = mediaType === 'movie'
        ? el('div', { class: 'media-progress-controls' }, [
            el('button', {
                id: 'movie-toggle-seen-btn',
                class: 'v2-action-btn',
                type: 'button',
                'data-current-progress': String(progressPercent)
            }, [
                el('i', { class: progressPercent >= 100 ? 'fas fa-check-circle' : 'far fa-circle' }),
                progressPercent >= 100 ? ' Marcar como não visto' : ' Marcar como visto'
            ]),
        ])
        : el('div', { class: 'media-progress-controls book-progress-controls' }, [
            el('label', { for: 'book-progress-range', text: 'Leitura' }),
            el('input', {
                id: 'book-progress-range',
                type: 'range',
                min: '0',
                max: '100',
                step: '1',
                value: String(progressPercent),
            }),
            el('span', { id: 'book-progress-value', class: 'book-progress-value', text: `${progressPercent}%` }),
            el('button', { id: 'book-progress-save-btn', class: 'v2-action-btn', type: 'button' }, [
                el('i', { class: 'fas fa-save' }),
                ' Guardar progresso'
            ]),
        ]);

    const header = el('div', { class: 'v2-detail-header', style: effectiveBackdrop ? `background-image: url('${effectiveBackdrop}');` : '' }, [
        el('div', { class: 'v2-header-custom-bg' }, [
            el('div', { class: 'v2-header-content' }, [
                el('div', { class: 'v2-poster-wrapper media-detail-poster', html: progressHTML }, [
                    createPosterImage(
                        posterPath,
                        `Poster de ${media.name}`,
                        'v2-poster',
                        '/placeholders/poster.svg'
                    )
                ]),
                el('div', { class: 'v2-details-wrapper' }, [
                    el('div', { class: 'v2-title' }, [
                        el('div', { class: 'v2-title-text' }, [
                            el('h1', {}, [
                                `${media.name} `,
                                el('span', { class: 'release-year', text: releaseYear })
                            ])
                        ]),
                        el('div', { class: 'v2-header-actions' }, actionButtons)
                    ]),
                    el('div', { class: 'v2-facts' }, factsElements),
                    el('div', { class: 'v2-actions' }, [
                        el('div', { class: 'v2-all-ratings-wrapper' }, [
                            el('div', { class: 'v2-ratings-group' }, [
                                el('div', { class: 'user-rating-container v2-user-rating' }, [
                                    el('p', { class: 'v2-action-label', text: 'A Minha Avaliação' }),
                                    el('div', {
                                        class: 'star-rating',
                                        'data-series-id': String(media.id),
                                        'data-media-id': String(media.id),
                                        'data-media-type': mediaType,
                                    }, Array.from({ length: 10 }, (_, i) => {
                                        const value = i + 1;
                                        const starClass = value <= currentUserRating ? 'fas' : 'far';
                                        return el('div', { class: 'star-container', 'data-value': value }, [
                                            el('i', { class: `${starClass} fa-star star-icon` }),
                                            el('span', { class: 'star-number', text: value })
                                        ]);
                                    })),
                                ]),
                                publicRatingsElement,
                            ])
                        ]),
                        mediaTrailerKey
                            ? el('a', { class: 'v2-action-btn trailer-btn', 'data-video-key': mediaTrailerKey }, [
                                el('i', { class: 'fas fa-play' }),
                                ' Ver Trailer'
                            ])
                            : null
                    ]),
                    el('div', { class: 'v2-overview' }, [
                        el('h3', { text: 'Sinopse' }),
                        el('p', { text: getSafeOverviewText(media.overview) })
                    ]),
                    el('div', { class: 'v2-additional-facts' }, [
                        el('div', { class: 'v2-metadata-grid' }, [
                            ...metadataItems.map((fact) =>
                                el('div', { class: 'v2-metadata-item' }, [
                                    el('span', { text: fact.label }),
                                    el('p', { text: fact.value || 'N/A' })
                                ])
                            )
                        ])
                    ]),
                    progressControls
                ])
            ])
        ])
    ]);

    detailSection.appendChild(header);
    detailSection.dataset.seriesId = String(media.id);
    detailSection.dataset.mediaType = mediaType;
    detailSection.dataset.mediaId = String(media.id);

    const bodyContentContainer = el('div', { class: 'v2-body-content' }, [
        el('div', { class: 'v2-info-card collapsible' }, [
            el('details', {}, [
                el('summary', { text: 'As Minhas Notas' }),
                el('textarea', {
                    class: 'user-notes-textarea',
                    'data-series-id': String(media.id),
                    'data-media-id': String(media.id),
                    'data-media-type': mediaType,
                    placeholder: `Escreva aqui as suas notas sobre ${mediaType === 'movie' ? 'o filme' : 'o livro'}...`,
                    text: currentUserNotes
                })
            ])
        ])
    ]);
    detailSection.appendChild(bodyContentContainer);
}

export function renderSeriesDetails(
    seriesData: TMDbSeriesDetails,
    allTMDbSeasonsData: TMDbSeason[],
    creditsData: TMDbCredits,
    traktSeriesData: TraktData | null,
    traktSeasonsData: TraktSeason[] | null,
    aggregatedSeriesData: AggregatedSeriesMetadata | null = null
) {
    const detailSection = DOM.seriesViewSection;
    detailSection.innerHTML = '';
    const backdropPath = seriesData.backdrop_path ? `https://image.tmdb.org/t/p/w1280${seriesData.backdrop_path}` : '';
    const posterPath = seriesData.poster_path ? `https://image.tmdb.org/t/p/w300_and_h450_bestv2${seriesData.poster_path}` : '/placeholders/poster.svg';
    const releaseYear = seriesData.first_air_date ? `(${new Date(seriesData.first_air_date).getFullYear()})` : '';
    const premiereDate = seriesData.first_air_date ? new Date(seriesData.first_air_date).toLocaleDateString('pt-PT') : '';
    const genres = seriesData.genres?.map(g => g.name).join(', ') || '';
    const allEpisodes: Episode[] = allTMDbSeasonsData.flatMap(season => season.episodes);
    const episodesWithRuntime = allEpisodes.filter(ep => ep.runtime && ep.runtime > 0);
    const totalRuntimeMinutes = episodesWithRuntime.reduce((sum, ep) => sum + (ep.runtime ?? 0), 0);
    const averageRuntime = episodesWithRuntime.length > 0 ? Math.round(totalRuntimeMinutes / episodesWithRuntime.length) : (seriesData.episode_run_time?.[0] || 0);
    const runtimeText = averageRuntime > 0 ? `${averageRuntime}m` : '';
    const originalCertification = aggregatedSeriesData?.certification || traktSeriesData?.certification || '';
    const certification = formatCertification(originalCertification);
    const facts = [{ type: 'text', value: premiereDate }, { type: 'certification', value: certification }, { type: 'text', value: genres }, { type: 'text', value: runtimeText }].filter(f => f.value);
    const factsElements = facts.flatMap((fact, index) => {
        const nodes = [];
        if (index > 0) nodes.push(el('span', { class: 'separator-dot', html: ' &bull; ' }));
        nodes.push(fact.type === 'certification' ? el('span', { class: 'v2-certification', text: fact.value }) : document.createTextNode(fact.value));
        return nodes;
    });
    const additionalFacts = (() => {
        const networksElements = seriesData.networks?.length > 0
            ? seriesData.networks.flatMap((n, idx) => {
                const elements = [];
                if (idx > 0) elements.push(document.createTextNode(', ')); // Add comma separator
                elements.push(el('span', { class: 'v2-network-label', text: n.name }));
                return elements;
            })
            : [document.createTextNode('N/A')]; // Wrap N/A in a text node for consistency
        const studiosText = seriesData.production_companies?.length > 0 ? seriesData.production_companies.map(c => c.name).join(', ') : 'N/A';
        const countries = seriesData.production_countries?.map(c => c.name).join(', ') || 'N/A';
        const languages = seriesData.spoken_languages?.map(l => l.english_name).join(', ') || 'N/A';
        const nextEpisodeAirDateRaw = seriesData.next_episode_to_air?.air_date || '';
        const nextEpisodeAirDate = nextEpisodeAirDateRaw
            ? new Date(nextEpisodeAirDateRaw).toLocaleDateString('pt-PT')
            : '';
        let statusText = seriesData.status || 'N/A';
        if (seriesData.status === 'Ended') statusText = 'Finalizada';
        else if (seriesData.status === 'Canceled') statusText = 'Cancelada';
        else if (seriesData.status === 'Returning Series') statusText = 'Em Exibição';
        if (statusText === 'Em Exibição' && nextEpisodeAirDate) {
            statusText = `${statusText} (volta em ${nextEpisodeAirDate})`;
        }
        const totalRuntime = formatHoursMinutes(totalRuntimeMinutes);
        return [{ label: 'Status', value: statusText }, { label: 'Transmissão', value: networksElements }, { label: 'Estúdios', value: studiosText }, { label: 'País', value: countries }, { label: 'Idioma Original', value: languages }, { label: 'Duração Total', value: totalRuntime }];
    })();
    const totalEpisodes = seriesData.total_episodes || allTMDbSeasonsData.reduce((acc, season) => acc + (season.episodes?.length || 0), 0);
    const watchedCount = S.watchedState[seriesData.id]?.length || 0;
    const overallProgress = totalEpisodes > 0 ? (watchedCount / totalEpisodes) * 100 : 0;
    const progressHTML = `<div class="v2-overview-progress"><div class="v2-progress-bar-container"><div class="v2-progress-bar" style="width: ${overallProgress}%;"></div></div><div class="v2-progress-text"><span>${Math.round(overallProgress)}%</span><span>${watchedCount} / ${totalEpisodes} episódios</span></div></div>`;
    const tmdbRating = seriesData.vote_average || 0;
    const traktRating = traktSeriesData?.ratings?.rating || 0;
    const tvmazeRating = (typeof aggregatedSeriesData?.tvmazeData?.show?.rating?.average === 'number'
        ? aggregatedSeriesData.tvmazeData.show.rating.average
        : 0) || 0;
    const ratingEntries = [
        { key: 'tmdb', label: 'TMDb', value: tmdbRating, color: 'var(--primary-accent)' },
        { key: 'trakt', label: 'Trakt', value: traktRating, color: 'var(--secondary-accent)' },
        { key: 'tvmaze', label: 'TVMaze', value: tvmazeRating, color: 'var(--tvmaze-accent)' },
    ].filter(entry => entry.value > 0);
    const ratingsCount = ratingEntries.length;
    const averageRating = ratingsCount > 0
        ? ratingEntries.reduce((sum, entry) => sum + entry.value, 0) / ratingsCount
        : 0;
    const ringClasses = ratingsCount >= 3 ? ['outer', 'middle', 'inner'] : ratingsCount === 2 ? ['outer', 'middle'] : ['outer'];
    const publicRatingsElement = ratingsCount > 0 ? el('div', { class: 'v2-public-ratings' }, [
        el('p', { class: 'v2-action-label', text: 'Avaliações' }),
        el('div', { class: 'concentric-chart-wrapper' }, [
            el('div', { class: `concentric-chart rings-${ratingsCount}` }, [
                ...ratingEntries.map((entry, index) =>
                    el('div', {
                        class: `chart-ring ${ringClasses[index]}`,
                        style: `--progress: ${entry.value * 10}%; --color: ${entry.color};`
                    })
                ),
                el('div', { class: 'chart-center' }, [el('span', { class: 'chart-average', text: averageRating.toFixed(1) })])
            ]),
            el('div', { class: 'chart-legend' }, ratingEntries.map((entry) =>
                el('div', { class: 'legend-item' }, [
                    el('span', { class: 'legend-color', style: `background-color: ${entry.color};` }),
                    el('span', { class: 'legend-text', text: `${entry.label}:` }),
                    el('strong', { class: 'legend-value', text: entry.value.toFixed(1) })
                ])
            ))
        ])
    ]) : null;
    const currentUserData = S.userData[seriesData.id] || {};
    const currentUserRating = currentUserData.rating || 0;
    let finalTrailerKey = traktSeriesData?.trailerKey;
    const findTMDbTrailer = (videos: TMDbSeriesDetails['videos'] | undefined) => {
        if (!videos || !Array.isArray(videos.results) || videos.results.length === 0) return null;
        const youtubeVideos = videos.results.filter((v: any) => v.site === 'YouTube');
        if (youtubeVideos.length === 0) return null;
        const priorities = [(v: any) => v.type === 'Trailer' && v.official === true, (v: any) => v.type === 'Trailer', (v: any) => v.type === 'Teaser' && v.official === true, (v: any) => v.type === 'Teaser', (v: any) => v.official === true];
        for (const condition of priorities) {
            const video = youtubeVideos.find(condition);
            if (video) return video.key as string;
        }
        return youtubeVideos[0].key;
    };
    if (!finalTrailerKey) finalTrailerKey = findTMDbTrailer(seriesData.videos);
    const tmdbOverview = seriesData.overview || '';
    const traktOverview = traktSeriesData?.overview || '';
    const finalOverview = getSafeOverviewText(aggregatedSeriesData?.overview || tmdbOverview || traktOverview);
    const headerElement = el('div', { class: 'v2-detail-header', style: `background-image: url('${backdropPath}');` }, [
        el('div', { class: 'v2-header-custom-bg' }, [
            el('div', { class: 'v2-header-content' }, [
                el('div', { class: 'v2-poster-wrapper', html: progressHTML }, [
                    createPosterImage(
                        posterPath,
                        `Poster de ${seriesData.name}`,
                        'v2-poster',
                        '/placeholders/poster.svg'
                    )
                ]),
                el('div', { class: 'v2-details-wrapper' }, [
                    el('div', { class: 'v2-title' }, [
                        el('div', { class: 'v2-title-text' }, [
                            el('h1', {}, [`${seriesData.name} `, el('span', { class: 'release-year', text: releaseYear })])
                        ]),
                        el('div', { class: 'v2-header-actions' }, [
                            el('button', { id: 'back-to-previous-section-btn', class: 'v2-action-btn icon-only', type: 'button', title: 'Voltar à secção anterior', 'aria-label': 'Voltar à secção anterior' }, [
                                el('i', { class: 'fas fa-arrow-left' }),
                            ]),
                            el('div', { id: 'library-actions', style: 'display: none; gap: 1rem;' }, [ // Ações para séries na biblioteca
                                el('button', { id: 'mark-all-seen-btn', class: 'v2-action-btn icon-only', title: 'Marcar todos como vistos', 'aria-label': 'Marcar todos os episódios como vistos' }, [el('i', { class: 'fas fa-check-double' })]),
                                el('button', { id: 'refresh-metadata-btn', class: 'v2-action-btn icon-only', title: 'Atualizar Metadados', 'aria-label': 'Atualizar Metadados da Série' }, [el('i', { class: 'fas fa-sync-alt' })]),
                                el('button', { id: 'v2-remove-series-btn', class: 'v2-action-btn icon-only', title: 'Remover série da biblioteca', 'aria-label': 'Remover série da biblioteca' }, [el('i', { class: 'fas fa-trash-alt' })]),
                            ]),
                            el('div', { id: 'discover-actions', style: 'display: none; gap: 1rem;' }, [ // Ações para séries novas
                                el('button', { id: 'add-to-watchlist-btn', class: 'v2-action-btn icon-only', title: 'Adicionar à Biblioteca', 'aria-label': 'Adicionar à Biblioteca' }, [el('i', { class: 'fas fa-plus' })]),
                                el('button', { id: 'add-and-mark-all-seen-btn', class: 'v2-action-btn icon-only', title: 'Adicionar e Marcar Tudo Como Visto', 'aria-label': 'Adicionar e Marcar Tudo Como Visto' }, [el('i', { class: 'fas fa-check-double' })]),
                            ]),
                        ])
                    ]),
                    el('div', { class: 'v2-facts' }, factsElements),
                    el('div', { class: 'v2-actions' }, [ // Ações principais como ratings e trailer
                        el('div', { class: 'v2-all-ratings-wrapper' }, [
                            el('div', { class: 'v2-ratings-group' }, [
                                el('div', { class: 'user-rating-container v2-user-rating' }, [
                                    el('p', { class: 'v2-action-label', text: 'A Minha Avaliação' }),
                                    el('div', { class: 'star-rating', 'data-series-id': String(seriesData.id) }, Array.from({ length: 10 }, (_, i) => {
                                        const value = i + 1;
                                        const starClass = value <= currentUserRating ? 'fas' : 'far';
                                        return el('div', { class: 'star-container', 'data-value': value }, [el('i', { class: `${starClass} fa-star star-icon` }), el('span', { class: 'star-number', text: value })]);
                                    })),
                                ]),
                                publicRatingsElement,
                            ])
                        ])
                        ,
                        finalTrailerKey ? el('a', { class: 'v2-action-btn trailer-btn', 'data-video-key': finalTrailerKey }, [el('i', { class: 'fas fa-play' }), ' Ver Trailer']) : null
                    ]),
                    el('div', { class: 'v2-overview' }, [el('h3', { text: 'Sinopse' }), el('p', { text: finalOverview })]),
                    el('div', { class: 'v2-additional-facts' }, [el('div', { class: 'v2-metadata-grid' },
                        additionalFacts.map(fact => {
                            const valueElement = fact.label === 'Transmissão'
                                ? el('div', { class: 'v2-network-container' }, Array.isArray(fact.value) ? fact.value : [document.createTextNode(String(fact.value))])
                                : el('p', { text: String(fact.value) });
                            return el('div', { class: 'v2-metadata-item' }, [
                                el('span', { text: fact.label }),
                                valueElement
                            ]);
                        })
                    )])
                ])
            ])
        ])
    ]);
    detailSection.appendChild(headerElement);
    detailSection.dataset.seriesId = String(seriesData.id);

    const bodyContentContainer = el('div', { class: 'v2-body-content' });
    const peopleElement = (() => {
        const creators = seriesData.created_by || [];
        const fullCast = creditsData.cast || [];
        if (creators.length === 0 && fullCast.length === 0) return null;
        const peopleMap = new Map<number, { id: number; name: string; profile_path: string | null; roles: string[] }>();
        creators.forEach(p => {
            if (!peopleMap.has(p.id)) peopleMap.set(p.id, { ...p, roles: ['Criador(a)'] });
        });
        fullCast.forEach(p => {
            const characterNames = p.roles?.map(role => role.character).filter(Boolean) || [];
            if (characterNames.length > 0) {
                if (peopleMap.has(p.id)) {
                    peopleMap.get(p.id)!.roles.push(...characterNames);
                } else {
                    peopleMap.set(p.id, { id: p.id, name: p.name, profile_path: p.profile_path, roles: characterNames });
                }
            }
        });
        const allPeople = Array.from(peopleMap.values());
        const listElement = el('ol', { class: 'v2-people-list' });
        let buttonElement = null;
        if (allPeople.length > 9) {
            const initialPeople = allPeople.slice(0, 9);
            const remainingPeople = allPeople.slice(9);
            initialPeople.forEach(p => listElement.appendChild(createPersonElement(p)));
            buttonElement = el('div', { class: 'v2-people-list-actions' }, [
                el('button', { class: 'cast-show-more-btn', 'data-remaining-cast': JSON.stringify(remainingPeople), text: 'Ver Mais' })
            ]);
        } else {
            allPeople.forEach(p => listElement.appendChild(createPersonElement(p)));
        }
        return el('div', { class: 'v2-info-card collapsible' }, [
            el('details', {}, [
                el('summary', { text: 'Elenco e Criadores' }),
                listElement,
                buttonElement
            ])
        ]);
    })();
    if (peopleElement) bodyContentContainer.appendChild(peopleElement);

    const currentUserNotes = currentUserData.notes || '';
    const userNotesElement = el('div', { class: 'v2-info-card collapsible' }, [
        el('details', {}, [
            el('summary', { text: 'As Minhas Notas' }),
            el('textarea', { class: 'user-notes-textarea', 'data-series-id': String(seriesData.id), placeholder: 'Escreva aqui as suas notas pessoais sobre esta série...', text: currentUserNotes })
        ])
    ]);
    bodyContentContainer.appendChild(userNotesElement);

    const seasonsContainer = el('div', { class: 'v2-seasons-container' });
    const traktSeasonPosters: { [key: number]: { thumb?: string, full?: string } } = {};
    if (traktSeasonsData) {
        traktSeasonsData.forEach(s => { if (s.images?.poster?.thumb) traktSeasonPosters[s.number] = s.images.poster; });
    }
    const fragment = document.createDocumentFragment();
    allTMDbSeasonsData.forEach(seasonData => {
        const traktSeason = traktSeasonsData?.find(ts => ts.number === seasonData.season_number);
        const traktEpisodes = traktSeason?.episodes || [];
        const detailsElement = createSeasonElement(seriesData as unknown as Series, seasonData, traktEpisodes, traktSeasonPosters);
        fragment.appendChild(detailsElement);
    });
    seasonsContainer.appendChild(fragment);

    const seasonsCollapsible = el('div', { class: 'v2-info-card collapsible' }, [
        el('details', { open: '' }, [
            el('summary', { text: 'Temporadas' }),
            seasonsContainer
        ])
    ]);
    bodyContentContainer.appendChild(seasonsCollapsible);
    detailSection.appendChild(bodyContentContainer);
}

export function createPersonElement(person: { id: number; name: string; profile_path: string | null; roles: string[] }): HTMLElement {
    const photoElement = person.profile_path
        ? createPosterImage(
            `https://image.tmdb.org/t/p/w185${person.profile_path}`,
            person.name,
            'v2-person-photo',
            '/placeholders/poster.svg'
        )
        : el('div', { class: 'v2-person-photo no-photo', text: 'Foto não disponível' });
    return el('li', {}, [
        el('div', { class: 'v2-person-card' }, [
            photoElement,
            el('div', { class: 'v2-person-info' }, [
                el('p', { class: 'name', text: person.name }),
                el('p', { class: 'character', text: person.roles.join(', ') })
            ])
        ])
    ]);
}

function createSeasonElement(seriesData: Series, seasonData: TMDbSeason, traktEpisodes: { number: number; overview: string | null }[], traktSeasonPosters: { [key: number]: { thumb?: string, full?: string } }): DocumentFragment | HTMLElement {
    const totalSeasonEpisodes = seasonData.episodes.length;
    if (totalSeasonEpisodes === 0) return document.createDocumentFragment();
    const watchedSeriesEpisodes = S.watchedState[seriesData.id] || [];
    const watchedSeasonEpisodesCount = seasonData.episodes.filter(ep => watchedSeriesEpisodes.includes(ep.id)).length;
    const seasonProgress = (watchedSeasonEpisodesCount / totalSeasonEpisodes) * 100;
    const progressBarColorClass = seasonProgress === 100 ? 'complete' : 'in-progress';
    const isSeasonComplete = Math.round(seasonProgress) >= 100;
    const markSeasonBtnClass = isSeasonComplete ? 'fully-watched' : '';
    const markSeasonIconClass = isSeasonComplete ? 'fas fa-check-square' : 'far fa-square';
    const markSeasonBtnTitle = isSeasonComplete ? 'Desmarcar Temporada' : 'Marcar Temporada Como Vista';
    const translatedSeasonName = getTranslatedSeasonName(seasonData.name, seasonData.season_number!);
    const seasonNumber = seasonData.season_number ?? 0;
    const seasonNameFull = el('span', { class: 'season-name-full', text: translatedSeasonName });
    const seasonNameShort = el('span', { class: 'season-name-short', text: `T${seasonNumber}` });
    const detailsElement = el('details', { class: 'season-details', 'data-series-id': seriesData.id, 'data-season-number': seasonNumber, 'data-episode-count': totalSeasonEpisodes }, [
        el('summary', { class: 'season-summary', 'data-season-number': seasonNumber, 'aria-label': translatedSeasonName }, [
            el('span', { class: 'season-name' }, [seasonNameFull, seasonNameShort]),
            el('div', { class: 'season-actions-wrapper' }, [
                el('button', { class: `icon-button mark-season-seen-btn ${markSeasonBtnClass}`, title: markSeasonBtnTitle }, [el('i', { class: markSeasonIconClass })]),
                el('div', { class: 'season-progress-wrapper' }, [
                    el('span', { class: 'season-episode-counter', text: `${watchedSeasonEpisodesCount}/${totalSeasonEpisodes}` }),
                    el('div', { class: 'progress-bar-container' }, [el('div', { class: `progress-bar ${progressBarColorClass}`, style: `width: ${seasonProgress}%;` })]),
                    el('span', { class: 'season-progress-percentage', text: `${Math.round(seasonProgress)}%` })
                ])
            ])
        ]),
        el('div', { class: 'episode-list' })
    ]);
    const episodeListContainer = detailsElement.querySelector<HTMLDivElement>('.episode-list');
    if (episodeListContainer) renderEpisodeList(seasonData.episodes, episodeListContainer, seriesData.id, seriesData.poster_path, traktSeasonPosters, traktEpisodes);
    return detailsElement;
}

function renderEpisodeList(episodes: Episode[], container: HTMLElement, seriesId: number, seriesPosterPath: string | null, traktSeasonPosters: { [key: number]: { thumb?: string, full?: string } }, traktEpisodes: { number: number; overview: string | null }[]) {
    container.innerHTML = '';
    episodes.forEach(episode => {
        const seasonNumber = episode.season_number;
        const seasonPoster = traktSeasonPosters ? traktSeasonPosters[seasonNumber] : null;
        const traktEpisode = traktEpisodes.find(te => te.number === episode.episode_number);
        const tmdbOverview = episode.overview || '';
        const traktOverview = traktEpisode?.overview || '';
        const finalOverview = getSafeOverviewText(tmdbOverview || traktOverview);
        let stillPathSmall, stillPathLarge;
        if (episode.still_path) {
            stillPathSmall = `https://image.tmdb.org/t/p/w185${episode.still_path}`;
            stillPathLarge = `https://image.tmdb.org/t/p/w780${episode.still_path}`;
        } else if (seasonPoster?.thumb) {
            stillPathSmall = seasonPoster.thumb;
            stillPathLarge = seasonPoster.full || seasonPoster.thumb;
        } else if (seriesPosterPath) {
            stillPathSmall = `https://image.tmdb.org/t/p/w185${seriesPosterPath}`;
            stillPathLarge = `https://image.tmdb.org/t/p/w780${seriesPosterPath}`;
        } else {
            stillPathSmall = '/placeholders/still.svg';
            stillPathLarge = '/placeholders/still.svg';
        }
        const runtimeText = episode.runtime ? `${episode.runtime} min` : 'N/A';
        const episodeElement = el('div', { class: 'episode-item', 'data-series-id': String(seriesId), 'data-episode-id': String(episode.id), 'data-season-number': String(episode.season_number), 'data-title': episode.name, 'data-overview': finalOverview, 'data-still-path-large': stillPathLarge }, [
            createPosterImage(
                stillPathSmall,
                `Imagem do episódio ${episode.episode_number}`,
                'episode-still',
                '/placeholders/still.svg'
            ),
            el('i', { class: 'far fa-circle status-icon', role: 'button', tabindex: '0' }),
            el('span', { class: 'episode-number', text: `S${String(episode.season_number).padStart(2, '0')}E${String(episode.episode_number).padStart(2, '0')}` }),
            el('p', { class: 'episode-title', text: episode.name }),
            el('span', { class: 'episode-runtime', text: runtimeText }),
            el('span', { class: 'episode-air-date', text: new Date(episode.air_date).toLocaleDateString('pt-PT', { day: 'numeric', month: 'short', year: 'numeric' }) }),
            el('div', { class: 'episode-actions' }, [el('i', { class: 'fas fa-info-circle action-icon', title: 'Ver Detalhes' })])
        ]);
        container.appendChild(episodeElement);
        if (S.watchedState[seriesId] && S.watchedState[seriesId].includes(episode.id)) {
            markEpisodeAsSeen(episodeElement);
        }
    });
}

export function markEpisodeAsSeen(element: HTMLElement) {
    element.classList.add('seen');
    const statusIcon = element.querySelector('.status-icon') as HTMLElement;
    statusIcon.className = 'fas fa-check-circle status-icon';
    statusIcon.setAttribute('aria-label', 'Marcar como não visto');
}

export function markEpisodeAsUnseen(element: HTMLElement) {
    element.classList.remove('seen');
    const statusIcon = element.querySelector('.status-icon') as HTMLElement;
    statusIcon.className = 'far fa-circle status-icon';
    statusIcon.setAttribute('aria-label', 'Marcar como visto');
}

export function updateOverallProgressBar(seriesId: number) {
    if (DOM.seriesViewSection.style.display === 'none' || DOM.seriesViewSection.dataset.seriesId != String(seriesId)) return;
    const watchedCount = S.watchedState[seriesId]?.length || 0;
    const series = S.getSeries(seriesId)!;
    if (!series) return;
    const totalEpisodes = series.total_episodes || 0;
    const overallProgress = totalEpisodes > 0 ? (watchedCount / totalEpisodes) * 100 : 0;
    const progressBar = DOM.seriesViewSection.querySelector<HTMLElement>('.v2-progress-bar');
    const progressText = DOM.seriesViewSection.querySelector<HTMLDivElement>('.v2-progress-text');
    if (progressBar) progressBar.style.width = `${overallProgress}%`;
    if (progressText) progressText.innerHTML = `<span>${Math.round(overallProgress)}%</span><span>${watchedCount} / ${totalEpisodes} episódios</span>`;
}

export function updateSeasonProgressUI(seriesId: number, seasonNumber: number) {
    const seasonDetailsElement = DOM.seriesViewSection.querySelector(`.season-details[data-season-number="${seasonNumber}"]`);
    if (!seasonDetailsElement) return;
    const totalSeasonEpisodes = parseInt((seasonDetailsElement as HTMLElement).dataset.episodeCount!, 10);
    if (isNaN(totalSeasonEpisodes) || totalSeasonEpisodes === 0) return;
    const episodeMap = S.getDetailViewData().episodeMap;
    const watchedSeriesEpisodes = S.watchedState[seriesId] || [];
    const watchedSeasonEpisodesCount = watchedSeriesEpisodes.filter(epId => episodeMap[epId] === seasonNumber).length;
    const progress = (watchedSeasonEpisodesCount / totalSeasonEpisodes) * 100;
    const progressBar = seasonDetailsElement.querySelector<HTMLDivElement>('.season-progress-wrapper .progress-bar');
    const percentageText = seasonDetailsElement.querySelector<HTMLSpanElement>('.season-progress-wrapper .season-progress-percentage');
    const counterText = seasonDetailsElement.querySelector<HTMLSpanElement>('.season-progress-wrapper .season-episode-counter');
    if (progressBar && percentageText && counterText) {
        (progressBar as HTMLElement).style.width = `${progress}%`;
        progressBar.className = `progress-bar ${progress === 100 ? 'complete' : 'in-progress'}`;
        percentageText.textContent = `${Math.round(progress)}%`;
        counterText.textContent = `${watchedSeasonEpisodesCount}/${totalSeasonEpisodes}`;
    }
    const markSeasonBtn = seasonDetailsElement.querySelector<HTMLButtonElement>('.mark-season-seen-btn');
    if (markSeasonBtn) {
        const isSeasonComplete = Math.round(progress) >= 100;
        const icon = markSeasonBtn.querySelector<HTMLElement>('i');
        markSeasonBtn.classList.toggle('fully-watched', isSeasonComplete);
        markSeasonBtn.title = isSeasonComplete ? 'Desmarcar Temporada' : 'Marcar Temporada Como Vista';
        if (icon) icon.className = isSeasonComplete ? 'fas fa-check-square' : 'far fa-square';
    }
}

type StatsMediaContext = 'series' | 'movie' | 'book' | 'all';
type StatsTertiaryMode = 'duration' | 'percent';

type StatsUiMeta = {
    sectionTitle: string;
    primaryLabel: string;
    secondaryLabel: string;
    tertiaryLabel: string;
    doughnutTitle: string;
    genresTitle: string;
    yearsTitle: string;
    topRatedTitle: string;
    topRatedEmptyMessage: string;
    noRatedAtValueMessage: string;
    viewAllRatingsLabel: string;
    ratingSingular: string;
    ratingPlural: string;
    doughnutPendingLabel: string;
    doughnutConsumedLabel: string;
    doughnutCenterLabel: string;
    genreDatasetLabel: string;
    yearDatasetLabel: string;
    tertiaryMode: StatsTertiaryMode;
};

type StatsSummary = {
    context: StatsMediaContext;
    meta: StatsUiMeta;
    totalItems: number;
    inProgressItems: number;
    completedItems: number;
    activeItems: number;
    consumedUnits: number;
    pendingUnits: number;
    totalTimeMinutes: number;
    averageProgressPercent: number;
    primaryValue: number;
    secondaryValue: number;
    tertiaryValue: number;
};

function getStatsMediaContext(): StatsMediaContext {
    if (scopedStatsMediaType === 'series' || scopedStatsMediaType === 'movie' || scopedStatsMediaType === 'book') {
        return scopedStatsMediaType;
    }
    return 'all';
}

function getStatsUiMeta(context: StatsMediaContext): StatsUiMeta {
    if (context === 'movie') {
        return {
            sectionTitle: 'Estatísticas de Filmes',
            primaryLabel: 'Filmes Vistos',
            secondaryLabel: 'Filmes por Ver',
            tertiaryLabel: 'Tempo de Cinema',
            doughnutTitle: 'Filmes Vistos vs. Por Ver',
            genresTitle: 'Top Géneros de Filmes',
            yearsTitle: 'Filmes por Ano de Lançamento',
            topRatedTitle: 'Os Meus Filmes Favoritos',
            topRatedEmptyMessage: 'Ainda não avaliou nenhum filme.',
            noRatedAtValueMessage: 'Nenhum filme com esta classificação.',
            viewAllRatingsLabel: 'Ver Todas as Avaliações',
            ratingSingular: 'Filme',
            ratingPlural: 'Filmes',
            doughnutPendingLabel: 'Por Ver',
            doughnutConsumedLabel: 'Vistos',
            doughnutCenterLabel: 'Filmes Ativos',
            genreDatasetLabel: 'Nº de Filmes',
            yearDatasetLabel: 'Nº de Filmes',
            tertiaryMode: 'duration',
        };
    }
    if (context === 'book') {
        return {
            sectionTitle: 'Estatísticas de Livros',
            primaryLabel: 'Livros Concluídos',
            secondaryLabel: 'Livros por Ler',
            tertiaryLabel: 'Progresso Médio',
            doughnutTitle: 'Livros Concluídos vs. Por Ler',
            genresTitle: 'Top Géneros de Livros',
            yearsTitle: 'Livros por Ano de Publicação',
            topRatedTitle: 'Os Meus Livros Favoritos',
            topRatedEmptyMessage: 'Ainda não avaliou nenhum livro.',
            noRatedAtValueMessage: 'Nenhum livro com esta classificação.',
            viewAllRatingsLabel: 'Ver Todas as Avaliações',
            ratingSingular: 'Livro',
            ratingPlural: 'Livros',
            doughnutPendingLabel: 'Por Ler',
            doughnutConsumedLabel: 'Concluídos',
            doughnutCenterLabel: 'Livros Ativos',
            genreDatasetLabel: 'Nº de Livros',
            yearDatasetLabel: 'Nº de Livros',
            tertiaryMode: 'percent',
        };
    }
    if (context === 'all') {
        return {
            sectionTitle: 'Estatísticas Gerais',
            primaryLabel: 'Itens Concluídos',
            secondaryLabel: 'Itens por Concluir',
            tertiaryLabel: 'Progresso Médio',
            doughnutTitle: 'Concluídos vs. Por Concluir',
            genresTitle: 'Top Géneros na Biblioteca',
            yearsTitle: 'Conteúdos por Ano de Lançamento',
            topRatedTitle: 'Os Meus Favoritos',
            topRatedEmptyMessage: 'Ainda não avaliou conteúdos.',
            noRatedAtValueMessage: 'Nenhum conteúdo com esta classificação.',
            viewAllRatingsLabel: 'Ver Todas as Avaliações',
            ratingSingular: 'Item',
            ratingPlural: 'Itens',
            doughnutPendingLabel: 'Por Concluir',
            doughnutConsumedLabel: 'Concluídos',
            doughnutCenterLabel: 'Itens Ativos',
            genreDatasetLabel: 'Nº de Itens',
            yearDatasetLabel: 'Nº de Itens',
            tertiaryMode: 'percent',
        };
    }
    return {
        sectionTitle: 'Estatísticas de Séries',
        primaryLabel: 'Episódios Vistos',
        secondaryLabel: 'Episódios por Ver',
        tertiaryLabel: 'Tempo na TV',
        doughnutTitle: 'Episódios Vistos vs. Por Ver',
        genresTitle: 'Top Géneros na Biblioteca',
        yearsTitle: 'Séries por Ano de Lançamento',
        topRatedTitle: 'As Minhas Séries Favoritas',
        topRatedEmptyMessage: 'Ainda não avaliou nenhuma série.',
        noRatedAtValueMessage: 'Nenhuma série com esta classificação.',
        viewAllRatingsLabel: 'Ver Todas as Avaliações',
        ratingSingular: 'Série',
        ratingPlural: 'Séries',
        doughnutPendingLabel: 'Por Ver',
        doughnutConsumedLabel: 'Vistos',
        doughnutCenterLabel: 'Séries Ativas',
        genreDatasetLabel: 'Nº de Séries',
        yearDatasetLabel: 'Nº de Séries',
        tertiaryMode: 'duration',
    };
}

function getContextItems(context: StatsMediaContext): Series[] {
    const allItems = [...S.myWatchlist, ...S.myArchive];
    if (context === 'all') return allItems;
    return allItems.filter((item) => (item.media_type || 'series') === context);
}

function buildStatsSummary(): StatsSummary {
    const context = getStatsMediaContext();
    const meta = getStatsUiMeta(context);
    const items = getContextItems(context);

    let completedItems = 0;
    let inProgressItems = 0;
    let consumedUnits = 0;
    let pendingUnits = 0;
    let totalTimeMinutes = 0;
    let progressSum = 0;

    items.forEach((item) => {
        const mediaType = item.media_type || 'series';
        const isArchived = S.myArchive.some((archived) => archived.media_type === mediaType && archived.id === item.id);

        if (mediaType === 'series') {
            const watchedCount = S.watchedState[item.id]?.length || 0;
            const totalEpisodes = item.total_episodes || 0;
            const episodeProgress = totalEpisodes > 0 ? Math.max(0, Math.min(100, (watchedCount / totalEpisodes) * 100)) : 0;
            const isCompleted = isArchived || (totalEpisodes > 0 && watchedCount >= totalEpisodes);

            progressSum += isCompleted ? 100 : episodeProgress;
            if (episodeProgress > 0 && episodeProgress < 100) inProgressItems += 1;
            if (isCompleted) completedItems += 1;

            totalTimeMinutes += watchedCount * (item.episode_run_time || 30);

            if (context === 'series') {
                consumedUnits += watchedCount;
                pendingUnits += Math.max(totalEpisodes - watchedCount, 0);
            } else {
                if (isCompleted) consumedUnits += 1;
                else pendingUnits += 1;
            }
            return;
        }

        const progress = isArchived ? 100 : getMediaProgressPercent(item);
        const isCompleted = isArchived || progress >= 100;
        progressSum += isCompleted ? 100 : progress;
        if (progress > 0 && progress < 100) inProgressItems += 1;
        if (isCompleted) completedItems += 1;

        if (isCompleted) consumedUnits += 1;
        else pendingUnits += 1;

        if (mediaType === 'movie') {
            const runtime = typeof item.episode_run_time === 'number' && item.episode_run_time > 0 ? item.episode_run_time : 0;
            totalTimeMinutes += Math.round(runtime * (Math.max(0, Math.min(100, progress)) / 100));
        }
    });

    const totalItems = items.length;
    const activeItems = inProgressItems + completedItems;
    const averageProgressPercent = totalItems > 0 ? Math.round(progressSum / totalItems) : 0;
    const primaryValue = context === 'series' ? consumedUnits : completedItems;
    const secondaryValue = context === 'series' ? pendingUnits : Math.max(totalItems - completedItems, 0);
    const tertiaryValue = meta.tertiaryMode === 'duration' ? totalTimeMinutes : averageProgressPercent;

    return {
        context,
        meta,
        totalItems,
        inProgressItems,
        completedItems,
        activeItems,
        consumedUnits: Math.max(0, consumedUnits),
        pendingUnits: Math.max(0, pendingUnits),
        totalTimeMinutes: Math.max(0, totalTimeMinutes),
        averageProgressPercent: Math.max(0, Math.min(100, averageProgressPercent)),
        primaryValue: Math.max(0, primaryValue),
        secondaryValue: Math.max(0, secondaryValue),
        tertiaryValue: Math.max(0, tertiaryValue),
    };
}

function applyStatsLabels(summary: StatsSummary): void {
    const sectionTitle = document.getElementById('stats-section-title');
    const primaryLabel = document.getElementById('stats-primary-label');
    const secondaryLabel = document.getElementById('stats-secondary-label');
    const tertiaryLabel = document.getElementById('stats-tertiary-label');
    const doughnutTitle = document.getElementById('stats-doughnut-title');
    const genresTitle = document.getElementById('stats-genres-title');
    const yearsTitle = document.getElementById('stats-years-title');
    const topRatedTitle = document.getElementById('stats-top-rated-title');

    if (sectionTitle) sectionTitle.innerHTML = `<i class="fas fa-chart-pie"></i> ${summary.meta.sectionTitle}`;
    if (primaryLabel) primaryLabel.textContent = summary.meta.primaryLabel;
    if (secondaryLabel) secondaryLabel.textContent = summary.meta.secondaryLabel;
    if (tertiaryLabel) tertiaryLabel.textContent = summary.meta.tertiaryLabel;
    if (doughnutTitle) doughnutTitle.textContent = summary.meta.doughnutTitle;
    if (genresTitle) genresTitle.textContent = summary.meta.genresTitle;
    if (yearsTitle) yearsTitle.textContent = summary.meta.yearsTitle;
    if (topRatedTitle) topRatedTitle.textContent = summary.meta.topRatedTitle;
}

export function updateKeyStats(animate = false): StatsSummary {
    const summary = buildStatsSummary();
    applyStatsLabels(summary);

    if (animate) {
        animateValue(DOM.statWatchedEpisodes, 0, summary.primaryValue, 3000);
        animateValue(DOM.statUnwatchedEpisodes, 0, summary.secondaryValue, 3000);
        if (summary.meta.tertiaryMode === 'duration') {
            animateDuration(DOM.statWatchTime, 0, summary.tertiaryValue, 3000);
        } else {
            DOM.statWatchTime.textContent = `${Math.round(summary.tertiaryValue)}%`;
        }
    } else {
        DOM.statWatchedEpisodes.textContent = summary.primaryValue.toLocaleString('pt-PT');
        DOM.statUnwatchedEpisodes.textContent = summary.secondaryValue.toLocaleString('pt-PT');
        if (summary.meta.tertiaryMode === 'duration') {
            DOM.statWatchTime.innerHTML = formatDuration(summary.tertiaryValue, true);
        } else {
            DOM.statWatchTime.textContent = `${Math.round(summary.tertiaryValue)}%`;
        }
    }

    return summary;
}

function getChartColors() {
    const styles = getComputedStyle(document.body);
    const primaryAccent = styles.getPropertyValue('--primary-accent').trim();
    const secondaryAccent = styles.getPropertyValue('--secondary-accent').trim();
    return {
        textColor: styles.getPropertyValue('--text-secondary').trim(),
        textPrimaryColor: styles.getPropertyValue('--text-primary').trim(),
        cardBg: styles.getPropertyValue('--bg-card').trim(),
        gridColor: styles.getPropertyValue('--chart-grid-color').trim(),
        primaryAccent: primaryAccent,
        primaryAccentTransparent: `rgba(${hexToRgb(primaryAccent)}, 0.7)`,
        primaryAccentLine: `rgba(${hexToRgb(primaryAccent)}, 0.2)`,
        secondaryAccent: secondaryAccent,
        secondaryAccentTransparent: `rgba(${hexToRgb(secondaryAccent)}, 0.8)`,
    };
}

function renderWatchedUnwatchedChart(stats: StatsSummary) {
    const canvas = document.getElementById('watched-unwatched-chart') as HTMLCanvasElement;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const watchedCount = stats.consumedUnits;
    const unwatchedCount = stats.pendingUnits;
    const colors = getChartColors();
    const isMobile = window.innerWidth <= 768;
    
    if (isMobile) {
        // Em mobile, a altura é controlada pelo CSS.
    }

    // Lógica para garantir que a fatia mais pequena é sempre visível
    const total = watchedCount + unwatchedCount;
    const minAngle = 0.1; // Ângulo mínimo em radianos para a fatia mais pequena
    let borderWidths = [1, 1];
    if (total > 0) {
        const unwatchedRatio = unwatchedCount / total;
        if (unwatchedRatio > 0 && unwatchedRatio < minAngle / (2 * Math.PI)) {
            borderWidths = [15, 1]; // Aumenta a borda da fatia "Por Ver"
        }
    }
    
    if (S.charts.watchedUnwatched) {
        S.charts.watchedUnwatched.destroy();
    }

    if (ctx) S.charts.watchedUnwatched = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: [stats.meta.doughnutPendingLabel, stats.meta.doughnutConsumedLabel],
            datasets: [{ data: [unwatchedCount, watchedCount], backgroundColor: [colors.secondaryAccentTransparent, colors.primaryAccentTransparent.replace('0.7', '0.8')], borderColor: colors.cardBg, borderWidth: borderWidths, borderAlign: 'inner', hoverOffset: 8 }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: !isMobile,
            aspectRatio: isMobile ? 1 : 2, // Força um círculo perfeito em mobile, mantém o rácio de desktop
            cutout: '60%',
            rotation: 180,
            animation: { duration: 1500 },
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        color: colors.textColor,
                        font: { family: "'Rajdhani', sans-serif" },
                        usePointStyle: true,
                        pointStyle: 'circle'
                    }
                } as any,
                doughnutCenterText: { animatedValue: 0 }
            }
        },
        plugins: [{
            id: 'doughnutCenterText',
            afterDraw: (chart) => {
                const chartCtx = chart.ctx;
                const { width, height } = chart;
                const centerX = width / 2;
                const centerY = height / 2;
                const animatedValue = chart.options.plugins?.doughnutCenterText?.animatedValue ?? 0;
                const totalSeriesText = String(Math.floor(animatedValue));
                chartCtx.font = `700 1.8rem ${getComputedStyle(document.body).getPropertyValue('--font-mono').trim()}`;
                chartCtx.textAlign = 'center';
                chartCtx.textBaseline = 'middle';
                chartCtx.fillStyle = colors.textPrimaryColor;
                chartCtx.fillText(totalSeriesText, centerX, centerY - 12);
                chartCtx.font = `600 0.7rem ${getComputedStyle(document.body).getPropertyValue('--font-main').trim()}`;
                chartCtx.fillStyle = colors.textColor;
                chartCtx.fillText(stats.meta.doughnutCenterLabel, centerX, centerY + 12);
            }
        }]
    });

    const chart = S.charts.watchedUnwatched;
    const end = stats.activeItems;
    if (end === 0) {
        chart.options.plugins.doughnutCenterText.animatedValue = end;
        chart.update('none');
        return;
    }
    let startTime: number | null = null;
    function step(timestamp: number) {
        if (!startTime) startTime = timestamp;
        const progress = Math.min((timestamp - startTime) / 3000, 1);
        chart.options.plugins.doughnutCenterText.animatedValue = progress * end;
        chart.update('none');
        if (progress < 1) window.requestAnimationFrame(step);
    }
    window.requestAnimationFrame(step);
}


function renderGenresChart(stats: StatsSummary) {
    const canvas = document.getElementById('genres-chart') as HTMLCanvasElement | null;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const colors = getChartColors();
    const allSeries = getContextItems(stats.context);
    const genreCounts: Record<string, number> = {};
    allSeries.forEach(series => {
        if (!Array.isArray(series.genres)) return;
        series.genres.forEach((genre: Genre) => {
            const translatedName = translateGenreName(genre.name) || genre.name;
            if (!translatedName) return;
            genreCounts[translatedName] = (genreCounts[translatedName] || 0) + 1;
        });
    });
    const sortedGenres = Object.entries(genreCounts).sort(([, a], [, b]) => b - a);
    const labels = sortedGenres.map(([name]) => name);
    const data = sortedGenres.map(([, count]) => count);
    const isMobile = window.innerWidth <= 768;

    if (isMobile) {
        // Em mobile, calcula uma altura dinâmica para o canvas para que todas as barras caibam.
        // O CSS irá controlar o scroll se o canvas ficar muito alto.
        const dynamicHeight = Math.max(250, labels.length * 32 + 60); // 32px por barra + padding
        canvas.style.height = `${dynamicHeight}px`;
    } else {
        canvas.style.height = '';
    }
    const backgroundColors = labels.map((_, index) =>
        index % 2 === 0 ? colors.primaryAccentTransparent : colors.secondaryAccentTransparent
    );
    const borderColors = labels.map((_, index) =>
        index % 2 === 0 ? colors.primaryAccent : colors.secondaryAccent
    );
    
    if (S.charts.genresChart) {
        S.charts.genresChart.destroy();
    }
    if (ctx) {
        S.charts.genresChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels,
                datasets: [{
                    label: stats.meta.genreDatasetLabel,
                    data,
                    backgroundColor: backgroundColors,
                    borderColor: borderColors,
                    borderWidth: 1,
                    hoverBackgroundColor: backgroundColors,
                    hoverBorderColor: borderColors
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: !isMobile,
                plugins: { legend: { display: false } },
                scales: {
                    x: {
                        beginAtZero: true,
                        ticks: { color: colors.textColor, precision: 0 },
                        grid: { color: colors.gridColor }
                    },
                    y: {
                        ticks: {
                            color: colors.textColor,
                            autoSkip: false,
                            maxRotation: 0,
                            minRotation: 0
                        },
                        grid: { display: false }
                    }
                }
            } as any
        });
    }
}

function renderAiredYearsChart(stats: StatsSummary) {
    const canvas = document.getElementById('aired-years-chart') as HTMLCanvasElement | null;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const colors = getChartColors();
    const isMobile = window.innerWidth <= 768;

    if (isMobile) {
        // Em mobile, a altura é controlada pelo CSS.
    }
    const allSeries = getContextItems(stats.context);
    const yearCounts: { [key: number]: number } = {};
    allSeries.forEach(series => {
        if (series.first_air_date) {
            const year = new Date(series.first_air_date).getFullYear();
            if (!isNaN(year)) yearCounts[year] = (yearCounts[year] || 0) + 1;
        }
    });
    const sortedYears = Object.entries(yearCounts).sort((a, b) => Number(a[0]) - Number(b[0]));
    const labels = sortedYears.map(entry => entry[0]);
    const data = sortedYears.map(entry => entry[1]);

    if (S.charts.airedYears) {
        S.charts.airedYears.destroy();
    }
    if (ctx) {
        S.charts.airedYears = new Chart(ctx, {
        type: 'line',
        data: { 
            labels, 
            datasets: [{ 
                label: stats.meta.yearDatasetLabel,
                data,
                fill: true,
                backgroundColor: colors.primaryAccentLine,
                borderColor: colors.primaryAccent,
                tension: isMobile ? 0 : 0.3 // Remove a curvatura em mobile para garantir que a linha é desenhada
            }] 
        },
        options: { 
            responsive: true, 
            maintainAspectRatio: !isMobile,
            plugins: { legend: { display: false } },
            scales: { 
                x: {
                    ticks: { 
                        color: colors.textColor, 
                        autoSkip: isMobile ? false : true,
                        font: { size: isMobile ? 9 : 12 } // Reduz o tamanho da fonte em mobile
                    },
                    grid: { color: colors.gridColor }
                },
                y: { beginAtZero: true, ticks: { color: colors.textColor, precision: 0 }, grid: { color: colors.gridColor } } 
            } 
        } as any
    });
    }
}

function renderTopRatedSeries(stats: StatsSummary) {
    const container = document.getElementById('top-rated-series-list');
    if (!container) return;
    const existingBtn = container.parentElement?.querySelector('.view-all-btn');
    if (existingBtn) existingBtn.remove();
    const allSeries = getContextItems(stats.context);
    const ratedSeries: (Series & { userRating: number })[] = allSeries.map(series => {
        const userRating = getMediaRating(series);
        if (userRating > 0) return { ...series, userRating };
        return null;
    }).filter((s): s is Series & { userRating: number } => s !== null);
    ratedSeries.sort((a, b) => (b.userRating ?? 0) - (a.userRating ?? 0) || a.name.localeCompare(b.name));
    const topRated = ratedSeries.slice(0, 10);
    container.innerHTML = '';
    if (topRated.length === 0) {
        container.innerHTML = `<p style="text-align: center; color: var(--text-secondary); padding: 2rem 0;">${stats.meta.topRatedEmptyMessage}</p>`;
        return;
    }
    topRated.forEach(series => {
        const posterPath = buildPosterUrl(
            series?.poster_path,
            'w92',
            '/placeholders/poster.svg'
        );
        const itemElement = el('div', { class: 'top-rated-item', 'data-series-id': String(series?.id), 'data-media-type': series.media_type || 'series', title: `Ver detalhes de ${series?.name}` }, [
            createPosterImage(
                posterPath,
                `Poster de ${series?.name}`,
                'top-rated-item-poster',
                '/placeholders/poster.svg'
            ),
            el('div', { class: 'top-rated-item-info' }, [el('p', { text: series?.name })]),
            el('div', { class: 'top-rated-item-rating' }, [el('i', { class: 'fas fa-star' }), el('span', { text: String(series?.userRating) })])
        ]);
        container.appendChild(itemElement);
    });
    if (ratedSeries.length > 10 && container.parentElement) {
        container.parentElement.appendChild(el('button', { class: 'view-all-btn', text: stats.meta.viewAllRatingsLabel }));
    }
}

function renderRatingsSummary() {
    const container = document.getElementById('ratings-summary-list');
    if (!container) return;
    const stats = buildStatsSummary();
    const allSeries: Series[] = getContextItems(stats.context);
    const ratingsMap: { [key: number]: number } = {};
    allSeries.forEach(series => {
        const rating = getMediaRating(series);
        if (rating && rating > 0) {
            if (!ratingsMap[rating]) ratingsMap[rating] = 0;
            ratingsMap[rating]++;
        }
    });
    container.innerHTML = '';
    let hasRatings = false;
    for (let i = 10; i >= 1; i--) {
        if (ratingsMap[i]) {
            hasRatings = true;
            const count = String(ratingsMap[i]);
            const itemElement = el('div', { class: 'rating-summary-item', 'data-rating': String(i) }, [
                el('div', { class: 'rating-summary-item-label' }, [el('i', { class: 'fas fa-star' }), el('span', { text: `${i} Estrela${i > 1 ? 's' : ''} (${stats.meta.ratingPlural})` })]),
                el('div', { class: 'rating-summary-item-count', text: count })
            ]);
            container.appendChild(itemElement);
        }
    }
    if (!hasRatings) {
        container.innerHTML = `<p style="text-align: center; color: var(--text-secondary); padding: 2rem 0;">${stats.meta.topRatedEmptyMessage}</p>`;
    }
}

function renderRatedSeriesByRating(rating: number) {
    const container = DOM.seriesByRatingModalResults;
    container.innerHTML = '';
    const stats = buildStatsSummary();
    const allSeries = getContextItems(stats.context);
    const ratedSeries = allSeries.filter(series => getMediaRating(series) === rating).sort((a, b) => a.name.localeCompare(b.name));
    if (ratedSeries.length === 0) {
        container.innerHTML = `<p style="text-align: center; color: var(--text-secondary); padding: 2rem 0;">${stats.meta.noRatedAtValueMessage}</p>`;
        return;
    }
    ratedSeries.forEach(series => {
        const posterPath = buildPosterUrl(
            series.poster_path,
            'w92',
            '/placeholders/poster.svg'
        );
        const itemElement = el('div', { class: 'top-rated-item', 'data-series-id': String(series.id), 'data-media-type': series.media_type || 'series', title: `Ver detalhes de ${series.name}` }, [
            createPosterImage(
                posterPath,
                `Poster de ${series.name}`,
                'top-rated-item-poster',
                '/placeholders/poster.svg'
            ),
            el('div', { class: 'top-rated-item-info' }, [el('p', { text: series.name })]),
            el('div', { class: 'top-rated-item-rating' }, [el('i', { class: 'fas fa-star' }), el('span', { text: rating })])
        ]);
        container.appendChild(itemElement);
    });
}

export function renderStatistics(stats: StatsSummary) {
    Object.values(S.charts).forEach(chart => {
        if (chart instanceof Chart) chart.destroy();
    });
    S.setCharts({});
    renderWatchedUnwatchedChart(stats);
    renderGenresChart(stats);
    renderAiredYearsChart(stats);
    renderTopRatedSeries(stats);
}

export function performModalLibrarySearch() {
    const searchTerm = DOM.librarySearchModalInput.value.toLowerCase().trim();
    DOM.librarySearchModalResults.innerHTML = '';
    if (searchTerm.length < 2) {
        DOM.librarySearchModalResults.innerHTML = searchTerm.length === 0 ? '<p>Comece a escrever para pesquisar na sua biblioteca.</p>' : '<p>Continue a escrever...</p>';
        return;
    }
    const allSeries = [...S.myWatchlist, ...S.myArchive];
    const filteredSeries = allSeries.filter(series => series.name.toLowerCase().includes(searchTerm));
    if (filteredSeries.length === 0) {
        DOM.librarySearchModalResults.innerHTML = '<p>Nenhum conteúdo encontrado.</p>';
        return;
    }
    filteredSeries.sort((a, b) => a.name.localeCompare(b.name));
    filteredSeries.forEach(series => {
        const posterPath = buildPosterUrl(
            series.poster_path,
            'w92',
            '/placeholders/poster.svg'
        );
        const mediaType = series.media_type || 'series';
        const mediaTypeLabel = getMediaTypeLabel(mediaType);
        const item = el('div', { class: 'library-search-result-item', 'data-series-id': String(series.id), 'data-media-type': mediaType }, [
            createPosterImage(
                posterPath,
                `Poster de ${series.name}`,
                '',
                '/placeholders/poster.svg'
            ),
            el('p', {}, [
                series.name,
                mediaType !== 'series' ? ' ' : null,
                mediaType !== 'series' ? el('span', { class: getMediaTypeChipClass(mediaType), text: mediaTypeLabel }) : null,
            ])
        ]);
        item.addEventListener('click', () => {
            document.dispatchEvent(new CustomEvent('display-media-details', { detail: { mediaType, mediaId: series.id } }));
            closeLibrarySearchModal();
        });
        DOM.librarySearchModalResults.appendChild(item);
    });
}

export function renderStars(container: HTMLElement, rating: number) {
    const allStars = container.querySelectorAll('.star-container');
    allStars.forEach(s => {
        const starValue = parseInt((s as HTMLElement).dataset.value!, 10);
        const icon = s.querySelector('.star-icon') as HTMLElement;
        icon.classList.toggle('fas', starValue <= rating);
        icon.classList.toggle('far', starValue > rating);
    });
}

/**
 * Marca um botão como "adicionado", desativando-o e mudando o seu ícone e texto.
 * @param button O elemento do botão a ser marcado.
 * @param text O texto a ser exibido no botão (opcional).
 */
export function markButtonAsAdded(button: HTMLButtonElement, text: string = 'Adicionado') {
    button.disabled = true;
    button.classList.add('added');
    button.title = 'Adicionado à Biblioteca';
    button.setAttribute('aria-label', 'Adicionado à Biblioteca');
    const isIconOnly = button.classList.contains('icon-only');
    button.innerHTML = isIconOnly ? '<i class="fas fa-check"></i>' : `<i class="fas fa-check"></i> ${text}`;
}
