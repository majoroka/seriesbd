# Arquitetura

## Visão geral

O **seriesBD** é uma single-page application construída com Vite e TypeScript. A UI é renderizada inteiramente no browser e a persistência é local (IndexedDB), o que permite funcionamento offline. As integrações externas (TMDb e Trakt) são feitas através de funções serverless da Netlify que atuam como proxies e protegem as chaves de API.

```text
┌───────────┐        ┌────────────────────┐        ┌────────────────────────┐
│  Browser  │ <────> │ Netlify Functions  │ <────> │ APIs externas (TMDb/Trakt) │
└───────────┘        └────────────────────┘        └────────────────────────┘
        │
        ▼
┌────────────────────┐
│ IndexedDB (Dexie)  │
└────────────────────┘
```

## Módulos principais (frontend)

### `src/main.ts`

- Ponto de entrada da aplicação.
- Regista listeners de navegação, pesquisa, import/export, toggles de vista e tema.
- Coordena fluxos assíncronos: adicionar séries, carregar detalhes, marcar episódios, atualizar progresso e estatísticas.
- Recorre a `processInBatches` para limitar chamadas concorrentes às APIs (evita throttle dos serviços externos).
- Sincroniza o estado em memória (`state.ts`) com a persistência (`db.ts`) e aciona re-renderizações (`ui.ts`).

### `src/ui.ts`

- Responsável por toda a renderização da interface: listas, cards, modais, gráficos, animações e acessibilidade.
- Centraliza a criação de elementos (`el`), manipula classes e contém lógica de interação (p.ex. marcar episódio visto, abrir trailer).
- Produz e gere instâncias Chart.js com opções de renderização adaptativas para mobile e suporta exportação a PNG/CSV via utilitários.
- Implementa duas vistas de detalhes de série: a original e uma nova **vista V2** mais imersiva com backdrop dinâmico.
- Emite eventos personalizados (`display-series-details`) para desacoplar interações do fluxo em `main.ts`.

### `src/state.ts`

- Armazena o estado "vivo" da aplicação (watchlist, arquivo, episódios vistos, preferências).
- Encapsula o acesso ao IndexedDB através do Dexie (tabelas `watchlist`, `archive`, `watchedState`, `userData`, `kvStore`, `seasonCache`).
- Fornece operações atómicas (adicionar série, arquivar, atualizar notas, migrar dados do `localStorage`).
- Expõe `loadStateFromDB()` e `migrateFromLocalStorage()` para iniciar ou atualizar a base local.

### `src/api.ts`

- Implementa o cliente para TMDb/Trakt consumindo os proxies `/api/tmdb` e `/api/trakt`.
- Garante uniformização de erros e parâmetros (locale `pt-PT`, fallback de `AbortController`).
- Mantém cache de temporadas em IndexedDB (`getSeasonDetailsWithCache`), evitando refetch de dados estáticos por 7 dias.
- Expõe métodos para tendências diárias/semanais, populares, estreias recentes, detalhes, créditos e vídeos.
- `fetchTraktData` aplica fallback progressivo de matching (TMDb ID -> IMDb ID -> nome/ano) e fallback de ratings/trailer a partir de `extended=full` quando endpoints dedicados falham.

### `src/db.ts`

- Define o schema Dexie (`MySubClassedDexie`) e assegura versionamento (`version(3)`).
- Garante chaves compostas (`[seriesId+episodeId]`, `[seriesId+seasonNumber]`) para `watchedState` e cache de temporadas.

### `src/utils.ts`

- Reúne helpers puros (debounce, formatação de datas/duração, animações, exportações).
- `processInBatches` implementa processamento sequencial com limite de lote + atraso (rate limiting manual).
- Funções de exportação são usadas tanto para estatísticas (PNG) como para dados (CSV).

### `src/dom.ts`

- Mantém seletores tipados do DOM para evitar consultas repetidas e facilitar manutenção.
- Ajuda a separar a camada de estrutura (HTML) da lógica de renderização (`ui.ts`).

### `src/types.ts` e `src/constants.ts`

- Tipagens das respostas TMDb/Trakt e dos objetos locais (Series, WatchedState, SeasonCache).
- Constantes para chaves de armazenamento (`kvStore`) e valores partilhados.

## Fluxos de dados

1. **Inicialização (`initializeApp`)**

   - Migra dados de `localStorage` (se existirem) para IndexedDB.
   - Carrega estado a partir do Dexie (`loadStateFromDB`).
   - Reaplica preferências (tema, modo de vista) guardadas na `kvStore`.
   - Renderiza listas e estatísticas iniciais, preenche "Próximo Episódio" e ativa PWA (`registerSW`).

2. **Adicionar série**

   - Pesquisa TMDb (`searchSeries`) com debounce.
   - Ao selecionar "Adicionar", `addSeriesToWatchlist` garante que a série não existe já na biblioteca.
   - Busca detalhes completos (temporadas) e calcula episódios totais antes de persistir.
   - Atualiza vistas (`renderWatchlist`, `renderAllSeries`, `renderUnseen`) e estatísticas.

3. **Marcar episódios**

   - `handleMarkAsSeen` prevê episódios anteriores não vistos e pergunta se devem ser marcados também.
   - Atualiza `watchedState` local e IndexedDB em bulk.
   - Se uma série ficar completa, `checkSeriesCompletion` consulta TMDb para confirmar contagem oficial e move-a para o arquivo.

4. **Secções dinâmicas**

   - Tendências (`loadTrending`), Populares (`loadPopularSeries`) e Estreias (`loadPremieresSeries`) recorrem ao `searchAbortController` partilhado para cancelar pedidos em trânsito.
   - Populares usa Trakt como fonte primária, com fallback automático para TMDb em caso de erro/bloqueio.
   - Dados são filtrados contra a biblioteca local para evitar duplicados.

5. **Estatísticas**

   - `UI.updateKeyStats` consolida dados (`watchlist`, `archive`, `watchedState`, `userData`).
   - Gráficos Chart.js são destruídos e recriados conforme o tema ou o tamanho do ecrã.
   - Exportações utilizam `exportChartToPNG` e `exportDataToCSV`.

## Persistência e caching

- **IndexedDB / Dexie**
  - `watchlist` e `archive` guardam objetos `Series` com metadados `_details` (_status_, próximo episódio, `_lastUpdated`).
  - `watchedState` guarda pares `[seriesId, episodeId]` para cada episódio visto.
  - `userData` armazena notas e ratings pessoais.
  - `kvStore` guarda configurações (tema, vista escolhida, etc.).
  - `seasonCache` persiste temporadas TMDb por `7 dias` (definido em `api.ts`), evitando re-download de dados estáticos.
- **Rate limiting**
  - `processInBatches` aplica limites configuráveis (p.ex. 5 itens, 1s) para atualizações em massa (`updateNextAired`, `refetchAllMetadata`).
  - `updateNextAired` renova `_lastUpdated` mesmo em caso de erro, prevenindo loop infinito.

## Integração com APIs externas

- **Netlify Functions**
  - `/netlify/functions/tmdb.mjs` injeta `TMDB_API_KEY`, normaliza headers, trata CORS/Content-Encoding e respeita `language` explícito no query string.
  - `/netlify/functions/trakt.mjs` adiciona cabeçalhos obrigatórios (`trakt-api-version`, `trakt-api-key`, `User-Agent`), responde a preflight e deteta bloqueios Cloudflare (retornando `502` em JSON para diagnóstico).
  - `netlify.toml` redireciona rotas específicas para cada provider:
    - `/api/tmdb/*` -> `/.netlify/functions/tmdb/:splat`
    - `/api/trakt/*` -> `/.netlify/functions/trakt/:splat`
- **Segurança**
  - Chaves nunca são expostas no frontend.
  - CSP por ambiente:
    - Dev (`vite.config.ts`): política compatível com HMR (`ws/wss`, regras mais permissivas).
    - Produção (`netlify.toml`): política mais restritiva via headers HTTP.

## PWA e funcionamento offline

- `vite-plugin-pwa` configura manifest, cache estático (`workbox`) e atualização automática (`registerSW`).
- Imagens remotas (tmdb) são tratadas com estratégia `StaleWhileRevalidate` e limite de 30 dias.
- IndexedDB garante disponibilidade dos dados do utilizador sem conectividade.
- Notificações guiam o utilizador durante updates (`onNeedRefresh`, `onOfflineReady`).

## Testes e qualidade

- Testes unitários com Vitest (`src/utils.test.ts`) cobrem formatação de duração, nomes de temporada e datas.
- Ambiente `jsdom` configurado em `vite.config.ts` / `vitest.setup.ts`.
- Recomendação: expandir para fluxos de UI críticos (Testing Library) e mocks da Dexie.

## Observabilidade e UX

- Logging via `console` durante migração, atualização de metadados e operações críticas (facilita debug em produção).
- Modais de confirmação/erro (`UI.showNotification`, `showConfirmationModal`) mantêm feedback consistente.
- Animações (`animateValue`, `animateDuration`) melhoram percepção de progresso sem sacrificar desempenho.

## Pontos de atenção e oportunidades

- **Erros TMDb/Trakt:** há fallback funcional para vários fluxos, mas ainda sem retry/backoff dedicado por endpoint.
- **Responsividade:** a folha `style.css` cobre breakpoints principais, com especial atenção à grelha de estatísticas que agora se adapta a ecrãs verticais estreitos. Seria útil introduzir testes visuais ou Storybook.
- **Internacionalização:** UI e dados estão em `pt-PT`; preparar camada de tradução facilitaria expansão.
- **Sincronização multi-dispositivo:** hoje é apenas local; uma API backend seria necessária para cloud sync (ver Roadmap).
- **Desempenho na Vista de Detalhes:** A função `renderSeriesDetails` cria toda a árvore DOM dos episódios a cada interação. Em séries com muitas temporadas, a virtualização da lista (renderizar apenas os episódios visíveis) poderia melhorar significativamente o desempenho.
- **Dependência de terceiros (Trakt/Cloudflare):** mesmo com fallback, bloqueios upstream podem reduzir dados públicos (ex.: rating Trakt) em cenários específicos.
