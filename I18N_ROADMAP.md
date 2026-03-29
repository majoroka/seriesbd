# I18N Roadmap

Plano futuro para internacionalização da app com suporte a `pt` e `en`.

Estado:
- backlog futuro
- não iniciado

Objetivo:
- permitir uso da app em português e inglês
- tornar a UI locale-aware
- pedir metadados externos no idioma escolhido sempre que possível
- evitar introduzir tradução automática antes de existir base sólida de i18n

## Decisão de produto

Estratégia recomendada para a primeira implementação:

1. UI bilingue `pt` / `en`
2. providers locale-aware
3. fallback ao idioma original quando não existir tradução

Só numa fase posterior, se isso for insuficiente:

4. tradução automática apenas de sinopses
5. sempre com cache server-side

Razão:
- reduz custo inicial
- minimiza risco de inconsistência
- evita dependência prematura de providers pagos de tradução
- permite lançar uma primeira versão robusta sem prometer “tudo traduzido” artificialmente

## Fase I1 | Infraestrutura i18n da UI

Objetivo:
- introduzir uma base técnica única para idioma na app

Escopo:
- criar setting global de idioma (`pt` / `en`)
- persistir preferência do utilizador localmente e, se existir sessão, também no perfil remoto
- criar dicionários de tradução por chave
- introduzir helper `t(...)`
- introduzir helpers de formatação locale-aware:
  - datas
  - números
  - labels de estado
- eliminar hardcoded strings críticas do:
  - `index.html`
  - `src/main.ts`
  - `src/ui.ts`

Critério de fecho:
- menus, botões, modais, notificações e labels principais reagem ao idioma escolhido
- datas e números deixam de estar fixos em `pt-PT`

Impacto:
- médio

Risco:
- médio, pela quantidade de texto hardcoded já existente

## Fase I2 | Providers Locale-Aware

Objetivo:
- alinhar metadados externos com o idioma ativo

Escopo:
- parametrizar chamadas TMDb por locale:
  - `pt-PT`
  - `en-US`
- parametrizar chamadas Trakt/translations:
  - `pt`
  - `en`
- rever livros para preferir idioma coerente quando a fonte suportar isso
- tornar a agregação de overview dependente do locale ativo
- rever caches cuja chave deva passar a incluir idioma

Critério de fecho:
- detalhes, pesquisa e listas passam a respeitar o idioma selecionado quando a origem suportar tradução
- fallback ao idioma original quando não existir tradução

Impacto:
- médio-alto

Risco:
- médio, pela necessidade de rever caches e contratos entre frontend/providers

## Fase I3 | Política de Fallback ao Original

Objetivo:
- garantir experiência coerente quando a origem não tem tradução no idioma pedido

Escopo:
- definir regra explícita:
  - `prefer locale -> fallback original`
- sinalizar internamente quando o texto não está no idioma ativo
- evitar mistura arbitrária entre PT e EN na UI de detalhe

Critério de fecho:
- comportamento previsível e documentado
- ausência de falsas promessas de tradução total

Impacto:
- baixo-médio

Risco:
- baixo

## Fase I4 | Tradução Automática de Sinopses

Objetivo:
- cobrir sinopses não disponíveis no idioma ativo

Pré-condição:
- só avançar depois de `I1-I3` estarem estáveis

Escopo:
- traduzir apenas sinopses
- nunca traduzir toda a UI via provider externo
- tradução sempre server-side
- cache por:
  - `media id`
  - `source`
  - `target locale`
  - hash do texto original
- definir política de invalidação

Critério de fecho:
- sinopses traduzidas reutilizadas sem retraduzir a cada abertura
- custo e latência controlados

Impacto:
- alto

Risco:
- alto, por custo, latência e manutenção

## Ordem Recomendada

1. `I1 Infraestrutura i18n da UI`
2. `I2 Providers Locale-Aware`
3. `I3 Política de Fallback ao Original`
4. `I4 Tradução Automática de Sinopses`

## Notas de implementação

- o idioma deve ser uma preferência real da app, não apenas um toggle visual
- o locale precisa de entrar em:
  - chamadas API
  - caches
  - formatação
  - textos de UI
- não iniciar a fase de tradução automática sem cache e sem política clara de custos

## Riscos conhecidos

- elevado número de strings hardcoded em `index.html`, `src/main.ts` e `src/ui.ts`
- múltiplos `toLocaleDateString('pt-PT')` e `localeCompare(..., 'pt-PT')`
- lógica atual de providers e agregação favorece português de forma explícita
- risco de app “meio traduzida” se a implementação não for faseada

## Critério para retomar este tema

Quando este trabalho for retomado, seguir exatamente esta ordem:

1. inventário de strings/locale hardcoded
2. base i18n da UI
3. locale-aware providers
4. fallback ao original
5. só depois avaliar tradução automática de sinopses
