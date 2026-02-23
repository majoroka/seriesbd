# seriesBD

Aplicação web para organizar e acompanhar séries de televisão usando dados do TMDb, Trakt e TVMaze. Permite gerir uma biblioteca pessoal, marcar episódios como vistos, acompanhar estreias e tendências e exportar estatísticas, tudo num ambiente pensado para funcionamento offline via PWA e IndexedDB.

- ## Funcionalidades principais

- **Biblioteca Pessoal**: Organize as suas séries nas secções `Quero Ver`, `A Ver`, `Arquivo` e `Todas`. Alterne entre uma **vista de lista** detalhada e uma **vista em grelha** focada nos posters.
- **Acompanhamento de Progresso**: Marque episódios e temporadas como vistos e acompanhe o seu progresso visualmente.
- **Vista de Detalhes V2**: Uma interface moderna e imersiva para cada série, com backdrop dinâmico, informações de elenco, classificações públicas (TMDb + Trakt), trailers e gestão de progresso.
- **Descoberta de Séries**: Encontre novas séries com a pesquisa integrada ou explore as secções de **tendências** (diárias e semanais), Top Rated e próximas estreias.
- **Estatísticas Detalhadas**: Visualize o tempo total assistido, número de episódios vistos e analise os seus hábitos com gráficos de géneros, anos de lançamento e muito mais.
- **Classificação e Notas**: Avalie as suas séries de 1 a 10 estrelas e adicione notas pessoais.
- **Offline-First com PWA**: A aplicação funciona offline, sincronizando os seus dados localmente com IndexedDB.
- **Temas Claro e Escuro**: Escolha o seu tema preferido para uma experiência de visualização mais confortável.
- **Importação e Exportação**: Faça backup e restaure a sua biblioteca a qualquer momento.
- **Seguro**: As chaves de API são protegidas através de funções serverless na Netlify, nunca sendo expostas no browser.

## Stack tecnológica

- **Frontend:** Vite + TypeScript + HTML/CSS modularizados.
- **Estado e persistência:** Dexie (IndexedDB) com cache de temporadas e KV store para preferências.
- **UI e gráficos:** Chart.js, Font Awesome, animações personalizadas em `ui.ts`.
- **Automação:** Netlify Functions para proxies TMDb/Trakt/TVMaze, vite-plugin-pwa para assets offline.
- **Testes:** Vitest + Testing Library (ambiente jsdom).

## Requisitos

- Node.js 20 LTS (recomendado) e npm.
- Contas TMDb e Trakt com chaves de API válidas.
- Conta TVMaze (opcional; usar chave apenas se necessário no teu plano/limites).
- Netlify CLI (utilizada via `npm run dev`; não é necessário instalar globalmente).

## Configuração e execução locais

1. Instalar dependências:

   ```bash

   npm install
   ```

2. Definir variáveis de ambiente (ficheiro `.env` na raiz do projeto, ou `netlify env:set`):

   ```env
   TMDB_API_KEY=...
   TRAKT_API_KEY=...
   TVMAZE_API_KEY=... # opcional
   ```

3. Iniciar o ambiente de desenvolvimento (Vite + proxies de funções):

   ```bash

   npm run dev
   ```

   O Netlify CLI expõe a app em `http://localhost:8888` e encaminha:
   - `/api/tmdb/*` -> `tmdb` function
   - `/api/trakt/*` -> `trakt` function
   - `/api/tvmaze/*` -> `tvmaze` function
4. Build de produção:

   ```bash

   npm run build
   npm run preview
   ```

## Scripts npm

- `npm run dev` – `netlify dev` com Vite, funções e PWA.
- `npm run build` – build Vite otimizado para `dist/`.
- `npm run preview` – servidor estático para testar o build.
- `npm run test` – Vitest em modo WATCH/CLI padrão.
- `npm run coverage` – Vitest em modo cobertura.
- `npm run test:ui` – runner interactivo da Testing Library.

## Estrutura relevante

```text

├─ index.html            # Layout principal e secções da dashboard
├─ src/
│  ├─ api.ts             # Chamadas TMDb/Trakt/TVMaze e cache de temporadas
│  ├─ main.ts            # Ponto de entrada, listeners e fluxo de UI
│  ├─ state.ts           # Estado em memória + persistência Dexie
│  ├─ ui.ts              # Renderização, modais, gráficos e interacções
│  ├─ dom.ts             # Referências centralizadas ao DOM
│  ├─ db.ts              # Definição Dexie e stores IndexedDB
│  ├─ utils.ts           # Helpers (debounce, exportações, animações)
│  ├─ types.ts           # Tipagens TMDb/Trakt/TVMaze/local
│  └─ style.css          # Tema e responsividade
├─ netlify/
│  └─ functions/         # Proxies serverless TMDb/Trakt/TVMaze
└─ vite.config.ts        # Configuração Vite + PWA + Vitest
```

## Testes

Os testes existentes concentram-se em `src/utils.test.ts`. Para expandir a cobertura, priorizar:

- Fluxos críticos (`addSeriesToWatchlist`, gestão de episódios, exportações).
- Componentes que manipulam o IndexedDB (mockando Dexie).
- Renderização do detalhe da série (Testing Library + jsdom).

```bash
npm run test
```

## Convenções e boas práticas

- Código em TypeScript com módulos coesos (`api`, `state`, `ui`).
- Uso de `processInBatches` para rate limiting e redução de chamadas simultâneas à API.
- Preferência por funções puras utilitárias em `utils.ts`, mantendo `ui.ts` focado na camada de apresentação.
- Preferências de utilizador e caches guardadas em IndexedDB (`kvStore`, `seasonCache`).
- CSP por ambiente:
  - Desenvolvimento: aplicada por `vite.config.ts` (compatível com HMR).
  - Produção: aplicada por headers no `netlify.toml` (mais restritiva).
- Todas as chamadas externas continuam mediadas por funções serverless.

## Documentação complementar

- [ARQUITETURA](ARQUITETURA.md) – detalhe dos módulos, fluxos e decisões técnicas.
- [ROADMAP](ROADMAP.md) – visão da evolução prevista e tarefas futuras.

## Deploy

- Netlify é o alvo principal (`netlify.toml` define build, funções e rewrites específicos por provider: `/api/tmdb/*`, `/api/trakt/*` e `/api/tvmaze/*`).
- Para deploy manual basta executar:

  ```bash

  npm run build
  netlify deploy --prod

  ```

  (Certifique-se de que as chaves `TMDB_API_KEY`, `TRAKT_API_KEY` e `TVMAZE_API_KEY` estão configuradas no ambiente Netlify.)

## Notas de robustez e troubleshooting

- A secção **Top Rated** usa o endpoint `top_rated` do TMDb para priorizar séries com melhor avaliação pública.
- O menu de definições inclui um toggle para excluir/incluir animação asiática no Top Rated.
- Nos **detalhes da série**, os dados Trakt tentam resolução por TMDb ID, IMDb ID e nome/ano (fallback progressivo).
- O botão de trailer usa Trakt quando disponível e fallback TMDb (`en-US`) quando necessário.
- Se a Trakt devolver HTML de bloqueio (Cloudflare), a função devolve erro JSON `502` para facilitar diagnóstico em vez de quebrar silenciosamente.
- Observabilidade mínima ativa:
  - frontend regista falhas por secção dinâmica com contexto (`secção`, `endpoint`, `status`) e snapshot em `sessionStorage` (`seriesdb.observability.v1`);
  - funções Netlify devolvem `x-request-id`, `x-upstream-status` e `x-upstream-latency-ms` para troubleshooting.
- Em offline, funcionalidades dependentes de `/api/*` (pesquisa remota, tendências/populares/estreias, ratings públicos) podem ficar indisponíveis até voltar a ligação.
