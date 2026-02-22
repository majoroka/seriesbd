# Issues GitHub (prontas a colar)

## P0-01 - Eliminar abertura duplicada da vista de detalhes
- Título: `fix(ui): evitar carregamento duplicado da vista de detalhes`
- Labels sugeridas: `bug`, `priority:p0`, `stability`, `frontend`
- Descrição:
  - Atualmente, o mesmo clique pode disparar mais de um fluxo para abrir detalhes da série.
  - Objetivo: garantir comportamento `1 clique -> 1 carregamento`.
- Critérios de aceitação:
  - [ ] Ao clicar num card de série, só existe um pedido de detalhes no Network.
  - [ ] Não há flicker/recarregamento imediato da mesma vista.
  - [ ] Pesquisa, tendências, populares e favoritas continuam a abrir detalhes corretamente.
- Ficheiros-alvo:
  - `src/ui.ts`
  - `src/main.ts`

## P0-02 - Corrigir concorrência em Estreias (load more)
- Título: `fix(premieres): bloquear concorrência e duplicados no load more`
- Labels sugeridas: `bug`, `priority:p0`, `stability`, `frontend`
- Descrição:
  - Cliques repetidos em "Ver Mais" podem causar duplicados ou paginação inconsistente.
  - Objetivo: serializar pedidos e manter ordem/contagem corretas.
- Critérios de aceitação:
  - [ ] Cliques rápidos em "Ver Mais" não duplicam itens.
  - [ ] A paginação mantém ordem previsível.
  - [ ] O botão fica desativado durante pedido ativo.
- Ficheiros-alvo:
  - `src/main.ts`
  - `src/api.ts`

## P0-03 - Corrigir persistência incorreta de total_episodes em falha
- Título: `fix(progress): não persistir total_episodes=0 em erro transitório`
- Labels sugeridas: `bug`, `priority:p0`, `stability`, `data-integrity`
- Descrição:
  - Em erro de rede, alguns fluxos podem persistir `total_episodes = 0`.
  - Objetivo: preservar valor anterior e recalcular após recuperação.
- Critérios de aceitação:
  - [ ] Falhas transitórias não sobrescrevem total de episódios para 0.
  - [ ] Depois de rede estável, totais são recalculados.
  - [ ] Progresso global não fica "preso" em valores incorretos.
- Ficheiros-alvo:
  - `src/main.ts`

## P0-04 - Sanitizar headers de erro na função Trakt
- Título: `fix(netlify): normalizar headers também nas respostas de erro do proxy Trakt`
- Labels sugeridas: `bug`, `priority:p0`, `backend`, `netlify-functions`
- Descrição:
  - O ramo de erro deve remover headers incompatíveis como no ramo de sucesso.
  - Objetivo: evitar falhas de parsing no cliente.
- Critérios de aceitação:
  - [ ] Respostas 4xx/5xx não incluem `content-encoding` nem `content-length` indevidos.
  - [ ] O frontend recebe erro consistente em JSON.
- Ficheiros-alvo:
  - `netlify/functions/trakt.mjs`

## P0-05 - UX explícita para offline e ação de retry
- Título: `feat(ux): estados offline explícitos e botão de tentar novamente`
- Labels sugeridas: `enhancement`, `priority:p0`, `ux`, `offline`
- Descrição:
  - Em modo offline, secções remotas falham sem feedback suficientemente explícito.
  - Objetivo: mensagens claras e ação de recuperação imediata.
- Critérios de aceitação:
  - [ ] Pesquisa/Tendências/Populares/Estreias mostram estado offline claro.
  - [ ] Em erro remoto, existe ação de retry visível.
- Ficheiros-alvo:
  - `src/main.ts`
  - `src/ui.ts`

## P1-01 - Reduzir custo da vista de detalhes
- Título: `perf(details): remover payloads grandes de dataset e otimizar estado em memória`
- Labels sugeridas: `enhancement`, `priority:p1`, `performance`, `frontend`
- Descrição:
  - Há serialização/parsing repetitivo de estruturas volumosas na vista de detalhes.
  - Objetivo: melhorar fluidez em séries com muitas temporadas/episódios.
- Critérios de aceitação:
  - [ ] Redução de operações `JSON.stringify/parse` no fluxo de detalhes.
  - [ ] Interações de episódios/temporadas sem jank visível.
  - [ ] Sem regressão funcional em marcações de vistos.
- Ficheiros-alvo:
  - `src/main.ts`
  - `src/ui.ts`
  - `src/state.ts`

## P1-02 - Acessibilidade completa para modais
- Título: `a11y(modals): role/aria, escape e focus trap`
- Labels sugeridas: `enhancement`, `priority:p1`, `accessibility`, `frontend`
- Descrição:
  - Melhorar semântica e navegação por teclado em todos os modais.
- Critérios de aceitação:
  - [ ] Modais com `role="dialog"` e `aria-modal="true"`.
  - [ ] Tecla `Escape` fecha modal ativo.
  - [ ] Focus trap funcional.
  - [ ] `:focus-visible` visível em controlos interativos.
- Ficheiros-alvo:
  - `index.html`
  - `src/main.ts`
  - `src/ui.ts`
  - `src/style.css`

## P1-03 - Retry/backoff seletivo nas chamadas críticas
- Título: `feat(api): aplicar retry/backoff a endpoints críticos com falhas transitórias`
- Labels sugeridas: `enhancement`, `priority:p1`, `resilience`, `frontend`
- Descrição:
  - Reutilizar `fetchWithRetry` apenas onde faz sentido (5xx/network), sem mascarar erros permanentes.
- Critérios de aceitação:
  - [ ] Retries não ocorrem em `AbortError`.
  - [ ] Retries só para erros transitórios.
  - [ ] UX continua responsiva em falhas persistentes.
- Ficheiros-alvo:
  - `src/api.ts`
  - `src/utils.ts`

## P1-04 - Cobertura de testes para fluxos críticos
- Título: `test: adicionar cobertura para fallback APIs e fluxos críticos de estado`
- Labels sugeridas: `enhancement`, `priority:p1`, `tests`, `quality`
- Descrição:
  - Expandir testes para reduzir regressões em áreas sensíveis.
- Critérios de aceitação:
  - [ ] Testes para fallback Trakt/TMDb.
  - [ ] Testes para import/export e integridade de dados.
  - [ ] Testes para marcação/desmarcação de episódios/temporadas.
- Ficheiros-alvo:
  - `src/*.test.ts`
  - setup/mocks de testes

## P2-01 - CSP por ambiente (dev vs produção)
- Título: `security(csp): separar política de segurança entre dev e produção`
- Labels sugeridas: `enhancement`, `priority:p2`, `security`, `frontend`
- Descrição:
  - Reduzir permissões em produção mantendo dev funcional.
- Critérios de aceitação:
  - [ ] Produção sem permissões inline desnecessárias.
  - [ ] Dev continua funcional com HMR.
- Ficheiros-alvo:
  - `index.html`
  - configuração de build/deploy

## P2-02 - Observabilidade mínima
- Título: `chore(observability): padronizar logs de erro e métricas básicas de falha`
- Labels sugeridas: `enhancement`, `priority:p2`, `observability`, `ops`
- Descrição:
  - Uniformizar contexto de erro para troubleshooting rápido.
- Critérios de aceitação:
  - [ ] Erros críticos incluem secção, endpoint e status.
  - [ ] Métrica básica por secção dinâmica (pesquisa, tendências, populares, estreias).
- Ficheiros-alvo:
  - `src/main.ts`
  - `netlify/functions/*.mjs`
