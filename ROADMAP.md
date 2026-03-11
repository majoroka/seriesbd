# Roadmap

## Estado atual

- MVP funcional disponível como PWA offline-first.
- Biblioteca local com gestão completa (watchlist, arquivo, notas, ratings).
- Integração com TMDb/Trakt/TVMaze via Cloudflare Pages Functions e cache de temporadas.
- Estatísticas com gráficos e exportações, import/export completo da base local.
- Dashboard SaaS V2 entregue (shell, cards KPI, gráficos, sugestões, lançamentos, sub-menus por domínio e notificações reais).
- Plano de execução da dashboard mantido em [DASHBOARD_V2_PLAN.md](./DASHBOARD_V2_PLAN.md).

## ✅ Recém-adicionado

- **Vista de Detalhes V2**: Implementada uma nova UI imersiva para a página de detalhes da série, com backdrop dinâmico e layout melhorado.
- **Vista em Grelha**: Adicionada a opção de visualizar as listas de séries em formato de grelha, focada nos posters.
- **Secção de Tendências**: Introduzidos carrosséis na dashboard para mostrar as séries em tendência diária e semanal.
- **Melhorias de Responsividade**: Otimizado o layout para ecrãs de diferentes tamanhos, incluindo a nova vista de detalhes e a grelha de estatísticas.
- **CSP por Ambiente (P2-01)**: política separada para desenvolvimento (`vite.config.ts`) e produção (`public/_headers`) para equilibrar DX e segurança.
- **Observabilidade mínima (P2-02)**: logs com contexto por secção/endpoint/status, métricas básicas de falha e latência, e headers de troubleshooting nas funções proxy.
- **Integração TVMaze via proxy (P3-01)**: nova Cloudflare Pages Function (`/api/tvmaze/*`) com CORS/headers normalizados, observabilidade mínima e endpoint de resolução por IMDb com fallback por nome/ano.
- **Agregação PT-first multi-fonte (P3-02)**: detalhe da série passa a consolidar TMDb/Trakt/TVMaze com prioridade `pt-PT` -> `pt` -> `en` e fallback para EN mais completo quando PT não existe.
- **Ratings com 3 anéis (P3-03)**: bloco de avaliações na vista de detalhes passa a mostrar TMDb, Trakt e TVMaze, com anéis mais finos e cor TVMaze `#386e67`.
- **Matching hardening (P3-04)**: resolução entre fontes agora prioriza IMDb, usa fallback nome+ano com score mínimo e descarta matches fracos para reduzir falsos positivos.
- **Testes de regressão da agregação (P3-05)**: cobertura adicionada para PT vs EN, EN mais completo, ratings de 3 fontes e falha parcial de providers.
- **Sprint 7 concluído**: dashboard como ecrã de entrada, shell SaaS, top bar/conta, KPI, gráficos, recentes, sugestões e lançamentos.
- **Sprint 8 concluído**: sub-menu dinâmico por domínio (séries/filmes/livros), fallback `Brevemente` para livros e centro de notificações real com estado persistido.

## Em preparação imediata

1. **Cutover DNS (S6-T06)**
   - Ligar domínio definitivo ao projeto Cloudflare Pages quando aprovado.
   - Janela controlada de monitorização pós-cutover.
2. **UI/UX polishing**
   - Ajustes finos visuais e de responsividade sem regressões funcionais.
   - Harmonização final de detalhes na dashboard e secções de detalhe.
3. **Hardening final (PR-5)**
   - Acessibilidade e micro-interações finais.
   - Regressão manual curta antes de promover para `main`.

## Roadmap futuro: Reviews da Comunidade

1. **R1 | Reviews por título (MVP)**
   - Séries/Filmes: reviews textuais por título (não por episódio).
   - Livros: rating agregado + contagem de avaliações quando não houver review textual.
2. **R2 | Bloco de reviews no detalhe**
   - Secção `Avaliações da Comunidade` com fonte, autor, data, rating e excerto.
   - Paginação incremental (`Ver mais`) para não degradar o tempo de render.
3. **R3 | Filtros e ordenação**
   - Filtro por fonte e idioma (prioridade `pt-PT` -> `pt` -> `en`).
   - Ordenação por relevância, data e avaliação.
4. **R4 | Fallbacks e estados UX**
   - Estados claros para `sem reviews`, `offline`, `rate limit` e `fonte indisponível`.
   - Mensagem explícita quando a fonte não disponibiliza review textual.
5. **R5 | Observabilidade e performance**
   - Cache por título/fonte + lazy load no detalhe.
   - Métricas básicas de erro/latência por provider.
6. **R6 | Fase 2 opcional (reviews por episódio)**
   - Avaliar extensão para comentários por episódio em séries (provider a confirmar).
   - Implementar apenas após estabilidade do MVP por título.

## Backlog técnico (pronto para issues)

### P0 - Estabilidade imediata

1. **P0-01 | Eliminar abertura duplicada da vista de detalhes**
   - Objetivo: garantir 1 clique -> 1 carregamento de detalhes.
   - Impacto esperado: menos aborts, menos flicker, navegação mais fluida.
   - Ficheiros alvo: `src/ui.ts`, `src/main.ts`.
   - Critérios de aceitação:
   - Ao clicar num card de série, só existe 1 pedido para detalhes no Network.
   - Não ocorre recarregamento visual imediato da mesma vista.
   - Não há regressão em pesquisa, tendências, populares e favoritas.

2. **P0-02 | Corrigir concorrência em Estreias (`load more`)**
   - Objetivo: impedir duplicados e ordem inconsistente com cliques repetidos.
   - Impacto esperado: secção Estreias previsível e estável.
   - Ficheiros alvo: `src/main.ts`, `src/api.ts`.
   - Critérios de aceitação:
   - Cliques rápidos em "Ver Mais" não duplicam séries.
   - A paginação mantém ordem e contagem corretas.
   - O botão fica bloqueado enquanto houver pedido ativo.

3. **P0-03 | Corrigir persistência de `total_episodes` em falha de rede**
   - Objetivo: evitar gravar `0` definitivo quando a API falha.
   - Impacto esperado: progresso global fiável.
   - Ficheiros alvo: `src/main.ts`.
   - Critérios de aceitação:
   - Em erro temporário, o valor anterior é mantido.
   - Após recuperação de rede, os totais são recalculados corretamente.
   - Não há séries "presas" com progresso 0% por erro transitório.

4. **P0-04 | Sanitizar respostas de erro na função Trakt**
   - Objetivo: aplicar tratamento de headers também no ramo de erro.
   - Impacto esperado: menos erros de parsing no cliente.
   - Ficheiros alvo: `functions/api/trakt/[[path]].js`.
   - Critérios de aceitação:
   - Em respostas 4xx/5xx da Trakt, não são enviados headers incompatíveis (`content-encoding`, `content-length`).
   - A app recebe erro JSON consistente.

5. **P0-05 | Feedback explícito de modo offline e "tentar novamente"**
   - Objetivo: UX clara quando endpoints remotos não estão disponíveis.
   - Impacto esperado: menos dúvidas do utilizador em modo offline.
   - Ficheiros alvo: `src/main.ts`, `src/ui.ts`.
   - Critérios de aceitação:
   - Pesquisa/Tendências/Populares/Estreias mostram estado "offline" quando aplicável.
   - Mensagens de erro incluem ação de retry.

### P1 - Robustez e UX

1. **P1-01 | Reduzir custo da vista de detalhes (sem JSON gigante em `dataset`)**
   - Objetivo: mover estruturas volumosas para memória controlada em vez de `dataset`.
   - Impacto esperado: menos jank em séries longas.
   - Ficheiros alvo: `src/main.ts`, `src/ui.ts`, `src/state.ts`.
   - Critérios de aceitação:
   - Interações em temporadas/episódios mantêm fluidez.
   - Não há regressão em marcar episódio/temporada.

2. **P1-02 | Acessibilidade completa para modais**
   - Objetivo: melhorar navegação por teclado e semântica ARIA.
   - Impacto esperado: conformidade e usabilidade para teclado/leitores de ecrã.
   - Ficheiros alvo: `index.html`, `src/main.ts`, `src/ui.ts`, `src/style.css`.
   - Critérios de aceitação:
   - Modais com `role="dialog"` e `aria-modal="true"`.
   - `Escape` fecha modal ativo.
   - Focus trap ativo e foco inicial no elemento principal.
   - Estados `:focus-visible` visíveis em botões/inputs.

3. **P1-03 | Aplicar retry/backoff seletivo nas chamadas críticas**
   - Objetivo: usar `fetchWithRetry` em endpoints mais suscetíveis a falhas transitórias.
   - Impacto esperado: menos falhas percebidas em rede instável.
   - Ficheiros alvo: `src/api.ts`, `src/utils.ts`.
   - Critérios de aceitação:
   - Retries apenas para erros transitórios (5xx/network), nunca para abortos.
   - UX não fica bloqueada em falhas persistentes.

4. **P1-04 | Cobertura de testes para fluxos críticos**
   - Objetivo: reduzir regressões nas áreas mais sensíveis.
   - Impacto esperado: entregas mais seguras.
   - Ficheiros alvo: `src/*.test.ts` (novos), setup de testes.
   - Critérios de aceitação:
   - Testes para fallback Trakt/TMDb.
   - Testes para import/export e integridade de dados.
   - Testes para transição de estado ao marcar/desmarcar episódios.

### P2 - Hardening e operação

1. **P2-01 | CSP por ambiente (dev vs produção)**
   - Objetivo: reduzir superfície de ataque em produção.
   - Impacto esperado: postura de segurança mais forte.
   - Ficheiros alvo: `index.html`, configuração de build/deploy.
   - Critérios de aceitação:
   - Produção sem política permissiva desnecessária.
   - Dev mantém fluxo de trabalho funcional.

2. **P2-02 | Observabilidade mínima de erros e performance**
   - Objetivo: identificar regressões rapidamente em produção.
   - Impacto esperado: troubleshooting mais rápido.
   - Ficheiros alvo: `src/main.ts`, `functions/api/*`.
   - Critérios de aceitação:
   - Erros críticos com contexto mínimo (secção, endpoint, status).
   - Métricas básicas de falha por secção dinâmica.

### P3 - Agregação multi-fonte (TMDb + Trakt + TVMaze)

1. **P3-01 | Integrar TVMaze via Cloudflare Pages Function**
   - Objetivo: adicionar 3.ª fonte de dados para enriquecer detalhes da série.
   - Impacto esperado: maior cobertura de metadados e ratings.
   - Ficheiros alvo: `functions/api/tvmaze/[[path]].js`.
   - Critérios de aceitação:
   - Endpoint proxy para TVMaze com CORS/headers normalizados.
   - Lookup por `imdb_id` e fallback por nome/ano.
   - Observabilidade mínima equivalente às outras functions (`requestId`, status, latência).

2. **P3-02 | API de agregação com prioridade PT**
   - Objetivo: fundir TMDb/Trakt/TVMaze por campo, com regra linguística consistente.
   - Impacto esperado: conteúdos mais completos e em português sempre que possível.
   - Ficheiros alvo: `src/api.ts`, `src/types.ts`, `src/main.ts`.
   - Critérios de aceitação:
   - Prioridade de idioma: `pt-PT` -> `pt` -> `en`.
   - Quando não houver PT, escolher EN mais completa (maior completude de texto).
   - Falha de uma fonte não bloqueia render dos detalhes.

3. **P3-03 | UI de ratings com 3 anéis (TMDb/Trakt/TVMaze)**
   - Objetivo: mostrar também classificação TVMaze nos detalhes.
   - Impacto esperado: leitura comparativa de ratings entre três fontes.
   - Ficheiros alvo: `src/ui.ts`, `src/style.css`.
   - Critérios de aceitação:
   - Bloco de avaliações exibe TMDb, Trakt e TVMaze quando disponíveis.
   - Círculos concêntricos ficam ligeiramente mais finos para acomodar o 3.º anel.
   - Cor fixa TVMaze: `#386e67`.
   - Legenda inclui linha "TVMaze" com valor formatado.

4. **P3-04 | Estratégia de matching e qualidade de dados**
   - Objetivo: reduzir falsos positivos na correspondência entre fontes.
   - Impacto esperado: menos dados incorretos nos detalhes.
   - Ficheiros alvo: `src/api.ts`, `src/main.ts`.
   - Critérios de aceitação:
   - Match preferencial por `imdb_id`; fallback por nome + ano com score mínimo.
   - Quando match for fraco, descartar fonte em vez de arriscar dados errados.
   - Logs de fallback/match para troubleshooting.

5. **P3-05 | Testes de regressão para agregação PT-first**
   - Objetivo: proteger a nova lógica contra regressões.
   - Impacto esperado: entregas mais seguras e previsíveis.
   - Ficheiros alvo: `src/api.test.ts`, novos testes de integração leve.
   - Critérios de aceitação:
   - Casos de teste cobrindo PT disponível vs fallback EN.
   - Casos de teste cobrindo escolha do EN mais completo.
   - Casos de teste cobrindo ratings de 3 fontes e falha parcial de providers.

## Definição de pronto para cada issue

1. Inclui objetivo, escopo e risco de regressão.
2. Tem critérios de aceitação testáveis (manual + automatizado).
3. Identifica ficheiros principais a tocar.
4. Define validação offline e online quando aplicável.
5. Não mistura correções P0 com refactors sem impacto direto.

## Curto prazo (próximos sprints)

1. **Qualidade e testes**
   - Expandir Vitest/Testing Library para cobrir fluxos críticos (adicionar série, marcar episódios, import/export).
   - Introduzir testes de regressão para `updateNextAired` e `processInBatches`.
2. **Resiliência de rede**
   - Implementar retries/exponencial para chamadas Trakt (com feedback na UI).
   - Guardar fila de ações offline (marcações de episódios) para sincronizar quando a API voltar.
3. **UX das secções dinâmicas**
   - Paginação/scroll infinito em populares e estreias com placeholders skeleton.
   - Guardar estado dos filtros (dia/semana) nos trending.
4. **Documentação viva**
   - Adicionar guias rápidos (vídeo/gifs) e FAQ ao README.
   - Automatizar lint/checks de documentação no CI.

## Médio prazo

1. **Sincronização multi-dispositivo**
   - Investigar backend simples (Cloudflare KV / Supabase) para sincronizar biblioteca opcionalmente.
   - Autenticação leve (OAuth TMDb/Trakt ou magic link) para utilizadores que desejem sync.
2. **Notificações e alertas**
   - Push notifications para episódios novos (APIs Web Push + background sync).
   - Alertas agendados para estreias marcadas como favoritas.
3. **Internacionalização e acessibilidade**
   - Externalizar strings e suportar pelo menos en-US.
   - Auditar navegação por teclado, roles ARIA e contrastes.
4. **Mobile-first**
   - Refinar layout responsivo, incorporar gestures e atalhos (p.ex. swipe para marcar visto).

## Longo prazo / visão

1. **Recomendações personalizadas**
   - Analisar ratings/notas para sugerir novas séries (modelos simples + dados Trakt).
   - Integrar com listas públicas do Trakt ou Perfis TMDb.
2. **Partilha e colaboração**
   - Permitir partilhar bibliotecas ou listas com outros utilizadores (modo leitura).
3. **Aplicação nativa**
   - Avaliar wrapper Capacitor/Tauri para distribuição desktop/mobile com notificações nativas.
4. **Ecossistema**
   - Expor uma API pública (GraphQL/REST) para integrações de terceiros.

## Iniciativas de suporte

- **CI/CD:** Configurar pipeline GitHub Actions + Cloudflare Pages com testes automáticos, lint e upload de coverage.
- **Observabilidade:** Adicionar captura de erros (Sentry) e métricas de performance Web Vitals.
- **Analytics:** Instrumentar eventos chave (adicionar série, exportar dados, marcações) com consentimento.

## Riscos e dependências

- **APIs externas:** Limites de rate e mudanças contractuais do TMDb/Trakt obrigam a monitorização contínua.
- **Persistência local:** IndexedDB varia por browser; é importante manter rutinas de migração/testes cross-browser.
- **Recursos:** Algumas funcionalidades (sync, push) exigem backend adicional e orçamento para infraestrutura.
