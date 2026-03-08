# Plano de Execução por Sprints

Estado atual: concluído até **S6-T05** (pendente apenas **S6-T06**).

## Sprint 1: Infra Cloudflare + Paridade Série (MVP técnico)

### Tarefas
- [x] S1-T01 Criar projeto Cloudflare Pages ligado ao repo.
- [x] S1-T02 Configurar build (`vite build`), publish (`dist`) e variáveis de ambiente.
- [x] S1-T03 Migrar Netlify Functions para Pages Functions mantendo contratos `/api/tmdb/*`, `/api/trakt/*`, `/api/tvmaze/*`.
- [x] S1-T04 Reproduzir CSP/headers/redirects equivalentes.
- [x] S1-T05 Validar fluxo atual de séries ponta-a-ponta em staging.

### Critérios de aceitação
- [x] Pesquisa, detalhes, tendências, top rated e estreias funcionam em Cloudflare staging.
- [x] Sem exposição de chaves API no browser.
- [x] Erros/latência continuam visíveis em logs.
- [x] App atual em Netlify mantém-se intacta.

## Sprint 2: Supabase Auth + RLS + Keepalive

### Tarefas
- [x] S2-T01 Criar projeto Supabase e schema inicial (`profiles`, `user_settings`).
- [x] S2-T02 Implementar autenticação (signup, login, logout, reset password).
- [x] S2-T03 Configurar modo de registo invite-only (recomendado) com opção futura de open.
- [x] S2-T04 Ativar RLS e policies por `auth.uid()` nas tabelas de utilizador.
- [x] S2-T05 Criar endpoint heartbeat + Cloudflare Worker Cron Trigger de 3 em 3 dias.
- [x] S2-T06 Guardar prova de atividade em `system_heartbeat`.

### Critérios de aceitação
- [x] Utilizador não autenticado não acede a dados privados.
- [x] Utilizador autenticado só vê/edita os próprios dados.
- [x] Cron executa automaticamente e grava heartbeat.
- [x] Fluxos de auth funcionam sem quebrar UX atual.

## Sprint 3: Modelo Multi-Media (Series + Movies + Books)

### Tarefas
- [x] S3-T01 Refactor de tipos para `media_type` (`series`, `movie`, `book`).
- [x] S3-T02 Criar tabelas centrais (`media_items`, `user_library`, `user_notes_ratings`, `user_progress`).
- [x] S3-T03 Adaptar estado local para modelo genérico mantendo estilo visual existente.
- [x] S3-T04 Implementar migração de dados locais de séries para novo modelo.
- [x] S3-T05 Ajustar import/export para suportar os 3 tipos.

### Critérios de aceitação
- [x] Toda a funcionalidade de séries continua funcional.
- [x] Estrutura já suporta filmes e livros sem hacks.
- [x] Migração local preserva dados existentes de séries.

## Sprint 4: Integração Filmes e Livros (APIs grátis)

### Tarefas
- [x] S4-T01 Filmes: usar TMDb (`/movie`) com chave já existente.
- [x] S4-T02 Livros: integrar Google Books API (com key).
- [x] S4-T03 Livros fallback: Open Library para robustez de resultados/capas.
- [x] S4-T04 Criar pesquisa, detalhe e adicionar à biblioteca para filmes.
- [x] S4-T05 Criar pesquisa, detalhe e adicionar à biblioteca para livros.
- [x] S4-T06 Regras de progresso: filme visto/não visto; livro páginas ou % lido.

### Critérios de aceitação
- [x] É possível adicionar/remover/arquivar filme e livro.
- [x] Detalhes de filme/livro carregam com fallback funcional.
- [x] Limites/erros de API têm mensagem clara e retry.

## Sprint 5: Dashboard Nova (3 quadros grandes) + Navegação

### Tarefas
- [x] S5-T01 Criar dashboard inicial com 3 cards grandes: Séries, Filmes, Livros.
- [x] S5-T02 Cada card mostra métricas rápidas (total, em progresso, concluídos).
- [x] S5-T03 Navegação por secção com botão claro “Voltar à Dashboard”.
- [x] S5-T04 Manter identidade visual atual (cores, fonts, spacing, tokens).
- [x] S5-T05 Responsividade e acessibilidade (teclado, foco, labels ARIA).

### Critérios de aceitação
- [x] Dashboard é ecrã inicial padrão.
- [x] Navegação entre dashboard e secções é fluida e previsível.
- [x] UI de filmes/livros mantém o mesmo look & feel da app atual.

## Sprint 6: Hardening, QA, Go-live e Cutover

### Tarefas
- [x] S6-T01 Testes críticos (auth, RLS, CRUD dos 3 tipos, progresso, sync).
- [x] S6-T02 Testes de regressão da secção séries.
- [x] S6-T03 Observabilidade mínima (logs estruturados, erros por endpoint, métricas básicas).
- [x] S6-T04 Segurança: rate-limit, validação input, revisão CSP.
- [x] S6-T05 UAT com checklist formal + plano de rollback.
- [ ] S6-T06 Cutover DNS para Cloudflare Pages quando aprovado.

### Critérios de aceitação
- [ ] Checklist de go-live aprovado sem bloqueadores P0/P1.
- [x] Rollback testado e documentado.
- [ ] Produção estável durante janela de monitorização pós-lançamento.
