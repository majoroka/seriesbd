# seriesBD

Aplicação web para organizar e acompanhar consumo de media (séries, filmes e livros) usando dados do TMDb, Trakt, TVMaze, Google Books e Open Library. Permite gerir uma biblioteca pessoal, acompanhar progresso, pesquisar conteúdos, consultar tendências/estreias e exportar estatísticas, tudo num ambiente pensado para funcionamento offline via PWA e IndexedDB.

Plano de execução e estado atual: [EXECUTION_PLAN.md](./EXECUTION_PLAN.md).

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
- **Seguro**: As chaves de API são protegidas através de funções serverless na Cloudflare Pages, nunca sendo expostas no browser.

## Stack tecnológica

- **Frontend:** Vite + TypeScript + HTML/CSS modularizados.
- **Estado e persistência:** Dexie (IndexedDB) com cache de temporadas e KV store para preferências.
- **UI e gráficos:** Chart.js, Font Awesome, animações personalizadas em `ui.ts`.
- **Automação:** Cloudflare Pages Functions para proxies TMDb/Trakt/TVMaze, vite-plugin-pwa para assets offline.
- **Testes:** Vitest + Testing Library (ambiente jsdom).

## Requisitos

- Node.js 20 LTS (recomendado) e npm.
- Projeto Supabase (para autenticação de utilizadores).
- Contas TMDb e Trakt com chaves de API válidas.
- Conta TVMaze (opcional; usar chave apenas se necessário no teu plano/limites).
- Conta Cloudflare (Pages) com repositório GitHub ligado.

## Configuração e execução locais

1. Instalar dependências:

   ```bash

   npm install
   ```

2. Definir variáveis de ambiente (ficheiro `.env` na raiz do projeto para desenvolvimento local):

   ```env
   TMDB_API_KEY=...
   TRAKT_API_KEY=...
   TVMAZE_API_KEY=... # opcional
   GOOGLE_BOOKS_API_KEY=... # opcional (books)
   HEARTBEAT_TOKEN=... # opcional, recomendado para proteger /api/heartbeat
   SUPABASE_URL=... # server-side (Pages Function heartbeat)
   SUPABASE_SERVICE_ROLE_KEY=... # server-side only
   VITE_SUPABASE_URL=...
   VITE_SUPABASE_ANON_KEY=...
   ```

3. Opcionalmente, definir a origem dos endpoints `/api/*` usados localmente:

   ```env
   VITE_LOCAL_API_ORIGIN=https://mediadex.app
   ```

   Se preferires validar contra preview/staging ou outro runtime Cloudflare compatível, aponta esta variável para essa origem.

4. Iniciar o ambiente de desenvolvimento local:

   ```bash

   npm run dev
   ```

   `npm run dev` arranca o Vite e faz proxy local de `/api/*` para a origem definida em `VITE_LOCAL_API_ORIGIN`.  
   Produção e preview continuam a usar exclusivamente Cloudflare Pages Functions.
5. Build de produção:

   ```bash

   npm run build
   npm run preview
   ```

## Scripts npm

- `npm run dev` – Vite local com proxy `/api/*` para a origem Cloudflare configurada.
- `npm run build` – build Vite otimizado para `dist/`.
- `npm run preview` – servidor estático para testar o build.
- `npm run test` – Vitest em modo WATCH/CLI padrão.
- `npm run test:run` – suite Vitest em modo não interativo.
- `npm run coverage` – Vitest em modo cobertura.
- `npm run test:ui` – runner interactivo da Testing Library.
- `npm run verify:release` – validação reprodutível mínima (`test:run` + `build`).
- `npm run bundle:audit` – gera um zip limpo do `HEAD` em `artifacts/`, com checksum SHA-256 e metadata do commit, sem `node_modules`, `dist` nem artefactos locais.

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
├─ functions/
│  └─ api/               # Cloudflare Pages Functions (/api/tmdb, /api/trakt, /api/tvmaze, /api/books, /api/heartbeat)
├─ workers/
│  └─ heartbeat-cron/    # Worker com Cron Trigger para chamar /api/heartbeat
└─ vite.config.ts        # Configuração Vite + PWA + Vitest
```

## Runtime

- Produção: `Cloudflare Pages` + `functions/api/*`
- Preview/staging: `Cloudflare Pages`
- Desenvolvimento local: `Vite` + proxy `/api/*` para origem Cloudflare configurável

Regras atuais:
- novas evoluções serverless devem entrar em `functions/api/*`
- não existe runtime Netlify suportado no projeto

## Testes

Cobertura atual inclui:
- `src/api.test.ts` (fluxos críticos de providers/fallbacks).
- `src/state.test.ts` (persistência/migração/transições principais).
- `src/utils.test.ts`.
- `functions/api/_shared/security.test.js` (rate limit + validação).
- `functions/api/auth/display-name-available.test.js`.

```bash
npm run test
```

## Artefacto auditável

Para gerar um pacote limpo para auditoria ou partilha:

1. garantir que o worktree está limpo e commitado;
2. correr:

   ```bash
   npm run verify:release
   npm run bundle:audit
   ```

Resultado:
- o zip é criado em `artifacts/`
- o checksum SHA-256 é criado ao lado do zip
- a metadata do bundle inclui `commit SHA`, timestamp UTC e branch/ref atual
- contém apenas ficheiros tracked no `HEAD`
- exclui automaticamente:
  - `node_modules`
  - `dist`
  - `.netlify`
  - `.wrangler`
  - `.DS_Store`
  - `__MACOSX`
  - ficheiros locais não versionados

## Convenções e boas práticas

- Código em TypeScript com módulos coesos (`api`, `state`, `ui`).
- Uso de `processInBatches` para rate limiting e redução de chamadas simultâneas à API.
- Preferência por funções puras utilitárias em `utils.ts`, mantendo `ui.ts` focado na camada de apresentação.
- Preferências de utilizador e caches guardadas em IndexedDB (`kvStore`, `seasonCache`).
- CSP por ambiente:
  - Desenvolvimento: aplicada por `vite.config.ts` (compatível com HMR).
  - Produção: aplicada por `public/_headers` no deploy Cloudflare (mais restritiva).
- Todas as chamadas externas continuam mediadas por funções serverless.

## Documentação complementar

- [ARQUITETURA](ARQUITETURA.md) – detalhe dos módulos, fluxos e decisões técnicas.
- [S6_QA_ROLLBACK](S6_QA_ROLLBACK.md) – checklist formal de UAT/go-live e plano de rollback.

## Deploy

- Cloudflare Pages é o alvo principal.
- `main` publica em `Production` (`mediadex.app`).
- `staging` publica em `Preview` (`staging.seriesbd.pages.dev` e URLs por hash).
- Certifique-se de que as chaves `TMDB_API_KEY`, `TRAKT_API_KEY`, `TVMAZE_API_KEY`, `GOOGLE_BOOKS_API_KEY` e `HEARTBEAT_TOKEN` estão configuradas em `Settings -> Variables and Secrets` para `Preview` e `Production`.
- Para o cron de heartbeat:
  - deploy do worker com `npx wrangler deploy --config workers/heartbeat-cron/wrangler.toml`
  - configurar `HEARTBEAT_URL` e `HEARTBEAT_TOKEN` no worker (`wrangler secret put ...`)

## Notas de robustez e troubleshooting

- A secção **Top Rated** usa o endpoint `top_rated` do TMDb para priorizar séries com melhor avaliação pública.
- O menu de definições inclui um toggle para excluir/incluir animação asiática no Top Rated.
- Nos **detalhes da série**, os dados Trakt tentam resolução por TMDb ID, IMDb ID e nome/ano (fallback progressivo).
- A sinopse dos detalhes usa agregação multi-fonte com prioridade linguística `pt-PT` -> `pt` -> `en`; na ausência de PT, é escolhido o texto em inglês mais completo.
- O bloco de avaliações dos detalhes mostra 3 fontes quando disponíveis (TMDb, Trakt e TVMaze), com anéis concêntricos mais finos para acomodar a 3.ª métrica.
- O matching cross-provider prioriza `imdb_id`; quando recorre a nome/ano, aplica score mínimo e descarta matches fracos para evitar dados errados.
- O botão de trailer usa Trakt quando disponível e fallback TMDb (`en-US`) quando necessário.
- Se a Trakt devolver HTML de bloqueio (Cloudflare), a função devolve erro JSON `502` para facilitar diagnóstico em vez de quebrar silenciosamente.
- Observabilidade mínima ativa:
  - frontend regista falhas por secção dinâmica com contexto (`secção`, `endpoint`, `status`) e snapshot em `sessionStorage` (`seriesdb.observability.v1`);
  - funções Cloudflare devolvem `x-request-id`, `x-upstream-status`, `x-upstream-latency-ms`, `x-ratelimit-limit`, `x-ratelimit-remaining` e `x-ratelimit-reset` para troubleshooting.
- Em offline, funcionalidades dependentes de `/api/*` (pesquisa remota, tendências/populares/estreias, ratings públicos) podem ficar indisponíveis até voltar a ligação.
