# Release Checklist

## Sprint 13

### Regressão automática
- [x] `npm test -- --run`
- [x] `npm run build`
- [ ] `npm run verify:release`

### Artefacto auditável
- [ ] worktree limpo (`git status` sem alterações)
- [ ] sem artefactos locais no pacote:
  - [ ] `node_modules`
  - [ ] `dist`
  - [ ] `.netlify`
  - [ ] `.wrangler`
  - [ ] `.DS_Store`
  - [ ] `__MACOSX`
- [ ] `npm run bundle:audit`
- [ ] zip gerado em `artifacts/`
- [ ] pacote criado a partir do `HEAD` commitado

### UAT em staging
- [ ] `Dashboard`
  - [ ] `Notícias` carrega até `20` itens quando existirem feeds válidos
  - [ ] Filtros `Todos / Séries / Filmes / Livros` funcionam
  - [ ] Há `1` a `2` notícias de livros no mix global quando existirem itens válidos
  - [ ] `Próximos Lançamentos`, `Recentemente` e `Sugestões` mantêm o comportamento esperado
- [ ] `Séries`
  - [ ] Watchlist, `A Ver`, `Concluídas`, `Estreias`, `Top Rated`, `Tendências`
  - [ ] detalhe, progresso e estatísticas
- [ ] `Filmes`
  - [ ] Watchlist, `A Ver`, `Concluídos`, `Estreias`, `Top Rated`, `Tendências`
  - [ ] detalhe, progresso e estatísticas
  - [ ] `Tempo de Cinema` deixa de ficar a `0` com filmes concluídos
- [ ] `Livros`
  - [ ] Watchlist, `A Ler`, `Concluídos`, detalhe e estatísticas
  - [ ] fallback editorial continua a preencher capa/sinopse quando aplicável
- [ ] `Biblioteca`
  - [ ] filtros por media
  - [ ] pesquisa
  - [ ] detalhe a partir da biblioteca
- [ ] `Autenticação e sync`
  - [ ] login / logout
  - [ ] sync mantém progresso de livros e biblioteca

### Acessibilidade / UX
- [ ] menu principal e submenu com teclado
- [ ] notificações e menu da conta fecham com `Escape`
- [ ] foco visível nas interações principais
- [ ] ações de episódios funcionam com `Tab` + `Enter/Espaço`

### Rollback rápido
- [ ] confirmar override imediato das notícias da dashboard:
  - [ ] `?dashboardNews=off`
  - [ ] `?dashboardNews=on`
- [ ] confirmar override persistente opcional:
  - [ ] `localStorage.setItem('seriesdb.dashboardNewsRollout', 'off')`
  - [ ] `localStorage.setItem('seriesdb.dashboardNewsRollout', 'on')`
- [ ] confirmar default de deploy por `VITE_DASHBOARD_NEWS_ENABLED`

### Go / No-Go
- [ ] sem bloqueadores `P0/P1`
- [ ] aprovação final em `staging`
- [ ] promoção para `main`
