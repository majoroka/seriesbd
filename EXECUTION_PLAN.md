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
- Consolidação `C1-C7` concluída
- Hardening pós-reauditoria `H1-H6` concluído
- Fase atual: **consolidação concluída e evolução funcional controlada**

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

### Consolidação e hardening

- `C1-C7` concluídos
- `F1` fallback editorial de livros concluído no escopo atual
- `H1` heartbeat fail-closed concluído
- `H2` unicidade estrutural de `display_name` concluída
- `H3` hardening do legado Netlify concluído
- `H3.1` remoção do runtime Netlify e migração do fluxo local para `Vite` concluída
- `H4` limpeza explícita de dados locais do dispositivo concluída
- `H5` processo reprodutível e bundle auditável concluídos
- `H6` governação server-side de `library_snapshots` concluída

## Em aberto real

1. monitorização pós-release
2. melhorias futuras opcionais
3. evolução funcional controlada

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
- Cloudflare confirmado como runtime canónico de produção, preview e estratégia local suportada
- `npm run dev` migrado para `vite` com proxy `/api/*` para origem Cloudflare configurável
- legado Netlify removido do fluxo local e do repositório

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

Estado atual do sprint:
- limite explícito para ficheiros de importação
- notas de utilizador truncadas de forma consistente para evitar payloads descontrolados
- progresso normalizado com clamp `0..100` em import, migração e sync remoto
- migração legada de `localStorage` com parsing seguro para JSON inválido
- snapshots locais/remotos rejeitados quando excedem o tamanho máximo suportado

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

Estado atual do sprint:
- `resize` do header móvel com debounce para evitar trabalho repetido em cascata
- métricas do dashboard consolidadas num único cálculo por render
- estatísticas com cache local por ciclo de render para evitar filtros, listas e resumos duplicados
- removido um render redundante da dashboard no arranque

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

Estado atual do sprint:
- empty states consolidados com tipografia e espaçamento coerentes
- modais principais alinhados por grupos de estilo partilhados em vez de CSS repetido
- títulos de modais de conta e listas avaliadas com hierarquia visual mais consistente
- sem redesenho estrutural nem alteração de fluxo

## Ordem recomendada

1. `C1 Segurança Frontend`
2. `C2 Endpoints e Hardening`
3. `C3 Runtime e Legado Netlify`
4. `C4 Dados, Import/Export e Snapshots`
5. `C5 Acessibilidade`
6. `C6 Performance`
7. `C7 Design System mínimo`
8. `F1 Fallback Editorial de Livros`

## Hardening pós-reauditoria

Estado do bloco:
- `H1-H6` concluídos

### H5 | Processo Reprodutível / Artefacto Limpo

Objetivo:
- tornar auditoria e validação externas realmente reproduzíveis.

Estado atual:
- `npm run verify:release` formaliza a validação mínima (`test:run` + `build`)
- `npm run bundle:audit` gera um zip limpo a partir do `HEAD`
- o bundle auditável passa a incluir checksum SHA-256 e metadata com `commit SHA`
- artefactos locais passam a ficar fora do pacote por construção
- `artifacts/` fica ignorado no repositório

Critério de fecho:
- pacote limpo e reproduzível sem `node_modules`, `dist` ou lixo local
- checklist de release alinhada com esse processo

### H6 | Governação Server-Side de Snapshots

Objetivo:
- reduzir dependência excessiva do cliente na integridade de `library_snapshots`.

Estado atual:
- nova migration para endurecer `public.library_snapshots`
- payload passa a ser validado server-side por tipo/estrutura mínima/tamanho
- `schema_version` fica limitado por constraint
- escrita autenticada deixa de ser `upsert` direto na tabela
- cliente passa a usar a RPC `public.upsert_library_snapshot(...)`

Critério de fecho:
- writes dos snapshots passam por validação server-side
- privilégios diretos de `insert/update` na tabela deixam de ser necessários ao cliente
- documentação Supabase alinhada com a nova migration

## Fase seguinte

### F1 | Fallback Editorial de Livros

Objetivo:
- enriquecer livros sem capa e/ou sinopse sem degradar metadata já boa.

Tarefas:
- manter ordem `Google Books -> Open Library -> Presença -> Goodreads`
- usar `Presença` apenas por `ISBN`
- usar `Goodreads` apenas como fallback tardio por título
- preencher apenas campos em falta:
  - capa
  - sinopse
- preservar a metadata principal quando já existe com qualidade aceitável

Critério de fecho:
- detalhes de livros continuam estáveis
- `Presença` mantém fallback rigoroso por `ISBN`
- `Goodreads` entra apenas quando os providers anteriores deixam lacunas

Estado atual da fase:
- implementado fallback editorial tardio com Goodreads
- `Goodreads` entra apenas após `Presença`
- endpoint `/api/books/fallback` suporta `provider=goodreads` e pesquisa por título
- frontend reconhece `Goodreads` como origem possível

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
