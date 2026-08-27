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
- Hardening final `R1-R5` concluído
- Fase atual: **estabilização concluída e manutenção evolutiva controlada**
- Últimas melhorias de UX aplicadas ao dashboard, onboarding e menus de topo
- Hardening do sync cloud concluído no escopo `S1-S10`, com conflitos explícitos, histórico de snapshots e ações manuais de recuperação
- Lógica transversal de lifecycle das séries alinhada por episódios lançados, com correção de reclassificação automática entre `Quero Ver`, `A Ver` e `Concluídos`

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
- Sugestões do dashboard por género real para séries e filmes, com rotação controlada e menor repetição recente
- Auto-add de séries à biblioteca ao marcar episódios/temporadas como vistos
- Onboarding de autenticação com reenvio de confirmação, recuperação de links expirados e branding `MediaDex` no email
- Menu da conta e popup de notificações com fecho automático em desktop ao sair com o rato
- Aviso único por sessão para mutações relevantes sem sessão iniciada
- Sync cloud endurecido:
  - proteção contra overwrite destrutivo
  - conflito explícito entre local e cloud
  - ações manuais `Restaurar da cloud` / `Substituir cloud com este dispositivo`
  - histórico remoto de snapshots com `deviceId` e `sync_reason`
- Lifecycle de séries endurecido:
  - classificação por episódios já lançados
  - reativação automática para `A Ver` quando saem episódios novos
  - badges e progresso coerentes com o total autoritativo de episódios
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
- `R1` hardening final do proxy `news-image` concluído
- `R2` `heartbeat` GET reduzido a health mínimo concluído
- `R3` redução de sinal e aperto do endpoint de `display_name` concluídos
- `R4` bundle auditável com checksum e metadata de commit concluído
- `R5` remoção da regra ampla de cache remota no service worker concluída

## Em aberto real

1. corrigir a vulnerabilidade transitiva `ws` reportada por `npm audit`
2. recuperar uma suite de testes totalmente verde e instituir CI em cada PR
3. criar uma camada recorrente de recuperação de dados orientada ao utilizador
4. monitorização pós-release e evolução funcional controlada

## Plano prioritário pós-relatório técnico (2026-08)

Objetivo:
- corrigir riscos reais de segurança, release e recuperação de dados;
- evitar refatorizações e otimizações sem evidência de impacto para o utilizador.

### P1 | Dependência vulnerável `ws`

Prioridade: alta

Problema confirmado:
- `npm audit --omit=dev` reporta uma vulnerabilidade alta transitiva em `ws@8.18.3`;
- a correção disponível atualiza `ws` para uma versão fora do intervalo vulnerável.

Plano:
- executar atualização controlada com `npm audit fix` ou atualização equivalente mínima no lockfile;
- rever o diff de dependências para evitar upgrades colaterais desnecessários;
- executar `npm run test:run` e `npm run build`;
- confirmar `0` vulnerabilidades altas ou críticas no audit final.

Critério de fecho:
- dependência `ws` fora do intervalo vulnerável;
- build e suite de testes sem regressões.

Estado:
- concluído em `2026-08-27`;
- `ws` atualizado de `8.18.3` para `8.21.3` apenas no lockfile;
- `npm audit --omit=dev` sem vulnerabilidades;
- `npm run build` passou;
- a suite mantém a falha de stale cache de notícias já registada no `P2`, sem nova regressão atribuída à atualização.

### P1.1 | Segurança do toolchain de desenvolvimento

Prioridade: alta

Contexto:
- o audit completo ainda reporta vulnerabilidades em ferramentas de desenvolvimento, incluindo `vite@7.3.1`, `vitest@4.0.18` e dependências de build do PWA;
- não são dependências distribuídas no bundle de produção, mas afetam máquinas de desenvolvimento e CI.

Plano:
- atualizar Vite, Vitest e `vite-plugin-pwa` de forma compatível e conjunta;
- rever alterações de configuração e de service worker geradas pelo PWA;
- executar `npm ci`, `npm audit`, testes completos e build;
- não expor o servidor Vite de desenvolvimento a redes não confiáveis até ao fecho.

Critério de fecho:
- `npm audit` sem vulnerabilidades críticas ou altas;
- ambiente de desenvolvimento, testes e PWA validados após a atualização.

### P2 | Release verificável e CI

Prioridade: alta

Problema confirmado:
- a suite atual não está completamente verde: o teste de stale cache de notícias falha em `functions/api/news.test.js`;
- não existe workflow versionado em `.github/workflows` para validar pull requests.

Plano:
- corrigir a causa do teste de notícias para que a suite seja determinística e passe integralmente;
- adicionar workflow GitHub Actions em pull requests e em `main`;
- executar `npm run verify:release` no workflow;
- usar cache de dependências npm e versão Node LTS fixada.

Critério de fecho:
- `npm run test:run` totalmente verde;
- `npm run verify:release` obrigatório no CI antes de merge;
- falhas de release visíveis no separador `Actions` do GitHub.

### P3 | Recuperação de dados pelo utilizador

Prioridade: alta

Contexto:
- o sync cloud tem proteções contra overwrite destrutivo, conflitos explícitos e histórico de snapshots;
- isto não substitui um backup independente, em especial enquanto o projeto Supabase não dispõe de backups automáticos no plano atual.

Plano:
- implementar o reminder `B1` de exportação periódica, com frequência inicial de `7 dias`;
- mostrar apenas a utilizadores com sessão ativa;
- permitir `Exportar agora`, `Lembrar mais tarde` e `Não voltar a mostrar`;
- registar a decisão do utilizador de forma sincronizada, quando aplicável;
- validar que a exportação continua restaurável por importação.

Critério de fecho:
- utilizador com sessão ativa recebe um lembrete não intrusivo após 7 dias;
- consegue exportar dados em um passo;
- não há perda de biblioteca, notas, progresso ou preferências no ficheiro exportado.

## Backlog futuro

### B1 | Reminder de export periódico ao utilizador

Objetivo:
- reduzir risco residual de perda de dados do lado do utilizador mesmo com sync endurecido

Ideia:
- mostrar uma sugestão periódica de exportação de dados
- frequência recomendada inicial:
  - `7 dias`

Regras recomendadas:
- só mostrar a utilizadores com sessão ativa
- não mostrar de forma intrusiva
- permitir:
  - `Exportar agora`
  - `Lembrar mais tarde`
  - `Não voltar a mostrar`

Critério de valor:
- cria uma camada simples de backup manual recorrente
- reduz dependência exclusiva do snapshot cloud atual

Estado:
- promovido ao sprint prioritário `P3`.

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

## Hardening final

Estado do bloco:
- `R1-R5` concluídos

### R1 | Endurecimento de `news-image`

Estado atual:
- bloqueio explícito de IPs privados, loopback e link-local
- redirects tratados manualmente com revalidação do destino final
- allowlist explícita de hosts reais usados pela app para imagens
- CORS do proxy restringido ao domínio principal da app

### R2 | Simplificação do `heartbeat` público

Estado atual:
- `GET /api/heartbeat` reduzido a resposta mínima de health
- removidos campos públicos desnecessários de configuração/operação

### R3 | Redução de enumeração em `display-name-available`

Estado atual:
- rate limit mais conservador
- resposta pública mais mínima

## Ajustes UX recentes

Estado do bloco:
- concluído no escopo atual

### Onboarding e autenticação

Estado atual:
- mensagem pós-registo clarifica envio do email, spam/lixo e expiração em `1 hora`
- ação de `Reenviar email de confirmação` disponível no modal de autenticação
- links expirados/ inválidos reabrem o modal com recuperação orientada
- emails Auth enviados com SMTP próprio e branding `MediaDex`

### Menus de topo

Estado atual:
- menu da conta:
  - sem sessão: `Entrar`, `Registar`, `Mudar Tema`
  - com sessão: ações de conta e dados locais, sem `Entrar`/`Registar`
- menu da conta fecha em desktop ao sair da sua área com pequeno delay
- popup de notificações fecha em desktop ao sair da sua área com pequeno delay

### Biblioteca e persistência local

Estado atual:
- primeira mutação relevante sem sessão mostra aviso único por sessão sobre persistência apenas local
- marcar episódios/temporadas como vistos pode adicionar automaticamente a série à biblioteca
- destino automático:
  - `A Ver` se a série continuar incompleta
  - `Concluídas/Arquivo` se a marcação completar a série

### Sugestões do dashboard

Estado atual:
- séries e filmes usam `discover` por género real em vez de pesquisa textual por nome do género
- reduzido o enviesamento de títulos com palavras como `Drama`
- rotação controlada com memória curta local para reduzir repetição recente
- CORS restringido ao domínio principal
- índice único na base de dados mantido como autoridade final

### R4 | Rigor do bundle auditável

Estado atual:
- bundle auditável passa a incluir checksum SHA-256
- metadata inclui `commit SHA`, timestamp UTC e ref/branch
- checklist e documentação alinhadas com o processo correto de entrega

### R5 | Service worker mais restrito

Estado atual:
- removida a regra ampla de cache para imagens HTTPS remotas
- mantidas apenas regras específicas e previsíveis para origens suportadas

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

### Conta e onboarding

- clarificar onboarding de confirmação de email com feedback visível, reenvio e branding já melhorados
- validar mais tarde se o fluxo de confirmação precisa de refinamento adicional após uso real
- quando uma conta nova entra com cloud vazia e o dispositivo já tem biblioteca local, substituir o push automático por decisão explícita:
  - usar biblioteca deste dispositivo
  - começar com biblioteca vazia
- manter como regra de futuras migrations Supabase:
  - tabelas novas em `public` com `RLS + policy + revoke/grant` explícitos
  - funções RPC novas com `revoke/grant execute` explícitos
  - isto evita impacto da mudança de default grants da Data API após `2026-10-30` em projetos existentes
- recuperação de password por email via Supabase Auth: concluída em `2026-08-21`
  - ação `Esqueci-me da password` no modal de login
  - envio com `resetPasswordForEmail(...)` e `redirectTo` para a app
  - modal dedicado para definir e confirmar a nova password
  - atualização com `updateUser({ password })`
  - tratamento de email enviado, link inválido/expirado e erros do provider
  - resposta de pedido genérica para não expor se um email existe
  - configuração manual e template documentados em `supabase/AUTH_EMAIL_SETUP.md`

### Internacionalização

- plano futuro documentado em [I18N_ROADMAP.md](./I18N_ROADMAP.md)
- ordem recomendada para implementação:
  - `I1` UI bilingue `pt/en`
  - `I2` providers locale-aware
  - `I3` fallback ao idioma original
  - `I4` tradução automática apenas de sinopses, com cache
- decisão atual:
  - não iniciar pela tradução automática
- lançar primeiro a infraestrutura i18n e o consumo locale-aware de metadados externos

### Engenharia e performance condicionais

Estes itens ficam em backlog. Só avançar quando houver métricas, crescimento de equipa ou regressão observável que justifique o custo:

- lazy-load de `Chart.js` e code splitting do bundle, após medição de impacto em Core Web Vitals;
- `manualChunks` apenas se a medição mostrar melhoria real de carregamento e cache;
- extração incremental de domínios de `main.ts` e `ui.ts`, sem refatorização massiva;
- virtualização da lista de episódios apenas se séries reais apresentarem degradação de render;
- testes visuais/Storybook depois de CI e testes de fluxos críticos estarem consolidados;
- novos retries apenas para pedidos idempotentes e falhas transitórias elegíveis; nunca reintroduzir retry automático em `429`;
- atualizar `baseline-browser-mapping` e `caniuse-lite` numa manutenção normal de dependências.

### Livros

- melhorias incrementais de capas/sinopses dentro da lógica atual
- sem reabrir novas fontes editoriais automáticas sem prova forte

## Histórico documental

Os ficheiros abaixo passam a histórico e deixam de ser a fonte principal de verdade:

- `SPRINTS.md`
- `ROADMAP.md`
- `DASHBOARD_V2_PLAN.md`

Esses ficheiros mantêm-se apenas para contexto histórico e transição.
