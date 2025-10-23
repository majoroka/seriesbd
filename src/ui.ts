import { el, hexToRgb, getTranslatedSeasonName, formatHoursMinutes, formatCertification, animateValue, animateDuration, formatDuration, translateGenreName } from './utils';
import * as DOM from './dom';
import * as S from './state';
import Chart, { ChartType } from 'chart.js/auto';
import { Series, TMDbSeriesDetails, TMDbSeason, TMDbCredits, TraktData, TraktSeason, Episode, Genre } from './types';

declare module 'chart.js' {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    interface PluginOptionsByType<TType extends ChartType> {
        doughnutCenterText?: {
            animatedValue: number;
        };
    }
}

let confirmationResolve: (value: boolean) => void;

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
        DOM.themeToggleBtn.innerHTML = theme === 'light' ? '<i class="fas fa-moon"></i>' : '<i class="fas fa-sun"></i>';
        DOM.themeToggleBtn.title = theme === 'light' ? 'Mudar para Tema Escuro' : 'Mudar para Tema Claro';
    }
    const statsSection = document.getElementById('stats-section');
    if (statsSection && statsSection.style.display !== 'none') {
        requestAnimationFrame(() => {
            const stats = updateKeyStats();
            renderStatistics(stats);
        });
    }
}

// Modal Functions
export function openEpisodeModal(title: string, overview: string, imageUrl: string) {
    DOM.modalTitle.textContent = title;
    DOM.modalSynopsis.textContent = overview;
    DOM.modalImage.src = imageUrl;
    DOM.episodeModal.style.display = 'flex';
    setTimeout(() => DOM.episodeModal.classList.add('visible'), 10);
}

export function closeEpisodeModal() {
    DOM.episodeModal.classList.remove('visible');
    setTimeout(() => {
        DOM.episodeModal.style.display = 'none';
        DOM.modalImage.src = '';
        DOM.modalTitle.textContent = '';
        DOM.modalSynopsis.textContent = '';
    }, 300);
}

export function openTrailerModal(videoKey: string) {
    DOM.trailerIframe.src = `https://www.youtube.com/embed/${videoKey}?autoplay=1&rel=0`;
    DOM.trailerModal.style.display = 'flex';
    setTimeout(() => DOM.trailerModal.classList.add('visible'), 10);
}

export function closeTrailerModal() {
    DOM.trailerModal.classList.remove('visible');
    setTimeout(() => {
        DOM.trailerModal.style.display = 'none';
        DOM.trailerIframe.src = '';
    }, 300);
}

export function openLibrarySearchModal() {
    DOM.librarySearchModalInput.value = '';
    DOM.librarySearchModalResults.innerHTML = '<p>Comece a escrever para pesquisar na sua biblioteca.</p>';
    DOM.librarySearchModal.style.display = 'flex';
    setTimeout(() => {
        DOM.librarySearchModal.classList.add('visible');
        DOM.librarySearchModalInput.focus();
    }, 10);
}

export function closeLibrarySearchModal() {
    DOM.librarySearchModal.classList.remove('visible');
    setTimeout(() => DOM.librarySearchModal.style.display = 'none', 300);
}

export function openAllRatingsModal() {
    renderRatingsSummary();
    DOM.allRatingsModal.style.display = 'flex';
    setTimeout(() => DOM.allRatingsModal.classList.add('visible'), 10);
}

export function closeAllRatingsModal() {
    DOM.allRatingsModal.classList.remove('visible');
    setTimeout(() => DOM.allRatingsModal.style.display = 'none', 300);
}

export function openSeriesByRatingModal(rating: number) {
    DOM.seriesByRatingModalTitle.textContent = `Séries com ${rating} Estrela${rating > 1 ? 's' : ''}`;
    renderRatedSeriesByRating(rating);
    DOM.seriesByRatingModal.style.display = 'flex';
    setTimeout(() => DOM.seriesByRatingModal.classList.add('visible'), 10);
}

export function closeSeriesByRatingModal() {
    DOM.seriesByRatingModal.classList.remove('visible');
    setTimeout(() => DOM.seriesByRatingModal.style.display = 'none', 300);
}

export function showNotification(message: string) {
    DOM.notificationMessage.textContent = message;
    DOM.notificationModal.style.display = 'flex';
    setTimeout(() => DOM.notificationModal.classList.add('visible'), 10);
}

export function closeNotificationModal() {
    DOM.notificationModal.classList.remove('visible');
    setTimeout(() => DOM.notificationModal.style.display = 'none', 300);
}

export function showConfirmationModal(message: string): Promise<boolean> {
    DOM.confirmationMessage.textContent = message;
    DOM.confirmationModal.style.display = 'flex';
    setTimeout(() => DOM.confirmationModal.classList.add('visible'), 10);

    return new Promise<boolean>((resolve) => {
        confirmationResolve = resolve;
    });
}

export function closeConfirmationModal(result: boolean) {
    DOM.confirmationModal.classList.remove('visible');
    setTimeout(() => {
        DOM.confirmationModal.style.display = 'none';
    }, 300);
    if (confirmationResolve) {
        confirmationResolve(result);
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
        const posterPath = seriesPoster ? `https://image.tmdb.org/t/p/w92${seriesPoster}` : 'https://via.placeholder.com/45x67.png?text=N/A';
        let episodeNumber = (episode.season_number !== undefined && episode.episode_number !== undefined) ? `S${String(episode.season_number).padStart(2, '0')}E${String(episode.episode_number).padStart(2, '0')}` : '';
        const itemElement = el('div', { class: 'episode-item-small' }, [
            el('img', { src: posterPath, alt: `Poster de ${seriesName}`, class: 'next-aired-poster', loading: 'lazy' }),
            el('span', { class: 'episode-info', text: `${seriesName} ${episodeNumber}` }),
            el('span', { class: 'episode-date', text: formattedDate })
        ]);
        DOM.nextAiredListContainer.appendChild(itemElement);
    });
}

export function renderSearchResults(resultsList: Series[]) {
    DOM.searchResultsContainer.innerHTML = '';
    if (resultsList.length === 0) {
        DOM.searchResultsContainer.appendChild(el('p', { text: 'Nenhuma série encontrada.' }));
        return;
    }
    resultsList.forEach(series => {
        const posterPath = series.poster_path ? `https://image.tmdb.org/t/p/w185${series.poster_path}` : 'https://via.placeholder.com/92x138.png?text=N/A';
        const releaseYear = series.first_air_date ? `(${new Date(series.first_air_date).getFullYear()})` : '';
        const isInLibrary = S.myWatchlist.some(s => s.id === series.id) || S.myArchive.some(s => s.id === series.id);
        
        const actionButtons = isInLibrary 
            ? el('div', { class: 'search-result-actions' }, [el('span', { class: 'in-library-label' }, ['Na Biblioteca ', el('i', { class: 'fas fa-check-circle' })])])
            : el('div', { class: 'search-result-actions' }, [
                el('button', { class: 'v2-action-btn icon-only add-series-quick-btn', 'data-series-id': String(series.id), title: 'Adicionar à Biblioteca' }, [el('i', { class: 'fas fa-plus' })]),
                el('button', { class: 'v2-action-btn icon-only mark-all-seen-quick-btn', 'data-series-id': String(series.id), title: 'Adicionar e Marcar Tudo Como Visto' }, [el('i', { class: 'fas fa-check-double' })])
            ]);

        const item = el('div', { class: 'search-result-item', 'data-series-id': String(series.id) }, [
            el('img', { src: posterPath, alt: `Poster de ${series.name}`, class: 'search-result-poster', loading: 'lazy' }),
            el('div', { class: 'search-result-info' }, [ el('h3', { text: `${series.name} ${releaseYear}` }), el('p', { text: series.overview || 'Sinopse não disponível.' }) ]),
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
        const posterPath = series.poster_path ? `https://image.tmdb.org/t/p/w220_and_h330_face${series.poster_path}` : 'https://via.placeholder.com/150x225.png?text=N/A';
        const releaseDate = series.first_air_date ? new Date(series.first_air_date).toLocaleDateString('pt-PT', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Data desconhecida';
        const voteAverage = (series.vote_average || 0).toFixed(1);
        const releaseYear = series.first_air_date ? `(${new Date(series.first_air_date).getFullYear()})` : '';

        const card = el('div', { class: 'trending-card', 'data-series-id': String(series.id) }, [
            el('div', { class: 'image' }, [
                el('div', { class: 'wrapper' }, [
                    el('img', { loading: 'lazy', class: 'poster', src: posterPath, alt: series.name })
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

        card.addEventListener('click', () => {
            document.dispatchEvent(new CustomEvent('display-series-details', { detail: { seriesId: series.id } }));
        });

        scroller.appendChild(card);
    });
    container.appendChild(scroller);
}

export function renderWatchlist() {
    const viewMode = DOM.watchlistContainer.classList.contains('grid-view') ? 'grid' : 'list';
    DOM.watchlistContainer.innerHTML = '';
    const seriesToWatch = S.myWatchlist.filter(series => !S.watchedState[series.id] || S.watchedState[series.id].length === 0);
    if (seriesToWatch.length === 0) {
        DOM.watchlistContainer.innerHTML = '<p class="empty-list-message">Nenhuma série nova para começar. Adicione séries ou veja o separador "A Ver".</p>';
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
    const seriesInProgress = S.myWatchlist.filter(series => {
        // Uma série está "A Ver" se, e apenas se, tiver pelo menos um episódio visto.
        const hasWatchedEpisodes = S.watchedState[series.id] && S.watchedState[series.id].length > 0;
        return hasWatchedEpisodes;
    });
    if (seriesInProgress.length === 0) {
        DOM.unseenContainer.innerHTML = '<p class="empty-list-message">Nenhuma série em progresso.</p>';
        return;
    }
    seriesInProgress.forEach(series => {
        const seriesItemElement = createSeriesItemElement(series, false, viewMode, true);
        DOM.unseenContainer.appendChild(seriesItemElement);
    });
}

export function renderArchive() {
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
    const viewMode = DOM.allSeriesContainer.classList.contains('grid-view') ? 'grid' : 'list';
    DOM.allSeriesContainer.innerHTML = '';
    const allSeries = [...S.myWatchlist, ...S.myArchive];
    allSeries.sort((a, b) => a.name.localeCompare(b.name));
    updateAllSeriesGenreFilterOptions(allSeries);
    const selectedGenreId = S.allSeriesGenreFilter;
    const filteredSeries = selectedGenreId === 'all'
        ? allSeries
        : allSeries.filter(series => (series.genres || []).some(genre => genre.id === Number(selectedGenreId)));

    if (filteredSeries.length === 0) {
        if (allSeries.length === 0) {
            DOM.allSeriesContainer.innerHTML = '<p class="empty-list-message">Nenhuma série na sua biblioteca. Adicione séries através da pesquisa.</p>';
        } else {
            DOM.allSeriesContainer.innerHTML = '<p class="empty-list-message">Nenhuma série encontrada para o género selecionado.</p>';
        }
        return;
    }

    filteredSeries.forEach(series => {
        const seriesItemElement = createSeriesItemElement(series, true, viewMode, false);
        DOM.allSeriesContainer.appendChild(seriesItemElement);
    });
}

export function renderPopularSeries(seriesList: Series[]) {
    const viewMode = DOM.popularContainer.classList.contains('grid-view') ? 'grid' : 'list';

    if (seriesList.length === 0) {
        DOM.popularContainer.innerHTML = '<p class="empty-list-message">Nenhuma série popular encontrada.</p>';
        return;
    }

    seriesList.forEach((series, index) => {
        const seriesItemElement = createSeriesItemElement(series, false, viewMode, false, true, true, index + 1);
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
    const posterPath = series.poster_path ? `https://image.tmdb.org/t/p/w185${series.poster_path}` : 'https://via.placeholder.com/92x138.png?text=N/A';
    const releaseYear = series.first_air_date ? `(${new Date(series.first_air_date).getFullYear()})` : '';
    const watchedCount = S.watchedState[series.id]?.length || 0;
    const totalEpisodes = series.total_episodes || 0;
    const progressPercentage = totalEpisodes > 0 ? (watchedCount / totalEpisodes) * 100 : 0;
    const isSeriesInProgress = watchedCount > 0 && progressPercentage < 100;

    const unwatchedCount = totalEpisodes > 0 ? totalEpisodes - watchedCount : 0;
    let unwatchedBadge = null;
    // Mostra o badge se a flag `showUnwatchedBadge` estiver ativa (secção "A Ver")
    // OU se a série estiver em progresso (para a secção "Todas").
    if ((showUnwatchedBadge || isSeriesInProgress) && unwatchedCount > 0 && viewMode === 'grid') {
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
        el('img', { src: posterPath, alt: `Poster de ${series.name}`, class: 'watchlist-poster-img', loading: 'lazy' }),
        unwatchedBadge,
        ratingCircle,
    ]);

    let progressElement = null;
    if (!isDiscovery && (watchedCount > 0 || S.myArchive.some(s => s.id === series.id))) {
        let progressBarClass = '';
        if (progressPercentage >= 100) progressBarClass = 'complete';
        else if (progressPercentage > 0) progressBarClass = 'in-progress';
        progressElement = el('div', { class: 'list-item-progress' }, [
            el('div', { class: 'progress-bar-container' }, [el('div', { class: `progress-bar ${progressBarClass}`, style: `width: ${progressPercentage}%;` })]),
            el('span', { text: `${Math.round(progressPercentage)}%` })
        ]);
    } else if (isDiscovery && viewMode === 'list') {
        // Para as secções de descoberta (Populares, Estreias), mostra a avaliação pública em vez do progresso
        const publicRating = (series.vote_average || 0).toFixed(1);
        progressElement = el('div', { class: 'public-rating-in-list' }, [
            el('i', { class: 'fas fa-star' }),
            el('span', { text: publicRating })
        ]);
    }
    let statusElement = null;
    if (showStatus) {
        let statusText = '';
        if (S.myArchive.some(s => s.id === series.id)) statusText = 'Arquivo';
        else if (S.myWatchlist.some(s => s.id === series.id)) statusText = (watchedCount > 0) ? 'A Ver' : 'Quero Ver';
        if (statusText) statusElement = el('span', { class: 'series-status-label', text: statusText });
    }
    const overview = series.overview || 'Sinopse não disponível.';
    const overviewElement = viewMode === 'grid' ? null : el('p', { text: overview });

    // Cria o elemento do título, adicionando o ranking se aplicável
    const titleChildren: (Node | string)[] = [];
    if (rank !== undefined && isDiscovery) {
        titleChildren.push(el('span', { class: 'discovery-rank-text', text: `${rank}.` }));
    }
    titleChildren.push(`${series.name} ${releaseYear}`);
    const titleElement = el('h3', {}, titleChildren);

    const titleInList = viewMode === 'list' ? titleElement : null;
    const statusInList = viewMode === 'list' ? statusElement : null;
    const titleInGrid = viewMode === 'grid' ? titleElement : null;
    const statusInGrid = viewMode === 'grid' ? statusElement : null;
    const watchlistInfo = el('div', { class: 'watchlist-info' }, [
        el('div', { class: 'watchlist-title-wrapper' }, [titleInList, statusInList]),
        progressElement,
        overviewElement,
        titleInGrid,
        statusInGrid
    ]);
    const itemElement = el('div', { class: 'watchlist-item', 'data-series-id': String(series.id) }, [
        posterElement,
        watchlistInfo,
    ]);

    itemElement.addEventListener("click", (e) => {
        const target = e.target;
        if (target instanceof Element && target.closest(".remove-btn")) {
            return; // Ação de remover é tratada no main.ts
        }
        document.dispatchEvent(new CustomEvent("display-series-details", { detail: { seriesId: series.id } }));
    });
    return itemElement;
}

export function renderSeriesDetails(seriesData: TMDbSeriesDetails, allTMDbSeasonsData: TMDbSeason[], creditsData: TMDbCredits, traktSeriesData: TraktData | null, traktSeasonsData: TraktSeason[] | null) {
    const detailSection = DOM.seriesViewSection;
    detailSection.innerHTML = '';
    const backdropPath = seriesData.backdrop_path ? `https://image.tmdb.org/t/p/w1280${seriesData.backdrop_path}` : '';
    const posterPath = seriesData.poster_path ? `https://image.tmdb.org/t/p/w300_and_h450_bestv2${seriesData.poster_path}` : 'https://via.placeholder.com/300x450.png?text=N/A';
    const releaseYear = seriesData.first_air_date ? `(${new Date(seriesData.first_air_date).getFullYear()})` : '';
    const premiereDate = seriesData.first_air_date ? new Date(seriesData.first_air_date).toLocaleDateString('pt-PT') : '';
    const genres = seriesData.genres?.map(g => g.name).join(', ') || '';
    const allEpisodes: Episode[] = allTMDbSeasonsData.flatMap(season => season.episodes);
    const episodesWithRuntime = allEpisodes.filter(ep => ep.runtime && ep.runtime > 0);
    const totalRuntimeMinutes = episodesWithRuntime.reduce((sum, ep) => sum + (ep.runtime ?? 0), 0);
    const averageRuntime = episodesWithRuntime.length > 0 ? Math.round(totalRuntimeMinutes / episodesWithRuntime.length) : (seriesData.episode_run_time?.[0] || 0);
    const runtimeText = averageRuntime > 0 ? `${averageRuntime}m` : '';
    const originalCertification = traktSeriesData?.certification || '';
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
        let statusText = seriesData.status || 'N/A';
        if (seriesData.status === 'Ended') statusText = 'Finalizada';
        else if (seriesData.status === 'Canceled') statusText = 'Cancelada';
        else if (seriesData.status === 'Returning Series') statusText = 'Em Exibição';
        const totalRuntime = formatHoursMinutes(totalRuntimeMinutes);
        return [{ label: 'Status', value: statusText }, { label: 'Transmissão', value: networksElements }, { label: 'Estúdios', value: studiosText }, { label: 'País', value: countries }, { label: 'Idioma Original', value: languages }, { label: 'Duração Total', value: totalRuntime }];
    })();
    const totalEpisodes = seriesData.total_episodes || allTMDbSeasonsData.reduce((acc, season) => acc + (season.episodes?.length || 0), 0);
    const watchedCount = S.watchedState[seriesData.id]?.length || 0;
    const overallProgress = totalEpisodes > 0 ? (watchedCount / totalEpisodes) * 100 : 0;
    const progressHTML = `<div class="v2-overview-progress"><div class="v2-progress-bar-container"><div class="v2-progress-bar" style="width: ${overallProgress}%;"></div></div><div class="v2-progress-text"><span>${Math.round(overallProgress)}%</span><span>${watchedCount} / ${totalEpisodes} episódios</span></div></div>`;
    const tmdbRating = seriesData.vote_average || 0;
    const traktRating = traktSeriesData?.ratings?.rating || 0;
    let ratingsCount = 0;
    if (tmdbRating > 0) ratingsCount++;
    if (traktRating > 0) ratingsCount++;
    const averageRating = ratingsCount > 0 ? (tmdbRating + traktRating) / ratingsCount : 0;
    const tmdbPercent = tmdbRating * 10;
    const traktPercent = traktRating * 10;
    const publicRatingsElement = ratingsCount > 0 ? el('div', { class: 'v2-public-ratings' }, [
        el('p', { class: 'v2-action-label', text: 'Avaliações' }),
        el('div', { class: 'concentric-chart-wrapper' }, [
            el('div', { class: 'concentric-chart' }, [
                el('div', { class: 'chart-ring outer', style: `--progress: ${tmdbPercent}%; --color: var(--primary-accent);` }),
                el('div', { class: 'chart-ring inner', style: `--progress: ${traktPercent}%; --color: var(--secondary-accent);` }),
                el('div', { class: 'chart-center' }, [el('span', { class: 'chart-average', text: averageRating.toFixed(1) })])
            ]),
            el('div', { class: 'chart-legend' }, [
                tmdbRating > 0 ? el('div', { class: 'legend-item' }, [el('span', { class: 'legend-color', style: 'background-color: var(--primary-accent);' }), el('span', { class: 'legend-text', text: 'TMDb:' }), el('strong', { class: 'legend-value', text: tmdbRating.toFixed(1) })]) : null,
                traktRating > 0 ? el('div', { class: 'legend-item' }, [el('span', { class: 'legend-color', style: 'background-color: var(--secondary-accent);' }), el('span', { class: 'legend-text', text: 'Trakt:' }), el('strong', { class: 'legend-value', text: traktRating.toFixed(1) })]) : null
            ])
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
    const finalOverview = tmdbOverview || traktOverview;
    const headerElement = el('div', { class: 'v2-detail-header', style: `background-image: url('${backdropPath}');` }, [
        el('div', { class: 'v2-header-custom-bg' }, [
            el('div', { class: 'v2-header-content' }, [
                el('div', { class: 'v2-poster-wrapper', html: progressHTML }, [el('img', { src: posterPath, alt: `Poster de ${seriesData.name}`, class: 'v2-poster' })]),
                el('div', { class: 'v2-details-wrapper' }, [
                    el('div', { class: 'v2-title' }, [
                        el('div', { class: 'v2-title-text' }, [
                            el('h1', {}, [`${seriesData.name} `, el('span', { class: 'release-year', text: releaseYear })])
                        ]),
                        el('div', { class: 'v2-header-actions' }, [
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
                    el('div', { class: 'v2-overview' }, [el('h3', { text: 'Sinopse' }), el('p', { text: finalOverview || 'Sinopse não disponível.' })]),
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

    const episodeMap: { [key: number]: number } = {};
    allTMDbSeasonsData.forEach(season => {
        if (season.episodes) {
            season.episodes.forEach(episode => {
                episodeMap[episode.id] = season.season_number!;
            });
        }
    });
    detailSection.dataset.episodeMap = JSON.stringify(episodeMap);

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
        ? el('img', { src: `https://image.tmdb.org/t/p/w185${person.profile_path}`, alt: person.name, loading: 'lazy', class: 'v2-person-photo' })
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
        const finalOverview = tmdbOverview || traktOverview;
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
            stillPathSmall = 'https://via.placeholder.com/185x104.png?text=N/A';
            stillPathLarge = 'https://via.placeholder.com/780x439.png?text=N/A';
        }
        const runtimeText = episode.runtime ? `${episode.runtime} min` : 'N/A';
        const episodeElement = el('div', { class: 'episode-item', 'data-series-id': String(seriesId), 'data-episode-id': String(episode.id), 'data-season-number': String(episode.season_number), 'data-title': episode.name, 'data-overview': finalOverview || 'Sinopse não disponível.', 'data-still-path-large': stillPathLarge }, [
            el('img', { src: stillPathSmall, alt: `Imagem do episódio ${episode.episode_number}`, class: 'episode-still', loading: 'lazy' }),
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
    const episodeMap: { [key: number]: number } = JSON.parse(DOM.seriesViewSection.dataset.episodeMap || '{}');
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

export function updateKeyStats(animate = false): { totalSeries: number, activeSeries: number, watchedEpisodes: number, unwatchedEpisodes: number, watchTime: number } {
    const allUserSeries = [...S.myWatchlist, ...S.myArchive];
    let totalWatchedEpisodes = 0;
    let totalEpisodesInLibrary = 0;
    let totalWatchTimeMinutes = 0;
    let activeSeriesCount = 0;
    allUserSeries.forEach(series => {
        const watchedCount = S.watchedState[series.id]?.length || 0;
        const isInArchive = S.myArchive.some(s => s.id === series.id);
        if (watchedCount > 0 || isInArchive) activeSeriesCount++;
        totalWatchedEpisodes += watchedCount;
        totalEpisodesInLibrary += series.total_episodes || 0;
        totalWatchTimeMinutes += watchedCount * (series.episode_run_time || 30);
    });
    const totalUnwatchedEpisodes = totalEpisodesInLibrary - totalWatchedEpisodes;
    if (animate) {
        animateValue(DOM.statWatchedEpisodes, 0, totalWatchedEpisodes, 3000);
        animateValue(DOM.statUnwatchedEpisodes, 0, totalUnwatchedEpisodes > 0 ? totalUnwatchedEpisodes : 0, 3000);
        animateDuration(DOM.statWatchTime, 0, totalWatchTimeMinutes, 3000);
    } else {
        DOM.statWatchedEpisodes.textContent = totalWatchedEpisodes.toLocaleString('pt-PT');
        DOM.statUnwatchedEpisodes.textContent = (totalUnwatchedEpisodes > 0 ? totalUnwatchedEpisodes : 0).toLocaleString('pt-PT');
        DOM.statWatchTime.innerHTML = formatDuration(totalWatchTimeMinutes, true);
    }
    return { totalSeries: allUserSeries.length, activeSeries: activeSeriesCount, watchedEpisodes: totalWatchedEpisodes, unwatchedEpisodes: totalUnwatchedEpisodes > 0 ? totalUnwatchedEpisodes : 0, watchTime: totalWatchTimeMinutes };
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

function renderWatchedUnwatchedChart(stats: { watchedEpisodes: number, unwatchedEpisodes: number, activeSeries: number }) {
    const canvas = document.getElementById('watched-unwatched-chart') as HTMLCanvasElement;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const watchedCount = stats.watchedEpisodes;
    const unwatchedCount = stats.unwatchedEpisodes;
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
            labels: ['Por Ver', 'Vistos'],
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
                chartCtx.fillText('Séries Ativas', centerX, centerY + 12);
            }
        }]
    });

    const chart = S.charts.watchedUnwatched;
    const end = stats.activeSeries;
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


function renderGenresChart() {
    const canvas = document.getElementById('genres-chart') as HTMLCanvasElement | null;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const colors = getChartColors();
    const allSeries = [...S.myWatchlist, ...S.myArchive];
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
                    label: 'Nº de Séries',
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

function renderAiredYearsChart() {
    const canvas = document.getElementById('aired-years-chart') as HTMLCanvasElement | null;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const colors = getChartColors();
    const isMobile = window.innerWidth <= 768;

    if (isMobile) {
        // Em mobile, a altura é controlada pelo CSS.
    }
    const allSeries = [...S.myWatchlist, ...S.myArchive];
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
                label: 'Nº de Séries',
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

function renderTopRatedSeries() {
    const container = document.getElementById('top-rated-series-list');
    if (!container) return;
    const existingBtn = container.parentElement?.querySelector('.view-all-btn');
    if (existingBtn) existingBtn.remove();
    const allSeries = [...S.myWatchlist, ...S.myArchive];
    const ratedSeries: (Series & { userRating: number })[] = allSeries.map(series => {
        const seriesUserData = S.userData[series.id];
        if (seriesUserData && seriesUserData.rating && seriesUserData.rating > 0) return { ...series, userRating: seriesUserData.rating };
        return null;
    }).filter((s): s is Series & { userRating: number } => s !== null);
    ratedSeries.sort((a, b) => (b.userRating ?? 0) - (a.userRating ?? 0) || a.name.localeCompare(b.name));
    const topRated = ratedSeries.slice(0, 10);
    container.innerHTML = '';
    if (topRated.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: var(--text-secondary); padding: 2rem 0;">Ainda não avaliou nenhuma série. Dê uma nota às suas séries para as ver aqui!</p>';
        return;
    }
    topRated.forEach(series => {
        const posterPath = series?.poster_path ? `https://image.tmdb.org/t/p/w92${series.poster_path}` : 'https://via.placeholder.com/40x59.png?text=N/A';
        const itemElement = el('div', { class: 'top-rated-item', 'data-series-id': String(series?.id), title: `Ver detalhes de ${series?.name}` }, [
            el('img', { src: posterPath, alt: `Poster de ${series?.name}`, class: 'top-rated-item-poster', loading: 'lazy' }),
            el('div', { class: 'top-rated-item-info' }, [el('p', { text: series?.name })]),
            el('div', { class: 'top-rated-item-rating' }, [el('i', { class: 'fas fa-star' }), el('span', { text: String(series?.userRating) })])
        ]);
        container.appendChild(itemElement);
    });
    if (ratedSeries.length > 10 && container.parentElement) {
        container.parentElement.appendChild(el('button', { class: 'view-all-btn', text: 'Ver Todas as Avaliações' }));
    }
}

function renderRatingsSummary() {
    const container = document.getElementById('ratings-summary-list');
    if (!container) return;
    const allSeries: Series[] = [...S.myWatchlist, ...S.myArchive];
    const ratingsMap: { [key: number]: number } = {};
    allSeries.forEach(series => {
        const rating = S.userData[series.id]?.rating;
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
                el('div', { class: 'rating-summary-item-label' }, [el('i', { class: 'fas fa-star' }), el('span', { text: `${i} Estrela${i > 1 ? 's' : ''}` })]),
                el('div', { class: 'rating-summary-item-count', text: count })
            ]);
            container.appendChild(itemElement);
        }
    }
    if (!hasRatings) {
        container.innerHTML = '<p style="text-align: center; color: var(--text-secondary); padding: 2rem 0;">Nenhuma série avaliada encontrada.</p>';
    }
}

function renderRatedSeriesByRating(rating: number) {
    const container = DOM.seriesByRatingModalResults;
    container.innerHTML = '';
    const allSeries = [...S.myWatchlist, ...S.myArchive];
    const ratedSeries = allSeries.filter(series => S.userData[series.id]?.rating === rating).sort((a, b) => a.name.localeCompare(b.name));
    if (ratedSeries.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: var(--text-secondary); padding: 2rem 0;">Nenhuma série com esta classificação.</p>';
        return;
    }
    ratedSeries.forEach(series => {
        const posterPath = series.poster_path ? `https://image.tmdb.org/t/p/w92${series.poster_path}` : 'https://via.placeholder.com/40x59.png?text=N/A';
        const itemElement = el('div', { class: 'top-rated-item', 'data-series-id': String(series.id), title: `Ver detalhes de ${series.name}` }, [
            el('img', { src: posterPath, alt: `Poster de ${series.name}`, class: 'top-rated-item-poster', loading: 'lazy' }),
            el('div', { class: 'top-rated-item-info' }, [el('p', { text: series.name })]),
            el('div', { class: 'top-rated-item-rating' }, [el('i', { class: 'fas fa-star' }), el('span', { text: rating })])
        ]);
        container.appendChild(itemElement);
    });
}

export function renderStatistics(stats: { totalSeries: number, activeSeries: number, watchedEpisodes: number, unwatchedEpisodes: number, watchTime: number }) {
    Object.values(S.charts).forEach(chart => {
        if (chart instanceof Chart) chart.destroy();
    });
    S.setCharts({});
    renderWatchedUnwatchedChart(stats);
    renderGenresChart();
    renderAiredYearsChart();
    renderTopRatedSeries();
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
        DOM.librarySearchModalResults.innerHTML = '<p>Nenhuma série encontrada.</p>';
        return;
    }
    filteredSeries.sort((a, b) => a.name.localeCompare(b.name));
    filteredSeries.forEach(series => {
        const posterPath = series.poster_path ? `https://image.tmdb.org/t/p/w92${series.poster_path}` : 'https://via.placeholder.com/40x59.png?text=N/A';
        const item = el('div', { class: 'library-search-result-item', 'data-series-id': String(series.id) }, [
            el('img', { src: posterPath, alt: `Poster de ${series.name}`, loading: 'lazy' }),
            el('p', { text: series.name })
        ]);
        item.addEventListener('click', () => {
            document.dispatchEvent(new CustomEvent('display-series-details', { detail: { seriesId: series.id } }));
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
