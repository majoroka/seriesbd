# Plano de Execução por Sprints

Estado atual: **Sprint 1 a Sprint 8 concluídos**.  
Pendente apenas: **S6-T06 (Cutover DNS para Cloudflare Pages)**.

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

## Sprint 7: Dashboard SaaS V2 (Entrada principal + Navegação)

Estado: **concluído**.

### Tarefas
- [x] S7-T01 Criar shell novo de layout com 3 áreas: sidebar fixa, conteúdo principal e coluna direita.
- [x] S7-T02 Implementar menu principal na sidebar: `Dashboard`, `Filmes`, `Séries`, `Livros`, `Biblioteca`.
- [x] S7-T03 Criar bloco intermédio da sidebar `ÁREA SUB-MENU` (dinâmico por secção ativa).
- [x] S7-T04 Mover ações de conta para top bar: avatar, nome, dropdown de conta.
- [x] S7-T05 Mover `Importar/Exportar` para dropdown de conta e limitar a utilizadores com sessão ativa.
- [x] S7-T06 Implementar cartões KPI em tempo real: `Séries`, `Filmes`, `Livros`, `Estatísticas`.
- [x] S7-T07 Implementar secção `GRÁFICOS DE EVOLUÇÃO E GÉNEROS` (linha + distribuição por géneros interativos).
- [x] S7-T08 Implementar secção `RECENTEMENTE VISTOS / LIDOS` com carrossel horizontal.
- [x] S7-T09 Implementar secção `PARA TI` com recomendações:
  - [x] cold-start por géneros mais consumidos globalmente;
  - [x] personalização por histórico do utilizador quando disponível.
- [x] S7-T10 Implementar coluna direita `PRÓXIMOS LANÇAMENTOS AGUARDADOS`.
- [x] S7-T11 Tornar `Dashboard` o ecrã de entrada padrão.

### Critérios de aceitação
- [x] Layout responsivo (desktop/tablet/mobile) sem regressões críticas nas secções atuais.
- [x] Visual consistente com tema atual da app (cores, gradientes, tipografia, cartões, sombras).
- [x] `Biblioteca` mantém funcionalidade atual e filtros existentes, sem duplicação de biblioteca por domínio.
- [x] Navegação por teclado e foco visível nos principais componentes (sidebar/top bar/cards/dropdowns).

## Sprint 8: Sub-menus por domínio + Notificações reais

Estado: **concluído**.

### Tarefas
- [x] S8-T01 Sub-menu de `Séries` com fluxos existentes:
  - [x] quero ver
  - [x] a ver
  - [x] próximo episódio
  - [x] tendências
  - [x] top rated
  - [x] estreias
  - [x] estatísticas
- [x] S8-T02 Sub-menu de `Filmes` com fluxos equivalentes:
  - [x] quero ver
  - [x] a ver
  - [x] tendências
  - [x] top rated
  - [x] estreias
  - [x] estatísticas
- [x] S8-T03 Sub-menu de `Livros` com fluxos equivalentes:
  - [x] quero ler
  - [x] a ler
  - [x] tendências (com fallback `Brevemente` quando aplicável)
  - [x] top rated (com fallback `Brevemente` quando aplicável)
  - [x] estreias (com fallback `Brevemente` quando aplicável)
  - [x] estatísticas
- [x] S8-T04 Quando não houver fonte robusta para livros em determinada secção, mostrar estado `Brevemente` sem quebrar UX.
- [x] S8-T05 Implementar centro de notificações real (ícone de sino na top bar):
  - [x] próximo episódio a estrear;
  - [x] episódio lançado;
  - [x] filme/livro acompanhado lançado.
- [x] S8-T06 Persistir estado de notificações (lidas/não lidas) por utilizador e sessão local.

### Critérios de aceitação
- [x] Cada menu principal atualiza corretamente o `ÁREA SUB-MENU`.
- [x] Fluxos de séries continuam funcionais sem regressões.
- [x] Filmes e livros apresentam comportamento consistente com fallback seguro quando dados externos não existem.
- [x] Notificações não bloqueiam UX e respeitam sessão ativa do utilizador.
