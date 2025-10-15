# seriesBD

Aplicação web para organizar e acompanhar séries de televisão usando dados do TMDb e da Trakt. Permite gerir uma biblioteca pessoal, marcar episódios como vistos, acompanhar estreias e tendências e exportar estatísticas, tudo num ambiente pensado para funcionamento offline via PWA e IndexedDB.

## Funcionalidades principais
- Gestão da biblioteca em quatro vistas: `Quero Ver`, `A Ver`, `Arquivo` e `Todas`.
- Integração com as APIs TMDb (detalhes, imagens) e Trakt (tendências, ratings, temporadas) através de funções Netlify que protegem as chaves.
- Modo detalhes com temporadas, episódios, trailers, notas pessoais e avaliação do utilizador.
- Painel de estatísticas com gráficos Chart.js, exportação de CSV e imagem e indicadores de tempo total de visualização.
- Sincronização local com IndexedDB (Dexie), migração automática a partir de `localStorage` e suporte offline com `vite-plugin-pwa`.
- Ferramentas de importação/exportação de dados, pesquisa rápida e modo grelha/lista persistente por secção.

## Stack tecnológica
- **Frontend:** Vite + TypeScript + HTML/CSS modularizados.
- **Estado e persistência:** Dexie (IndexedDB) com cache de temporadas e KV store para preferências.
- **UI e gráficos:** Chart.js, Font Awesome, animações personalizadas em `ui.ts`.
- **Automação:** Netlify Functions para proxies TMDb/Trakt, vite-plugin-pwa para assets offline.
- **Testes:** Vitest + Testing Library (ambiente jsdom).

## Requisitos
- Node.js 20 LTS (recomendado) e npm.
- Contas TMDb e Trakt com chaves de API válidas.
- Netlify CLI (utilizada via `npm run dev`; não é necessário instalar globalmente).

## Configuração e execução locais
1. Instalar dependências:
   ```bash
   npm install
   ```
2. Definir variáveis de ambiente (ficheiro `.env` ou `netlify env:set`):
   ```
   TMDB_API_KEY=...
   TRAKT_API_KEY=...
   ```
3. Iniciar o ambiente de desenvolvimento (Vite + proxies de funções):
   ```bash
   npm run dev
   ```
   O Netlify CLI expõe a app em `http://localhost:8888` e encaminha `/api/*` para as funções serverless.
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
```
├─ index.html            # Layout principal e secções da dashboard
├─ src/
│  ├─ api.ts             # Chamadas TMDb/Trakt e cache de temporadas
│  ├─ main.ts            # Ponto de entrada, listeners e fluxo de UI
│  ├─ state.ts           # Estado em memória + persistência Dexie
│  ├─ ui.ts              # Renderização, modais, gráficos e interacções
│  ├─ dom.ts             # Referências centralizadas ao DOM
│  ├─ db.ts              # Definição Dexie e stores IndexedDB
│  ├─ utils.ts           # Helpers (debounce, exportações, animações)
│  ├─ types.ts           # Tipagens TMDb/Trakt/local
│  └─ style.css          # Tema e responsividade
├─ netlify/
│  └─ functions/         # Proxies serverless TMDb/Trakt
└─ vite.config.ts        # Configuração Vite + PWA + Vitest
```

## Testes
Os testes existentes concentram-se em `src/utils.test.ts`. Para expandir a cobertura, priorizar:
- Fluxos críticos (`addSeriesToWatchlist`, gestão de episódios, exportações).
- Componentes que manipulam o IndexedDB (mockando Dexie).
- Renderização do detalhe da série (Testing Library + jsdom).

```
npm run test
npm run coverage
```

## Convenções e boas práticas
- Código em TypeScript com módulos coesos (`api`, `state`, `ui`).
- Uso de `processInBatches` para rate limiting e redução de chamadas simultâneas à API.
- Preferência por funções puras utilitárias em `utils.ts`, mantendo `ui.ts` focado na camada de apresentação.
- Preferências de utilizador e caches guardadas em IndexedDB (`kvStore`, `seasonCache`).
- CSP definida em `index.html` e todas as chamadas externas mediadas por funções serverless.

## Documentação complementar
- [ARQUITETURA](ARQUITETURA.md) – detalhe dos módulos, fluxos e decisões técnicas.
- [ROADMAP](ROADMAP.md) – visão da evolução prevista e tarefas futuras.

## Deploy
- Netlify é o alvo principal (`netlify.toml` define build, funções e rewrites `/api/*`).
- Para deploy manual basta executar:
  ```bash
  npm run build
  netlify deploy --prod
  ```
  (Certifique-se de que as chaves `TMDB_API_KEY` e `TRAKT_API_KEY` estão configuradas no ambiente Netlify.)

