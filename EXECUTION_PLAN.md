# Execution Plan

Documento principal de execução do projeto.

Objetivo:
- manter uma única fonte de verdade para estado, prioridades e próximos passos;
- reduzir divergência entre ficheiros de planeamento;
- separar claramente o que está concluído, o que está em consolidação e o que fica para evolução futura.

## Estado atual

- Produção ativa em `mediadex.app`
- `www.mediadex.app` redireciona para o apex
- `staging` continua separado para validação antes de `main`
- Sprint 1 a Sprint 13 concluídos no escopo previsto
- Cutover DNS (`S6-T06`) concluído
- Dashboard V2 concluída no escopo atual
- Fase atual: **consolidação técnica e funcional**

## Resumo executivo

A app já está funcionalmente madura e em produção controlada.

O foco deixou de ser adicionar grandes blocos de funcionalidade e passou a ser:

1. reduzir risco técnico
2. endurecer segurança e operação
3. estabilizar dados e sync
4. melhorar acessibilidade, performance e consistência visual

## Concluído

### Infraestrutura e release

- Cloudflare Pages em produção
- Domínio final ativo
- Redirect `www -> apex`
- QA/UAT e rollout concluídos
- RSS estabilizado e validado

### Produto

- Dashboard SaaS V2
- Séries, filmes e livros integrados
- Biblioteca única
- Estatísticas globais no escopo atual
- Notícias RSS com múltiplas fontes e balanceamento
- Perfil básico de conta
- Reviews externas MVP no detalhe:
  - séries
  - filmes
  - livros com estado vazio honesto

## Em aberto real

1. monitorização pós-release
2. consolidação técnica e funcional
3. melhorias futuras opcionais

## Plano de consolidação

### Sprint C1 | Segurança Frontend

Objetivo:
- reduzir superfície XSS e clarificar a fronteira entre HTML interno e conteúdo externo/importado.

Tarefas:
- inventariar todos os usos de `innerHTML`
- classificar por risco
- substituir os casos simples por DOM seguro / `textContent`
- definir regra explícita para usos aprovados de HTML bruto
- remover HTML bruto de erros e estados simples

Critério de fecho:
- inventário completo
- redução material dos casos mais arriscados
- sem regressões visuais relevantes

### Sprint C2 | Endpoints e Hardening

Objetivo:
- endurecer endpoints públicos e alinhar headers/erros de produção.

Tarefas:
- endurecer `display-name-available`
- remover detalhe técnico de respostas públicas
- rever respostas de erro dos proxies
- ativar `Strict-Transport-Security`
- rever CORS, métodos e validação input/output

Critério de fecho:
- respostas públicas mínimas e consistentes
- HSTS ativo em produção
- contratos de API preservados

### Sprint C3 | Runtime e Legado Netlify

Objetivo:
- reduzir duplicação entre Cloudflare e Netlify sem quebrar o fluxo atual.

Tarefas:
- decidir o papel residual de `netlify/`
- documentar produção/preview como Cloudflare
- remover ou isolar configs Netlify redundantes
- manter só o mínimo indispensável para dev, se necessário

Critério de fecho:
- arquitetura de runtimes clara
- menos dívida operacional
- sem quebra de `staging` ou `main`

Estado atual do sprint:
- Cloudflare confirmado como runtime canónico de produção e preview
- `netlify/` mantido apenas como compatibilidade local legada
- novas alterações backend devem concentrar-se em `functions/api/*`

### Sprint C4 | Dados, Import/Export e Snapshots

Objetivo:
- reforçar integridade de dados, limites e previsibilidade operacional.

Tarefas:
- limite de tamanho no import
- schema validation mais estrita
- limites para notas e payloads persistidos
- rever quotas e retenção de snapshots
- definir comportamento para payload inválido

Critério de fecho:
- imports inválidos rejeitados com segurança
- export/sync preservados
- sem regressão de notas, progresso e biblioteca

### Sprint C5 | Acessibilidade Sistemática

Objetivo:
- tornar a acessibilidade transversal e não apenas pontual.

Tarefas:
- auditoria curta com Lighthouse/axe
- rever foco visível, tabulação e contraste
- rever labels e nomes acessíveis
- garantir estados não dependentes só de cor/ícone

Critério de fecho:
- flows principais navegáveis por teclado
- modais, menu da conta, notificações e detalhes revistos

### Sprint C6 | Performance de Vistas Densas

Objetivo:
- antecipar gargalos antes de crescerem com bibliotecas maiores.

Tarefas:
- medir dashboard, biblioteca, detalhes e estatísticas
- identificar re-renders evitáveis
- aplicar lazy/progressive render onde houver ganho claro
- avaliar virtualização apenas se a medição justificar

Critério de fecho:
- baseline antes/depois
- melhorias guiadas por medição
- sem regressão visual

### Sprint C7 | Design System Mínimo

Objetivo:
- consolidar padrões visuais e de interação sem redesenho total.

Tarefas:
- normalizar headings, cards, modais, accordions, empty states e botões
- consolidar tokens visuais existentes
- uniformizar microcopy de loading, erro e vazio
- reduzir inconsistências entre secções

Critério de fecho:
- padrões mínimos documentados
- menor heterogeneidade entre áreas
- revisão visual desktop/tablet/mobile aprovada

## Ordem recomendada

1. `C1 Segurança Frontend`
2. `C2 Endpoints e Hardening`
3. `C3 Runtime e Legado Netlify`
4. `C4 Dados, Import/Export e Snapshots`
5. `C5 Acessibilidade`
6. `C6 Performance`
7. `C7 Design System mínimo`

## Como acompanhar cada sprint

### Antes do sprint

Confirmar:
- objetivo
- escopo fechado
- risco principal
- critério de fecho

### Durante o sprint

Verificar:
- se o escopo está a crescer
- que ficheiros principais estão a ser tocados
- se as alterações são reversíveis
- se há risco de regressão visível

### No fecho do sprint

Validar sempre:
- `npm run build`
- smoke test manual curto:
  - dashboard
  - notícias
  - detalhe de série
  - detalhe de filme
  - detalhe de livro
  - biblioteca
  - estatísticas

### Critério para avançar

Só avançar se:
- `staging` estiver estável
- não houver regressão crítica
- o objetivo do sprint estiver realmente fechado

## Backlog futuro opcional

### Estatísticas globais

- tempo consumido agregado
- top ratings globais adicionais
- refinamentos visuais futuros

### Reviews

- expandir reviews externas
- validar eventual integração útil com Trakt
- reviews internas de utilizadores da app
- reviews por episódio ficam para fase posterior

### Livros

- melhorias incrementais de capas/sinopses dentro da lógica atual
- sem reabrir novas fontes editoriais automáticas sem prova forte

## Histórico documental

Os ficheiros abaixo passam a histórico e deixam de ser a fonte principal de verdade:

- `SPRINTS.md`
- `ROADMAP.md`
- `DASHBOARD_V2_PLAN.md`

Esses ficheiros mantêm-se apenas para contexto histórico e transição.
