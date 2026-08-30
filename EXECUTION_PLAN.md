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
- Partilha pública `S1-S5` concluída e integrada em `main` pelo PR `#83`, com rotas públicas, Open Graph e rollout validado
- Integração Simkl concluída e ativa como provider opcional de enriquecimento para séries e filmes

## Resumo executivo

A app já está funcionalmente madura e em produção controlada.

O foco atual é manutenção evolutiva controlada:

1. garantir uma cópia de recuperação independente do Supabase
2. manter providers externos e sync sob observação
3. preservar a disciplina de release e os checks obrigatórios
4. corrigir apenas fricção UX/UI observada em uso real

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
- Partilha pública de séries, filmes e livros:
  - links canónicos sem dados privados
  - detalhe público em leitura sem sessão
  - Web Share API e fallback para cópia, WhatsApp, Facebook, X e email
  - previews sociais Open Graph e Twitter Card no edge
- Simkl como provider público complementar para avaliações e fallbacks editoriais de séries e filmes

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

## Prioridades ativas pós-Simkl

1. **Proteção de dados:** manter exportação recorrente e definir uma cópia de recuperação independente do Supabase.
2. **Operação dos providers:** manter Trakt em observação, sem nova intervenção enquanto a modalidade gratuita não mudar; Simkl assegura redundância de leitura.
3. **Disciplina de release:** manter `staging` -> PR -> checks obrigatórios -> `main` em todas as alterações.
4. **Atualização pontual UX/UI:** corrigir fricção observada em uso real, sem redesenho global nem expansão funcional prematura.

### U1 | Atualização pontual UX/UI

Objetivo:
- aumentar clareza e confiança nos fluxos existentes, sem abrir um projeto de redesign.

Âmbito:
- tornar mais explícitos os estados de carregamento, fallback e indisponibilidade de providers nos detalhes;
- manter mensagens de sync, exportação, restauro e conflito claras e orientadas à ação;
- rever empty states, erros e feedback após ações relevantes em desktop e mobile;
- aplicar ajustes apenas quando houver observação concreta de fricção ou inconsistência.

Fora de âmbito:
- alteração estrutural do dashboard ou da navegação;
- criação de novas áreas de produto;
- redesign visual amplo.

Estado:
- manutenção evolutiva contínua, priorizada após segurança de dados e estabilidade operacional.

## Prioridades concluídas pós-relatório técnico (2026-08)

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
- a suite de testes passou integralmente após o fecho do `P2`, sem regressão atribuída à atualização.

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

Estado:
- concluído em `2026-08-27`;
- Vite atualizado para `7.3.6`, Vitest para `4.1.11` e `vite-plugin-pwa` para `1.3.0`;
- atualizações transitivas de `esbuild`, `form-data`, `nanoid`, `picomatch` e `postcss` aplicadas dentro dos intervalos compatíveis;
- `npm audit` e `npm audit --omit=dev` sem vulnerabilidades;
- `npm ci` e `npm run build` passaram, incluindo a geração do service worker;
- a suite de testes passou integralmente após o fecho do `P2`, sem regressão atribuída à atualização.

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

Estado:
- concluído em `2026-08-27`;
- o teste de stale cache de notícias passou a simular todas as respostas dos feeds, sem chamadas de rede nem dependência da ordem dos fallbacks;
- criada a validação GitHub Actions em pull requests e alterações a `main`;
- o CI usa Node `22.20.0`, `npm ci`, cache npm, auditoria de vulnerabilidades altas/críticas e `npm run verify:release`;
- o workflow `Test and build` está configurado como check obrigatório para merge em `main`;
- a validação mais recente passou com `115` testes e build/PWA concluídos.

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

Estado:
- concluído em `2026-08-27`;
- lembrete integrado no centro de notificações, com `Exportar agora`, `Lembrar amanhã` e `Não voltar a mostrar`;
- exportações normais também reiniciam o ciclo de 7 dias;
- estado persistido localmente e sincronizado em `user_settings`;
- migration `20260827_000007_add_backup_reminder_settings.sql` aplicada no Supabase;
- validação manual em staging concluída: lembrete apresentado, exportação criada e ciclo reiniciado;
- `npm run verify:release` passou com `94` testes; `npm audit --audit-level=high` sem vulnerabilidades.

## Recuperação de dados: histórico e pendência

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
- concluído pelo sprint prioritário `P3` em `2026-08-27`.

### B2 | Cópia independente de recuperação

Prioridade:
- alta, antes de novas funcionalidades de produto.

Objetivo:
- garantir uma segunda cópia recuperável da biblioteca que não dependa apenas do projeto Supabase nem do browser atual.

Operação imediata sem código:
- aceitar o lembrete semanal e guardar o ficheiro exportado numa pasta versionada de iCloud Drive, Google Drive, Dropbox ou equivalente;
- manter pelo menos as últimas `4` exportações semanais;
- executar trimestralmente um teste de restauro num browser limpo, sem substituir a biblioteca principal.

Evolução técnica a avaliar:
- backup server-side diário de snapshots para armazenamento privado independente, com retenção definida, integridade verificável e procedimento documentado de restauro;
- nunca usar esta cópia para sobrescrever dados automaticamente;
- avançar apenas após decisão sobre custo, retenção, acesso administrativo e requisitos de privacidade.

Critério de fecho:
- existe uma cópia independente recente;
- um restauro de teste confirma biblioteca, progresso, notas e preferências;
- o processo de recuperação está documentado e não depende de memória individual.

Estado:
- operação manual iniciada em `2026-08-30`:
  - pasta de recuperação criada em iCloud Drive;
  - primeira exportação da biblioteca guardada fora do Supabase e do browser;
- pendente manter as últimas `4` exportações semanais e executar o primeiro teste trimestral de restauro num browser limpo;
- backup server-side independente continua uma evolução técnica a avaliar, não uma dependência do processo manual atual.

## Funcionalidade concluída: Partilha pública de conteúdos

Objetivo:
- permitir partilhar uma série, filme ou livro sem expor dados privados da biblioteca, progresso, notas, avaliação pessoal ou sessão;
- manter a ficha pública acessível num browser sem sessão e sem depender do estado local do dispositivo que criou o link.

### Sprint S1 | Contrato de URL pública e descoberta técnica

Decisões fechadas:
- a URL canónica será um caminho real, não o hash de navegação interna atual;
- séries e filmes usarão o respetivo ID TMDb como identificador autoritativo:
  - `/partilhar/serie/<tmdbId>`
  - `/partilhar/filme/<tmdbId>`
- livros usarão provider e identificador de catálogo codificado:
  - `/partilhar/livro/<provider>/<sourceId-codificado>`;
- o título poderá ser acrescentado futuramente apenas como slug decorativo; nunca será usado para resolver o conteúdo;
- quando um livro não tiver `source_id` recuperável, a implementação posterior usará ISBN como fallback explícito; se também não existir, a partilha desse registo ficará indisponível de forma honesta;
- todos os links devem ser construídos a partir do domínio ativo (`location.origin`), para funcionarem igualmente em `staging` e produção.

Descoberta confirmada:
- a app atual usa `#series-view-section` apenas para mostrar a secção; o hash não contém tipo nem ID de conteúdo;
- séries já podem ser carregadas por ID TMDb, mas filmes e livros dependem hoje de memória local, resultados de pesquisa ou discovery;
- o redirect SPA atual aceita caminhos públicos e devolve `index.html`, mas a inicialização de visitante sem sessão termina no dashboard antes de interpretar uma ficha pública;
- o parser da rota pública terá de correr antes desse retorno e criar um objeto transitório apenas para renderizar o detalhe público;
- cartões sociais com Open Graph por título exigirão, no sprint respetivo, uma resposta server-side/edge para crawlers: uma SPA estática não chega para gerar metatags específicas por URL.

Proteções de privacidade:
- a URL não pode incluir `user_id`, `device_id`, estado de biblioteca, progresso, notas, avaliações pessoais, email ou parâmetros Supabase;
- uma rota inválida, removida ou sem fonte pública mostrará apenas uma mensagem de conteúdo indisponível, sem revelar se o título existe na biblioteca de alguém;
- abrir um link público não poderá criar sessão, adicionar conteúdo, escrever IndexedDB nem iniciar sync.

Fora de âmbito S1:
- botão ou menu de partilha;
- integração com WhatsApp, Facebook, X, email ou partilha nativa;
- metatags Open Graph, imagem social ou páginas de preview;
- alterações aos detalhes atuais, à biblioteca ou ao sync.

Critério de fecho:
- contrato de URL por tipo documentado e sem dependência de dados privados;
- limitações de deep-link, visitante sem sessão, livros e crawlers identificadas antes de alterar runtime;
- S2 pode implementar o parser e a vista pública com testes de rota determinísticos.

Estado:
- concluído em `2026-08-29`; não houve alteração de comportamento da app neste sprint.

### Sprint S2 | Deep-link e detalhe público em leitura

Implementado:
- parser determinístico para `/partilhar/serie/<tmdbId>`, `/partilhar/filme/<tmdbId>` e `/partilhar/livro/<provider>/<sourceId-codificado>`;
- validação estrita de IDs TMDb, providers de livros e codificação de `sourceId` antes de qualquer pedido remoto;
- carregamento da ficha pública antes de migração local, carregamento da biblioteca ou sync cloud;
- preservação do caminho público no browser, sem o substituir por `#series-view-section`;
- objetos transitórios para filmes e livros, sem dados de utilizador ou biblioteca;
- modo de detalhe público em leitura para séries, filmes e livros:
  - sem adicionar, remover, arquivar, atualizar metadados, marcar episódios, alterar progresso, avaliação pessoal ou notas;
  - sem barras de progresso ou temporadas interativas;
  - mantém apenas informação editorial pública, avaliações públicas, trailer, créditos e reviews externas disponíveis;
- resposta genérica para rotas inválidas, conteúdo removido ou falha de provider;
- botão de voltar de uma partilha regressa à raiz da app, evitando mostrar uma biblioteca que não foi carregada neste fluxo.

Validação:
- testes unitários de parsing, validação de inputs, livros codificados e criação de dados transitórios sem estado pessoal;
- `npm run test:run` passou com `104` testes;
- `npm run build` passou, incluindo geração PWA;
- `git diff --check` passou;
- a verificação adicional `npx tsc --noEmit` mantém apenas diagnósticos pré-existentes fora do S2, sem erro novo atribuído a este sprint.

Critério de fecho:
- links públicos abrem uma ficha sem sessão e sem depender de IndexedDB, pesquisa ou discovery local;
- não existe caminho visual para mutar biblioteca, progresso, notas ou avaliações pessoais;
- rotas inválidas falham de forma genérica e segura.

Estado:
- concluído e validado em `staging` e produção pelo rollout `S5` / PR `#83`.

### Sprint S3 | Ações de partilha no detalhe

Implementado:
- botão `Partilhar` no conjunto de ações dos detalhes de séries, filmes e livros, incluindo fichas públicas em leitura;
- links construídos apenas com as rotas públicas do S1/S2 e o domínio ativo, sem estado de biblioteca, progresso, notas, avaliação pessoal, sessão ou identificadores de utilizador;
- partilha nativa em dispositivos tácteis compatíveis com Web Share API;
- menu acessível de fallback para copiar link, WhatsApp, Facebook, X e email, com fecho por clique exterior ou `Escape`;
- livros sem provider público suportado não recebem um link potencialmente inválido.

Validação automática concluída:
- testes unitários para URLs por tipo e destinos de partilha, confirmando que os dados privados não entram nos links;
- `npm run verify:release` passou com `107` testes e build/PWA concluídos;
- `git diff --check` passou;
- `npx tsc --noEmit` mantém apenas sete diagnósticos pré-existentes fora do S3, sem erro novo atribuído a este sprint.

Validação manual concluída:
- smoke confirmado em desktop e telemóvel para série, filme e livro, incluindo cópia de link e destinos de partilha.

Critério de fecho:
- partilhar não altera biblioteca, sessão, IndexedDB ou sync;
- o URL copiado abre a ficha pública correta sem sessão;
- menu é operável por rato e teclado e não causa regressão nas ações existentes do detalhe.

Estado:
- concluído funcionalmente em `2026-08-29`.

### Sprint S4 | Previews sociais Open Graph no edge

Implementado:
- função Cloudflare Pages em `/partilhar/*` que preserva a SPA, mas injeta metatags por conteúdo no HTML entregue pelo edge;
- `title`, descrição, canonical URL, Open Graph e Twitter Card para séries, filmes e livros Google Books/Open Library;
- metadados públicos obtidos diretamente do catálogo: TMDb para séries/filmes, Google Books ou Open Library para livros;
- fallback genérico seguro para Goodreads, provider indisponível ou falha de catálogo, sem expor dados de utilizador;
- escaping de HTML, validação estrita de rota e preservação dos headers de segurança da resposta estática;
- cache público curto para previews sociais, independente de sessão, IndexedDB, Supabase ou sync.
- reforço do arranque de partilhas: a rota pública é reavaliada antes de cada inicialização e tem prioridade sobre qualquer detalhe ou sessão local já existente.

Validação automática concluída:
- testes para série, livro, rota inválida e falha de provider;
- `npm run verify:release` passou com `111` testes e build/PWA concluídos;
- `git diff --check` passou.

Validação manual concluída:
- em `staging`, a rota pública abre a ficha correta sem sessão e preserva o URL canónico, sem `#series-view-section`;
- o browser recebe `title`, `og:title`, `og:description`, `og:image` e `canonical` específicos do conteúdo;
- a partilha gera a URL pública canónica e não a rota genérica interna da SPA.

Critério de fecho:
- crawlers recebem uma ficha identificável por conteúdo sem executar JavaScript;
- utilizadores continuam a receber a SPA e o detalhe público do S2;
- nenhum dado privado é processado, inserido no HTML ou incluído no cache edge.

Estado:
- concluído funcionalmente em `2026-08-29`.

### Sprint S5 | Testes e rollout

Implementado:
- teste de interface isolado para a ação de partilha em detalhes de série, filme e livro;
- validação do menu de partilha, URL pública por tipo, botão de cópia e destinos de fallback;
- confirmação de que os controlos existentes continuam presentes:
  - filmes: voltar, atualizar, arquivar e eliminar;
  - livros: adicionar à biblioteca e guardar progresso;
  - séries: voltar, marcar episódios, atualizar metadados, adicionar e eliminar;
- confirmação de que a ficha pública mantém a partilha, mas não expõe ações que alteram biblioteca, progresso ou avaliação pessoal.

Validação automática concluída:
- `18` ficheiros de teste e `115` testes passaram;
- `npm run verify:release` passou, incluindo build de produção e PWA;
- `git diff --check` passou.

Validação manual e rollout concluídos:
- validação em `staging` de série, filme e livro, em desktop e telemóvel;
- links copiados e abertos em browser limpo, com e sem sessão, sem expor ou alterar biblioteca, progresso, notas ou avaliações pessoais;
- confirmação de que voltar, atualizar, eliminar, arquivar, marcar episódios e guardar progresso continuam funcionais;
- PR `#83` de `staging` para `main` aprovado, com `Test and build` e Cloudflare Pages concluídos antes do merge.

Critério de fecho:
- as três fichas suportam partilha sem regressão nas ações existentes;
- links públicos funcionam sem sessão e sem acesso a dados pessoais;
- deploy em `main` concluído pelos checks obrigatórios.

Estado:
- concluído em produção em `2026-08-30`.

## Funcionalidade concluída: Integração Simkl

### Sprint I1 | Simkl como provider de enriquecimento

Objetivo:
- adicionar Simkl como fonte opcional de dados para séries e filmes, sem substituir TMDb, TVMaze ou Trakt;
- recuperar redundância para avaliações e trailers enquanto a aplicação Trakt não estiver disponível;
- manter Supabase e a biblioteca MediaDex como fonte de verdade dos dados do utilizador.

Fora de âmbito:
- login OAuth Simkl;
- importação, exportação ou sincronização da biblioteca/histórico Simkl;
- chamadas aos endpoints `/sync/*`, incluindo `activities` e `all-items`;
- alteração dos providers de livros.

Fase I1.0 | Pré-requisitos e prova de cobertura

Tarefas:
- confirmar que a aplicação Simkl está ativa e que os termos da modalidade gratuita são compatíveis com o MediaDex;
- configurar apenas `SIMKL_CLIENT_ID` nos ambientes Cloudflare `Preview` e `Production`;
- selecionar uma amostra de 10 a 15 séries e filmes com IDs TMDb/IMDb, incluindo títulos antigos, recentes e portugueses;
- verificar manualmente cobertura de match, avaliação pública, trailer, sinopse, certificação e episódios;
- não configurar nem utilizar `SIMKL_CLIENT_SECRET` nesta fase.

Critério de avanço:
- cobertura aceitável na amostra;
- chamadas de catálogo bem-sucedidas sem utilizar sync de utilizador;
- decisão explícita de avançar para implementação.

Fase I1.1 | Proxy e adaptador normalizado

Tarefas:
- criar proxy Cloudflare `/api/simkl` com allowlist de endpoints, validação de input, CORS e erros públicos mínimos;
- acrescentar no proxy os parâmetros obrigatórios `client_id`, `app-name`, `app-version` e `User-Agent`;
- manter o `SIMKL_CLIENT_ID` fora do browser;
- limitar o proxy a `/search/id`, `/tv/:id` e `/movies/:id`, bloqueando explicitamente `/sync/*`;
- aplicar rate limit por origem e tratar respostas upstream sem expor o respetivo corpo;
- resolver conteúdo apenas por IDs TMDb/IMDb para evitar matches textuais incorretos;
- normalizar a resposta Simkl num contrato interno independente do provider.

Fase I1.2 | Enriquecimento progressivo e precedência

Tarefas:
- carregar Simkl em paralelo com TVMaze/Trakt, sem bloquear o detalhe base TMDb;
- mostrar avaliação Simkl como fonte autónoma, sem alterar as restantes avaliações;
- usar trailer Simkl apenas como fallback quando TMDb não disponibilizar vídeo YouTube;
- usar sinopse e certificação Simkl apenas como fallback, sem substituir conteúdo PT-PT existente do TMDb;
- avaliar episódios e calendário Simkl apenas como validação complementar, preservando TMDb como referência para estado e progresso;
- manter falha Simkl silenciosa para o utilizador, com observabilidade técnica suficiente.

Fase I1.3 | Testes, rollout e validação

Tarefas:
- criar fixtures para match por IMDb, TMDb, sem match, rate limit e indisponibilidade;
- validar que nenhum dado local/Supabase é escrito pela integração;
- testar em `staging` a amostra definida em I1.0 e comparar fontes apresentadas;
- verificar API Analytics Simkl após testes, sem erros `4xx` inesperados nem padrões excessivos de pedidos;
- executar `npm run verify:release` e abrir PR normal de `staging` para `main`.

Critério de fecho:
- TMDb, TVMaze, Trakt e Simkl coexistem sem regressões;
- as avaliações identificam claramente a respetiva fonte;
- falhas ou limites Simkl não impedem a abertura de detalhes;
- não existem alterações no histórico, biblioteca, progresso, notas ou sync Supabase.

Estado:
- implementação, validação e rollout concluídos em `2026-08-28`;
- `SIMKL_CLIENT_ID` configurado manualmente nos ambientes Cloudflare `Preview` e `Production`;
- o proxy aceita apenas leituras públicas de catálogo e não usa OAuth, `SIMKL_CLIENT_SECRET` nem endpoints `/sync/*`;
- a avaliação Simkl foi confirmada nos detalhes, com fallback não destrutivo para trailer, sinopse e certificação;
- o rollout para produção seguiu o fluxo normal `staging` -> PR -> checks -> `main`;
- monitorização normal de erros/limites Simkl passa a fazer parte da manutenção operacional.

### T1 | Trakt em observação

Decisão atual:
- manter a integração Trakt tal como está, sem investimento adicional enquanto não houver mudança na modalidade gratuita ou possibilidade clara de recuperar a aplicação API anterior;
- aceitar temporariamente a indisponibilidade da avaliação Trakt; Simkl fornece redundância para avaliação, trailer, sinopse e certificação;
- não adicionar novas dependências nem novos fluxos sobre Trakt enquanto a app API devolver `403`.

Quando reavaliar:
- mudança dos termos gratuitos da Trakt;
- recuperação comprovada da aplicação API;
- aumento material de latência ou erros que justifique remover as chamadas Trakt da app.

Estado:
- em observação, sem implementação planeada.

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

Estado:
- implementação concluída em `2026-08-27`;
- inventário concluído: eliminados os usos diretos e indiretos de `innerHTML` no cliente;
- estados de notícias, cartões de estatísticas e progresso de detalhes passam a ser criados com nós DOM seguros;
- `el()` rejeita explicitamente HTML bruto e tem teste de regressão;
- validação visual em `staging` concluída sem regressões relevantes;
- sprint fechado formalmente em `2026-08-28`.

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

Estado:
- concluído no escopo atual em `2026-08-28`;
- `display-name-available` tem validação e limitação de pedidos cobertas por testes;
- funções Cloudflare aplicam HSTS, CORS explícito, validação de métodos/input e headers de observabilidade partilhados;
- proxies sanitizam headers upstream e devolvem erros públicos mínimos em endpoints endurecidos, incluindo Simkl;
- contratos de consumo do frontend foram preservados por testes e builds de release.

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

Estado:
- Cloudflare confirmado como runtime canónico de produção, preview e estratégia local suportada
- `npm run dev` migrado para `vite` com proxy `/api/*` para origem Cloudflare configurável
- legado Netlify removido do fluxo local e do repositório
- concluído no escopo atual; qualquer alteração futura de runtime requer uma necessidade operacional concreta

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

Estado:
- limite explícito para ficheiros de importação
- notas de utilizador truncadas de forma consistente para evitar payloads descontrolados
- progresso normalizado com clamp `0..100` em import, migração e sync remoto
- migração legada de `localStorage` com parsing seguro para JSON inválido
- snapshots locais/remotos rejeitados quando excedem o tamanho máximo suportado
- concluído no escopo atual; a cópia independente `B2` continua deliberadamente fora deste sprint

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

Estado:
- concluído no escopo atual;
- melhorias adicionais de acessibilidade passam a ser tratadas pela manutenção `U1`, quando houver evidência de fricção ou falha concreta.

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

Estado:
- `resize` do header móvel com debounce para evitar trabalho repetido em cascata
- métricas do dashboard consolidadas num único cálculo por render
- estatísticas com cache local por ciclo de render para evitar filtros, listas e resumos duplicados
- removido um render redundante da dashboard no arranque
- concluído no escopo atual; code-splitting e virtualização mantêm-se condicionais a métricas reais.

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

Estado:
- empty states consolidados com tipografia e espaçamento coerentes
- modais principais alinhados por grupos de estilo partilhados em vez de CSS repetido
- títulos de modais de conta e listas avaliadas com hierarquia visual mais consistente
- sem redesenho estrutural nem alteração de fluxo
- concluído no escopo atual; ajustes futuros seguem a manutenção `U1`, não um redesign global.

## Sequência concluída de consolidação

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

## Funcionalidade concluída: Fallback editorial de livros

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

Estado:
- implementado fallback editorial tardio com Goodreads
- `Goodreads` entra apenas após `Presença`
- endpoint `/api/books/fallback` suporta `provider=goodreads` e pesquisa por título
- frontend reconhece `Goodreads` como origem possível
- concluído no escopo atual; novas fontes editoriais automáticas exigem prova de valor antes de serem reabertas.

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
