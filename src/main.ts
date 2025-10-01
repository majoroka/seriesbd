import './style.css';
import * as C from './constants';
import * as DOM from './dom';
import * as API from './api';
import * as UI from './ui';
import * as S from './state';
import { debounce, exportChartToPNG, exportDataToCSV, processInBatches } from './utils';
import { db } from './db';
import { registerSW } from 'virtual:pwa-register';
import { Series, Episode, TMDbPerson, WatchedStateItem, UserDataItem, TMDbSeriesDetails, KVStoreItem } from './types';

async function addSeriesToWatchlist(series: Series | TMDbSeriesDetails) {
    const isInLibrary = S.myWatchlist.some(s => s.id === series.id) || S.myArchive.some(s => s.id === series.id);
    if (!isInLibrary) {
        // Se já for TMDbSeriesDetails, usa-o, senão, busca os detalhes.
        const details: TMDbSeriesDetails = 'seasons' in series ? series : await API.fetchSeriesDetails(series.id, null);

        const totalEpisodes = details.seasons
            ? details.seasons
                .filter((season) => season.season_number !== 0)
                .reduce((acc, season) => acc + season.episode_count, 0)
            : 0;
        
        const seriesToAdd: Series = {
            ...series, // Copia as propriedades base (id, name, overview, etc.)
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
    } else {
        console.warn('A série já se encontra na biblioteca.');
    }
}

async function addAndMarkAllAsSeen(seriesData: Series | TMDbSeriesDetails) {
    const isInLibrary = S.myWatchlist.some(s => s.id === seriesData.id) || S.myArchive.some(s => s.id === seriesData.id);
    if (isInLibrary) {
        console.warn('A série já se encontra na biblioteca.');
        return;
    }

    // Adiciona a série (a função já busca detalhes se necessário)
    await addSeriesToWatchlist(seriesData);

    // Busca os detalhes completos para obter a lista de episódios
    const fullDetails = await API.fetchSeriesDetails(seriesData.id, null);
    const allSeasons = await Promise.all(fullDetails.seasons.filter(s => s.season_number !== 0).map(s => API.getSeasonDetailsWithCache(fullDetails.id, s.season_number, null)));
    const allEpisodeIds = allSeasons.flatMap(season => season.episodes.map(ep => ep.id));

    if (allEpisodeIds.length > 0) {
        await S.markEpisodesAsWatched(seriesData.id, allEpisodeIds);
        const movedToArchive = await checkSeriesCompletion(seriesData.id); // Move para o arquivo
        if (movedToArchive) {
            UI.updateActiveNavLink('archive-section'); // Ativa o separador "Arquivo"
        }
    }
}

async function removeSeriesFromLibrary(seriesId: number, element: HTMLElement | null) {
    const seriesToRemove = S.getSeries(seriesId);
    const seriesName = seriesToRemove ? seriesToRemove.name : `a série selecionada`;

    if (await UI.showConfirmationModal(`Tem a certeza que quer remover "${seriesName}" da sua biblioteca? Esta ação não pode ser desfeita.`)) {
        const performRemovalLogic = async () => {
            await S.removeSeries(seriesId);
            await updateNextAired();
            UI.renderWatchlist();
            UI.renderArchive();
            UI.renderAllSeries();
            UI.renderUnseen();
            updateGlobalProgress();
            UI.updateKeyStats();
            console.log(`Série ${seriesId} removida da biblioteca.`);
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
    let allUserSeries = [...S.myWatchlist, ...S.myArchive];
    const now = new Date().getTime();
    const oneDay = 24 * 60 * 60 * 1000;

    const seriesToFetch = allUserSeries.filter(series => {
        if (!series._lastUpdated || series._details?.status === 'Ended') return false; // Não busca atualizações para séries terminadas
        const lastUpdatedTime = new Date(series._lastUpdated).getTime();
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
            }).catch(err => {
                console.error(`Falha ao buscar detalhes para ${series.name}`, err);
                // Mesmo em caso de erro, atualiza o timestamp para não tentar novamente de imediato
                series._lastUpdated = new Date().toISOString(); 
            });

        // Processa em lotes para não sobrecarregar a API
        const results = await processInBatches(seriesToFetch, 5, 1000, task);
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
        await processInBatches(justAiredSeriesIds, 5, 1000, refreshTask);
        UI.renderUnseen(); // Re-renderiza a lista "A Ver" para incluir as séries atualizadas
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
        removeBtn?.addEventListener('click', () => removeSeriesFromLibrary(seriesData.id, null), { once: true });
    } else {
        const addToWatchlistBtn = discoverActions.querySelector<HTMLButtonElement>('#add-to-watchlist-btn');
        const addAndMarkAllBtn = discoverActions.querySelector<HTMLButtonElement>('#add-and-mark-all-seen-btn');

        addToWatchlistBtn?.addEventListener('click', () => handleAddSeries(seriesData, addToWatchlistBtn), { once: true });
        addAndMarkAllBtn?.addEventListener('click', () => handleAddAndMarkAllSeen(seriesData, addAndMarkAllBtn), { once: true });
    }
}



async function displaySeriesDetails(seriesId: number) {
    S.resetDetailViewAbortController();
    const signal = S.detailViewAbortController.signal;

    try {
        DOM.seriesViewSection.innerHTML = '<p>A carregar detalhes da série...</p>';
        UI.showSection('series-view-section');
        
        const [seriesData, creditsData, traktSeriesData] = await Promise.all([
            API.fetchSeriesDetails(seriesId, signal),
            API.fetchSeriesCredits(seriesId, signal),
            API.fetchTraktData(seriesId, signal)
        ]);
        const traktId = traktSeriesData?.traktId as number | undefined;
        const seasonsToFetch = seriesData.seasons.filter(s => s.season_number !== 0);
        const seasonPromises = seasonsToFetch.map(s => API.getSeasonDetailsWithCache(seriesId, s.season_number, signal));
        const traktSeasonPromise = API.fetchTraktSeasonsData(traktId, signal);

        const [seasonResults, traktSeasonsData] = await Promise.all([
            Promise.allSettled(seasonPromises),
            traktSeasonPromise
        ]);
        const allTMDbSeasonsData = seasonResults.filter((res): res is PromiseFulfilledResult<any> => res.status === 'fulfilled').map(res => res.value);

        const allEpisodesForSeries = allTMDbSeasonsData.flatMap(season => season.episodes);
        DOM.seriesViewSection.dataset.allEpisodes = JSON.stringify(allEpisodesForSeries.map((ep: any) => ({ id: ep.id, season_number: ep.season_number, episode_number: ep.episode_number })));
        
        const episodeToSeasonMap: { [key: number]: number } = {};
        allTMDbSeasonsData.forEach(season => {
            season.episodes.forEach((episode: Episode) => {
                episodeToSeasonMap[episode.id] = season.season_number!;
            });
        });
        DOM.seriesViewSection.dataset.episodeMap = JSON.stringify(episodeToSeasonMap);
        
        const seasons = seriesData.seasons.filter(season => season.season_number !== 0);
        DOM.seriesViewSection.dataset.seasons = JSON.stringify(seasons.map(s => ({ season_number: s.season_number, episode_count: s.episode_count })));

        UI.renderSeriesDetails(seriesData, allTMDbSeasonsData, creditsData, traktSeriesData, traktSeasonsData);

        await setupDetailViewActions(seriesData);

    } catch (error) {
        const typedError = error as Error;
        if (typedError.name === 'AbortError') {
            console.log('Fetch aborted for series details view.');
            return;
        }
        console.error('Erro ao exibir detalhes da série:', typedError.message);
        DOM.seriesViewSection.innerHTML = `<p>Não foi possível carregar os detalhes da série. Tente novamente mais tarde.</p>`;
        UI.showNotification(`Erro ao carregar série: ${typedError.message}`);
    }
}

async function handleAddSeries(seriesData: TMDbSeriesDetails, button: HTMLButtonElement | null) {
    if (button) button.disabled = true;
    try {
        await addSeriesToWatchlist(seriesData);
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
    await addSeriesToWatchlist(series);
    UI.markButtonAsAdded(button, 'Adicionado');
}

/**
 * Lida com a ação de marcar um episódio como visto.
 * @param seriesId - ID da série.
 * @param episodeId - ID do episódio.
 * @param episodeElement - O elemento HTML do episódio.
 */
async function handleMarkAsSeen(seriesId: number, episodeId: number): Promise<void> {
    const watchedSet = new Set(S.watchedState[seriesId] || []);
    const allEpisodesJSON = DOM.seriesViewSection.dataset.allEpisodes;
    let episodesToMarkAsSeen = [episodeId];

    if (allEpisodesJSON) {
        const allEpisodes: { id: number }[] = JSON.parse(allEpisodesJSON);
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
        UI.updateActiveNavLink('archive-section');
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

async function updateGlobalProgress() {
    const seriesInProgress = S.myWatchlist.filter(series => S.watchedState[series.id] && S.watchedState[series.id].length > 0);
    if (seriesInProgress.length === 0) {
        DOM.globalProgressPercentage.textContent = '0%';
        return;
    }

    const fetchPromises = seriesInProgress
        .filter(series => series.total_episodes === undefined)
        .map(series => API.fetchSeriesDetails(series.id, null).then((details: any) => {
            const count = details.seasons?.filter((season: any) => season.season_number !== 0).reduce((acc: any, season: any) => acc + season.episode_count, 0) || 0;
            series.total_episodes = count;
        }).catch((err: any) => {
            console.error(`Failed to fetch details for series ${series.id} to update progress`, err);
            series.total_episodes = 0;
        }));

    if (fetchPromises.length > 0) {
        await Promise.all(fetchPromises);
        const updatedSeries = seriesInProgress.filter(series => series.total_episodes !== undefined);
        if (updatedSeries.length > 0) {
            await db.watchlist.bulkPut(updatedSeries);
        }
    }

    let totalEpisodes = 0;
    let totalWatched = 0;
    seriesInProgress.forEach(series => {
        totalEpisodes += series.total_episodes || 0;
        totalWatched += S.watchedState[series.id]?.length || 0;
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
            UI.applyViewMode(view, container, toggleElement);
            renderFunction();
        }
    });
}

async function exportData(): Promise<void> {
    DOM.settingsMenu.classList.remove('visible');
    try {
        const backupData = {
            version: 2,
            timestamp: new Date().toISOString(),
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
                if (!data.watchlist || !data.archive || !data.watchedState) throw new Error('Ficheiro de backup inválido ou corrompido.');
                await db.transaction('rw', [db.watchlist, db.archive, db.watchedState, db.userData], async () => {
                    await db.watchlist.clear();
                    await db.archive.clear();
                    await db.watchedState.clear();
                    await db.userData.clear();
                    await db.watchlist.bulkPut(data.watchlist as Series[]);
                    await db.archive.bulkPut(data.archive);
                    const watchedItems: WatchedStateItem[] = [];
                    for (const seriesId in data.watchedState) {
                        if (data.watchedState.hasOwnProperty(seriesId) && Array.isArray(data.watchedState[seriesId])) {
                            const sId = parseInt(seriesId, 10);
                            if (isNaN(sId)) continue;
                            data.watchedState[seriesId].forEach((episodeId: any) => {
                                if (episodeId !== null && episodeId !== undefined) {
                                    const epId = parseInt(episodeId, 10);
                                    if (!isNaN(epId)) watchedItems.push({ seriesId: sId, episodeId: epId });
                                }
                            });
                        }
                    }
                    if (watchedItems.length > 0) await db.watchedState.bulkPut(watchedItems);
                    const userDataItems: UserDataItem[] = [];
                    for (const seriesId in (data.userData || {})) {
                        const sId = parseInt(seriesId, 10);
                        if (!isNaN(sId)) {
                            const { rating, notes } = data.userData[seriesId];
                            userDataItems.push({ seriesId: sId, rating, notes });
                        }
                    }
                    if (userDataItems.length > 0) await db.userData.bulkPut(userDataItems);
                });
                UI.showNotification('Dados importados com sucesso! A aplicação será atualizada.');
                await initializeApp();
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
        const settings = await db.kvStore.toArray();
        const settingsMap = new Map(settings.map((i: KVStoreItem) => [i.key, i.value]));
        await S.loadStateFromDB();
        UI.applyViewMode(settingsMap.get(C.WATCHLIST_VIEW_MODE_KEY) ?? 'list', DOM.watchlistContainer, DOM.watchlistViewToggle);
        UI.applyViewMode(settingsMap.get(C.UNSEEN_VIEW_MODE_KEY) ?? 'list', DOM.unseenContainer, DOM.unseenViewToggle);
        UI.applyViewMode(settingsMap.get(C.ARCHIVE_VIEW_MODE_KEY) ?? 'list', DOM.archiveContainer, DOM.archiveViewToggle);
        UI.applyViewMode(settingsMap.get(C.ALL_SERIES_VIEW_MODE_KEY) ?? 'list', DOM.allSeriesContainer, DOM.allSeriesViewToggle);
        UI.renderWatchlist();
        UI.renderArchive();
        UI.renderAllSeries();
        UI.renderUnseen();
        UI.applyTheme(settingsMap.get(C.THEME_STORAGE_KEY) || 'dark');
        setupPwaUpdateNotifications();
        await updateNextAired().catch(err => console.error("Falha ao atualizar a secção 'Next Aired':", err));
        await updateGlobalProgress().catch(err => console.error("Falha ao atualizar o progresso global:", err));
        UI.updateKeyStats();

        const sectionFromHash = location.hash.substring(1);
        if (sectionFromHash && document.getElementById(sectionFromHash)) {
            UI.showSection(sectionFromHash);
            if (sectionFromHash === 'trending-section') {
                S.resetSearchAbortController();
                loadTrending('day', 'trending-scroller-day');
                loadTrending('week', 'trending-scroller-week');
            }
        } else {
            UI.showSection('watchlist-section');
        }
    } catch (error) {
        console.error("Erro crítico durante a inicialização da aplicação:", error);
        if (DOM.dashboard) {
            DOM.dashboard.innerHTML = `<div class="card"><p>Ocorreu um erro crítico ao iniciar a aplicação. Por favor, tente recarregar a página. Detalhes do erro foram registados na consola.</p></div>`;
        }
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

async function loadTrending(timeWindow: 'day' | 'week', containerId: string) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = '<p>A carregar tendências...</p>';
    try {
        const data = await API.fetchTrending(timeWindow, S.searchAbortController.signal);
        UI.renderTrending(data.results, container);
    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            console.log(`Trending fetch aborted for ${timeWindow}`);
        } else {
            console.error(`Erro ao carregar tendências (${timeWindow}):`, error);
            container.innerHTML = '<p>Ocorreu um erro ao carregar as tendências.</p>';
        }
    }
}

let allPopularSeries: Series[] = [];
let popularSeriesDisplayedCount = 0;
const POPULAR_SERIES_CHUNK_SIZE = 50;
const POPULAR_SERIES_TOTAL_TO_FETCH = 250;
let isLoadingPopular = false;

async function loadPopularSeries(loadMore = false) {
    if (isLoadingPopular) return;

    if (loadMore && allPopularSeries.length > 0) {
        popularSeriesDisplayedCount += POPULAR_SERIES_CHUNK_SIZE;
        const seriesToRender = allPopularSeries.slice(0, popularSeriesDisplayedCount);
        DOM.popularContainer.innerHTML = '';
        UI.renderPopularSeries(seriesToRender);
        if (popularSeriesDisplayedCount >= allPopularSeries.length) {
            DOM.popularLoadMoreContainer.style.display = 'none';
        } else {
            DOM.popularLoadMoreContainer.style.display = 'block';
        }
        return;
    }

    isLoadingPopular = true;
    allPopularSeries = [];
    popularSeriesDisplayedCount = 0;
    DOM.popularContainer.innerHTML = '<p>A carregar as séries mais populares...</p>';
    DOM.popularLoadMoreContainer.style.display = 'none';

    const fetchAndProcessChunk = async (page: number, size: number): Promise<Series[]> => {
        const traktData = await API.fetchTraktPopularSeries(page, size);
        const validTraktShows = traktData.filter(item => item && item.ids && item.ids.tmdb);
        const seriesPromises = validTraktShows.map(async (item: any) => {
             try {
                 const tmdbId = item.ids.tmdb;
                 const tmdbDetails = await API.fetchSeriesDetails(tmdbId, null);
                 return {
                     id: tmdbId,
                     name: item.title,
                     overview: item.overview,
                     first_air_date: item.first_aired,
                     vote_average: item.rating,
                     poster_path: tmdbDetails.poster_path,
                 } as Series;
             } catch (error) {
                 console.warn(`Não foi possível obter detalhes do TMDb para a série "${item.title}" (ID: ${item.ids.tmdb}).`, error);
                 return null;
             }
         });
        return (await Promise.all(seriesPromises)).filter((s): s is Series => s !== null);
    };

    const processRemainingChunks = async () => {
        const remainingSeries: Series[] = [];
        const pagesToFetch = Math.ceil((POPULAR_SERIES_TOTAL_TO_FETCH - POPULAR_SERIES_CHUNK_SIZE) / POPULAR_SERIES_CHUNK_SIZE);
        for (let i = 0; i < pagesToFetch; i++) {
            const page = i + 2; // Começa na página 2
            const chunk = await fetchAndProcessChunk(page, POPULAR_SERIES_CHUNK_SIZE);
            remainingSeries.push(...chunk);
        }
        allPopularSeries.push(...remainingSeries);
        allPopularSeries.sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0));
        // Re-renderiza a primeira página com a lista completa e ordenada para garantir consistência
        const seriesToRender = allPopularSeries.slice(0, popularSeriesDisplayedCount);
        DOM.popularContainer.innerHTML = '';
        UI.renderPopularSeries(seriesToRender);
    };

    try {
        // Carrega e renderiza o primeiro chunk rapidamente
        const firstChunk = await fetchAndProcessChunk(1, POPULAR_SERIES_CHUNK_SIZE);
        allPopularSeries = [...firstChunk].sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0));
        popularSeriesDisplayedCount = POPULAR_SERIES_CHUNK_SIZE;
        const seriesToRender = allPopularSeries.slice(0, popularSeriesDisplayedCount);
        DOM.popularContainer.innerHTML = '';
        UI.renderPopularSeries(seriesToRender);
        if (allPopularSeries.length > 0) {
            DOM.popularLoadMoreContainer.style.display = 'block';
        }
        // Carrega o resto em segundo plano
        processRemainingChunks().finally(() => {
            isLoadingPopular = false;
            if (popularSeriesDisplayedCount >= allPopularSeries.length) {
                DOM.popularLoadMoreContainer.style.display = 'none';
            }
        });
    } catch (error) {
        console.error('Erro ao carregar séries populares:', error);
        DOM.popularContainer.innerHTML = '<p>Ocorreu um erro ao carregar as séries populares.</p>';
        isLoadingPopular = false;
    }
}

let premieresSeriesPage = 1;
async function loadPremieresSeries(loadMore = false) {
    if (!loadMore) {
        premieresSeriesPage = 1; // Reset page count on first load
        DOM.premieresContainer.innerHTML = '<p>A carregar estreias...</p>';
        DOM.popularLoadMoreContainer.style.display = 'none';
    }

    try {        
        const data = await API.fetchNewPremieres(premieresSeriesPage);
        
        if (!loadMore) {
            DOM.premieresContainer.innerHTML = '';
        }

        // Filtra as séries para excluir as que já estão na biblioteca do utilizador
        const seriesNotInLibrary = data.results.filter(
            (series) => !S.myWatchlist.some(s => s.id === series.id) && !S.myArchive.some(s => s.id === series.id)
        );

        // Na primeira carga, mostra apenas 18. Nas seguintes, mostra a página toda.
        const seriesToRender = loadMore ? seriesNotInLibrary : seriesNotInLibrary.slice(0, 18);

        UI.renderPremieresSeries(seriesToRender);

        if (data.page < data.total_pages && seriesNotInLibrary.length > 0) {
            DOM.premieresLoadMoreContainer.style.display = 'block';
            premieresSeriesPage++;
        } else {
            DOM.premieresLoadMoreContainer.style.display = 'none';
        }
    } catch (error) {
        console.error('Erro ao carregar as estreias:', error);
        DOM.premieresContainer.innerHTML = '<p>Ocorreu um erro ao carregar as estreias.</p>';
    }
}
// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    // Navigation
    DOM.mainNavLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = (link as HTMLElement).dataset.target;
            if (targetId) {
                if (targetId === 'all-series-section') {
                    UI.renderAllSeries();
                } else if (targetId === 'trending-section') {
                    S.resetSearchAbortController();
                    loadTrending('day', 'trending-scroller-day');
                    loadTrending('week', 'trending-scroller-week');
                } else if (targetId === 'popular-section') {
                    S.resetSearchAbortController();
                    loadPopularSeries();
                } else if (targetId === 'premieres-section') {
                    S.resetSearchAbortController();
                    loadPremieresSeries();
                }
                UI.showSection(targetId);
            }
        });
    });

    // View Toggles
    setupViewToggle(DOM.watchlistViewToggle, DOM.watchlistContainer, C.WATCHLIST_VIEW_MODE_KEY, UI.renderWatchlist);
    setupViewToggle(DOM.unseenViewToggle, DOM.unseenContainer, C.UNSEEN_VIEW_MODE_KEY, UI.renderUnseen);
    setupViewToggle(DOM.archiveViewToggle, DOM.archiveContainer, C.ARCHIVE_VIEW_MODE_KEY, UI.renderArchive);
    setupViewToggle(DOM.allSeriesViewToggle, DOM.allSeriesContainer, C.ALL_SERIES_VIEW_MODE_KEY, UI.renderAllSeries);
    setupViewToggle(DOM.popularViewToggle, DOM.popularContainer, 'popular_view_mode', () => loadPopularSeries());
    setupViewToggle(DOM.premieresViewToggle, DOM.premieresContainer, 'premieres_view_mode', () => loadPremieresSeries());

    // Header Search
    const performSearch = () => {
        const query = DOM.addSeriesHeaderInput.value.trim();
        if (query.length > 1) {
            S.resetSearchAbortController();
            DOM.searchResultsContainer.innerHTML = '<p>A pesquisar...</p>';
            UI.showSection('add-series-section');
            API.searchSeries(query, S.searchAbortController.signal)
                .then(data => {
                    S.setCurrentSearchResults(data.results);
                    UI.renderSearchResults(data.results);
                })
                .catch(error => {
                    if (error.name === 'AbortError') {
                        console.log('Search aborted');
                    } else {
                        console.error('Erro ao pesquisar séries:', error);
                        DOM.searchResultsContainer.innerHTML = '<p>Ocorreu um erro ao realizar a pesquisa.</p>';
                    }
                });
        } else if (query.length === 0) {
            DOM.searchResultsContainer.innerHTML = '<p>Escreva na barra de pesquisa para encontrar novas séries.</p>';
        }
    };

    const debouncedSearch = debounce(performSearch, 300);

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
            const interactiveElement = target.closest<HTMLElement>('.status-icon, .star-container, .action-icon, .series-item, .add-btn, .remove-btn, .trailer-btn, .mark-season-seen-btn, .cast-show-more-btn');
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
            removeSeriesFromLibrary(parseInt((removeBtn as HTMLElement).dataset.seriesId!, 10), removeBtn.closest('.watchlist-item'));
            return;
        }

        const addSeriesQuickBtn = target.closest('.add-series-quick-btn');
        if (addSeriesQuickBtn) {
            const seriesId = parseInt((addSeriesQuickBtn as HTMLElement).dataset.seriesId!, 10);
            const seriesToAdd = S.currentSearchResults.find((s: Series) => s.id === seriesId);
            if (seriesToAdd) {
                await handleQuickAdd(seriesToAdd, addSeriesQuickBtn as HTMLButtonElement);
            }
            return;
        }

        const seriesItem = target.closest('.watchlist-item, .top-rated-item, .trending-card, .search-result-item');
        if (seriesItem) {
            document.dispatchEvent(new CustomEvent('display-series-details', { detail: { seriesId: parseInt((seriesItem as HTMLElement).dataset.seriesId!, 10) } }));
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
            const seriesId = parseInt((ratingContainer as HTMLElement).dataset.seriesId!, 10);
            const value = parseInt((star as HTMLElement).dataset.value!, 10);
            const currentRating = S.userData[seriesId]?.rating || 0;
            const newRating = (value === currentRating) ? 0 : value; // Toggle off
            await S.updateUserRating(seriesId, newRating);
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

        const markAllBtn = target.closest('#mark-all-seen-btn');
        if (markAllBtn) {
            const seriesId = parseInt((DOM.seriesViewSection as HTMLElement).dataset.seriesId!, 10);
            if (seriesId) {
                UI.showNotification('A marcar todos os episódios como vistos...');

                const allEpisodes: {id: number}[] = JSON.parse(DOM.seriesViewSection.dataset.allEpisodes || '[]');
                const allEpisodeIds = allEpisodes.map((ep: {id: number}) => ep.id);

                if (allEpisodeIds.length > 0) {
                    await S.markEpisodesAsWatched(seriesId, allEpisodeIds);

                    document.querySelectorAll('.episode-item').forEach(el => UI.markEpisodeAsSeen(el as HTMLElement));
                    
                    const seasons: {season_number: number}[] = JSON.parse(DOM.seriesViewSection.dataset.seasons || '[]');
                    seasons.forEach((season: {season_number: number}) => UI.updateSeasonProgressUI(seriesId, season.season_number));
                    
                    UI.updateOverallProgressBar(seriesId);

                    const movedToArchive = await checkSeriesCompletion(seriesId);
                    updateGlobalProgress();
                    UI.updateKeyStats();

                    if (movedToArchive) UI.updateActiveNavLink('archive-section');
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
                
                const allEpisodes = JSON.parse(DOM.seriesViewSection.dataset.allEpisodes || '[]');
                const seasonEpisodeIds = allEpisodes.filter((ep: any) => ep.season_number === seasonNumber).map((ep: any) => ep.id);

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
                        UI.updateActiveNavLink('archive-section');
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
        loadPopularSeries(true);
    });

    DOM.premieresLoadMoreBtn?.addEventListener('click', () => {
        loadPremieresSeries(true);
    });

    // Modals
    DOM.modalCloseBtn?.addEventListener('click', UI.closeEpisodeModal);
    DOM.episodeModal?.addEventListener('click', (e: MouseEvent) => e.target === DOM.episodeModal && UI.closeEpisodeModal());
    DOM.trailerModalCloseBtn?.addEventListener('click', UI.closeTrailerModal);
    DOM.trailerModal?.addEventListener('click', (e: MouseEvent) => e.target === DOM.trailerModal && UI.closeTrailerModal());
    DOM.notificationOkBtn?.addEventListener('click', UI.closeNotificationModal);
    DOM.notificationModal?.addEventListener('click', (e: MouseEvent) => e.target === DOM.notificationModal && UI.closeNotificationModal());
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
            document.dispatchEvent(new CustomEvent('display-series-details', { detail: { seriesId } }));
            UI.closeSeriesByRatingModal();
            UI.closeAllRatingsModal();
        }
    });

    let notesSaveTimeout: number;
    DOM.dashboard?.addEventListener('input', (e) => {
        const notesTextarea = (e.target as Element).closest('.user-notes-textarea');
        if (notesTextarea) {
            clearTimeout(notesSaveTimeout);
            notesSaveTimeout = window.setTimeout(async () => {
                const seriesId = parseInt((notesTextarea as HTMLElement).dataset.seriesId!, 10);
                const notes = (notesTextarea as HTMLTextAreaElement).value;
                await S.updateUserNotes(seriesId, notes);
                console.log(`Notas para a série ${seriesId} guardadas.`);
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
        UI.applyTheme(newTheme);
    });
    DOM.settingsBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        DOM.settingsMenu.classList.toggle('visible');
    });
    document.addEventListener('click', (e: MouseEvent) => {
        if (DOM.settingsMenu && DOM.settingsBtn && !DOM.settingsMenu.contains(e.target as Node) && !DOM.settingsBtn.contains(e.target as Node)) {
            DOM.settingsMenu.classList.remove('visible');
        }
    });
    DOM.exportDataBtn?.addEventListener('click', exportData);
    DOM.importDataBtn?.addEventListener('click', importData);
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
            .map(series => ({ series, rating: S.userData[series.id]?.rating }))
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
    document.addEventListener('display-series-details', ((e: CustomEvent) => {
        displaySeriesDetails(e.detail.seriesId);
    }) as EventListener);

    initializeApp();
});
