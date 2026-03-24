# Dashboard V2 Plan (MediaDex)

Documento de execução da nova dashboard SaaS para a app, com foco em UI/UX moderna, rollout seguro e zero regressões funcionais.

## Objetivo

Transformar o ecrã inicial numa dashboard moderna e modular para consumo de media:
- séries
- filmes
- livros
- biblioteca

## Estado de execução (22 Mar 2026)

- Sprint 7 concluído.
- Sprint 8 concluído.
- Sprint 9 concluído.
- Sprint 10 concluído.
- Sprint 11 concluído.
- PR-1, PR-2, PR-3 e PR-4 concluídos e validados em staging.
- PR-5 concluído.
- PR-6, PR-7 e PR-8 concluídos e validados em staging.
- PR-10 concluído no escopo atual.
- Sprint 12 concluído.
- Sprint 13 concluído no escopo atual.
- Frente em aberto: **S6-T06** e **release final para `main`**.

## Sequência recomendada a partir do estado atual

1. **PR-5**
   - concluído.
2. **Sprint 12**
   - concluído.
3. **Sprint 13**
   - concluído no escopo atual; fica pendente apenas promoção controlada para `main`.
4. **S6-T06**
   - cutover DNS para Cloudflare Pages após validação.
5. **Pós-release**
   - logs/testes extra do fallback editorial e refinamentos incrementais da dashboard/estatísticas.

## Decisões já fechadas

- `Dashboard` passa a ser o ecrã de entrada.
- Menu principal da sidebar:
  - Dashboard
  - Filmes
  - Séries
  - Livros
  - Biblioteca
- `Biblioteca` é única e geral (mantém filtros atuais), sem bibliotecas separadas por domínio.
- Recomendações `Para Ti`:
  - sem histórico suficiente: géneros mais consumidos globalmente;
  - com histórico: personalização por consumo do utilizador.
- Notificações: implementar com eventos reais.

## Estratégia de rollout (anti-regressão)

- Implementar atrás de feature flags:
  - `dashboard_v2`
  - `recommendations_v1`
  - `notifications_v1`
- Validar sempre em `staging` antes de PR para `main`.
- Manter o layout atual disponível até aprovação formal.

## Fase 1 - Shell visual e navegação base

- DV2-T01 Criar layout 3 áreas:
  - sidebar esquerda fixa (220-250px)
  - área principal
  - coluna direita
- DV2-T02 Implementar top bar:
  - saudação com nome do user
  - pesquisa existente
  - ícone de notificações
  - conta (avatar + nome + dropdown)
- DV2-T03 Criar bloco central da sidebar: `ÁREA SUB-MENU`.
- DV2-T04 Rodapé da sidebar:
  - perfil
  - configurações
  - toggle tema claro/escuro
- DV2-T05 Estados auth no header:
  - sessão ativa: avatar/nome/dropdown
  - sessão inativa: `Entrar` + `Criar Conta`

## Fase 2 - Conteúdo da dashboard

- DV2-T06 Cards de estatísticas em tempo real:
  - SÉRIES
  - FILMES
  - LIVROS
  - ESTATÍSTICAS
- DV2-T07 Secção `GRÁFICOS DE EVOLUÇÃO E GÉNEROS`:
  - gráfico de linhas (evolução mensal por tipo de media)
  - gráfico donut (distribuição por géneros)
- DV2-T08 Secção `RECENTEMENTE VISTOS / LIDOS`:
  - carrossel horizontal
  - item com capa/poster, título e badge de estado
- DV2-T09 Secção `PARA TI`:
  - recomendações com fallback cold-start
  - recomendações personalizadas por histórico
- DV2-T10 Coluna direita:
  - `PRÓXIMOS LANÇAMENTOS AGUARDADOS`
  - lista vertical com poster + data destacada

## Fase 3 - Sub-menu por domínio

- DV2-T11 Clique em `Séries`:
  - carregar no sub-menu os fluxos já existentes
  - quero ver, a ver, próximo episódio, tendências, top rated, estreias, estatísticas
- DV2-T12 Clique em `Filmes`:
  - quero ver, a ver, tendências, top rated, estreias, estatísticas
  - ligar chamadas API onde existir suporte
- DV2-T13 Clique em `Livros`:
  - quero ler, a ler, tendências, top rated, estreias, estatísticas
  - se não houver dados robustos para uma secção: mostrar `Brevemente`
- DV2-T14 Clique em `Biblioteca`:
  - manter biblioteca geral atual
  - manter filtros atuais por estado/media/género

## Fase 4 - Conta, permissões e ações

- DV2-T15 Mover `Importar` e `Exportar` para dropdown da conta.
- DV2-T16 Restringir import/export a users autenticados.
- DV2-T17 Mensagens UX consistentes:
  - sessão inativa
  - erro de auth
  - ação indisponível sem conta

## Fase 5 - Notificações reais

- DV2-T18 Criar centro de notificações (dropdown/painel):
  - próximos episódios
  - episódios lançados
  - lançamentos de filmes aguardados
- DV2-T19 Persistir notificações lidas/não lidas por utilizador.
- DV2-T20 Atualizar badge de contagem sem bloquear navegação.

## Fase 6 - QA e Go-live interno

- DV2-T21 Testes de regressão séries/filmes/livros (fluxos já estáveis).
- DV2-T22 Testes de UI responsiva (desktop/tablet/mobile).
- DV2-T23 Acessibilidade base:
  - foco visível
  - navegação por teclado
  - labels ARIA em componentes críticos
- DV2-T24 Verificação de performance:
  - render inicial da dashboard
  - custo dos gráficos
  - carrosséis

## Fase 7 - Notícias RSS (substituição dos gráficos)

- DV2-T25 Criar agregador `/api/news` para múltiplas fontes RSS (séries/filmes/livros).
- DV2-T26 Normalizar campos: título, data, fonte, URL, tipo e imagem.
- DV2-T27 Substituir no dashboard o card de `GRÁFICO DE DESEMPENHO` por card `NOTÍCIAS`.
- DV2-T28 Priorizar notícias com imagem; aplicar fallback visual quando não houver media.
- DV2-T29 Introduzir deduplicação + cache por fonte para evitar lentidão e duplicados.
- DV2-T30 Adicionar filtros por domínio (`Todos`, `Séries`, `Filmes`, `Livros`) no card.
- DV2-T31 Personalizar relevância por histórico do utilizador (com fallback para feed geral).
- DV2-T32 Validar responsividade do card em desktop/tablet/mobile sem overflow.

## Fase 8 - Estatísticas Globais acionadas pelo card

- [x] DV2-T33 Tornar o card `Estatísticas` da dashboard clicável.
- [x] DV2-T34 Reutilizar `stats-section` em modo `global`, sem criar modal.
- [x] DV2-T35 Implementar `Resumo Global` consolidado.
- [x] DV2-T36 Redesenhar o resumo em 3 cartões globais:
  - [x] `Itens Concluídos`
  - [x] `Itens por Concluir`
  - [x] `Progresso Médio`
- [x] DV2-T37 Implementar donuts por tipo (`Séries`, `Filmes`, `Livros`) no resumo.
- [x] DV2-T38 Implementar `Top Géneros Globais`.
- [x] DV2-T39 Implementar `Conteúdos por Ano de Lançamento` global.
- [x] DV2-T40 Implementar `Os Meus Favoritos` separados por séries, filmes e livros.
- [x] DV2-T41 Garantir convivência correta com a navegação/filtros existentes.
- [ ] DV2-T42 Evolução futura opcional:
  - [ ] tempo consumido agregado
  - [ ] top ratings globais adicionais
  - [ ] refinamentos visuais futuros dos gráficos globais

## Plano de PRs recomendado

- [x] PR-1: Shell da dashboard, sidebar, top bar, tema e navegação base.
- [x] PR-2: Cards KPI + gráficos + recentes + lançamentos aguardados.
- [x] PR-3: Sub-menus por domínio e integração biblioteca geral.
- [x] PR-4: Recomendações personalizadas + notificações reais.
- [ ] PR-5: Hardening UX, acessibilidade e regressão final.
- [x] PR-6: Fundação do agregador RSS + contrato `/api/news`.
- [x] PR-7: UI do card de notícias e substituição do bloco de gráficos.
- [x] PR-8: Relevância/filtros + hardening + rollout controlado.
- [x] PR-10: Vista de Estatísticas Globais acionada pelo card `Estatísticas` (escopo atual entregue).

## Critérios de aceitação globais

- A dashboard nova é o ecrã de entrada.
- A identidade visual mantém coerência com o tema atual da app.
- `Biblioteca` geral mantém o comportamento anterior sem perda de funcionalidades.
- Séries não regressam funcionalmente.
- Filmes e livros têm fallback seguro quando faltar fonte de dados.
- Notificações funcionam com eventos reais e não degradam a UX.

## Riscos e mitigação

- Risco: regressões em fluxos atuais de séries.
  - Mitigação: feature flags + PRs pequenos + checklist de regressão.
- Risco: ausência de dados robustos para `tendências/top rated/estreias` em livros.
  - Mitigação: estados `Brevemente` e fallback explícito de UX.
- Risco: excesso de carga no render inicial.
  - Mitigação: lazy render por secção, reuse de componentes e cache de dados já existente.
