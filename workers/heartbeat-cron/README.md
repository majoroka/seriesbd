# Heartbeat Cron Worker (S2-T05)

Este worker chama o endpoint da app `POST /api/heartbeat` de 3 em 3 dias.

## Cron

- Configuração atual: `0 9 */3 * *` (UTC).

## Variáveis necessárias no Worker

- `HEARTBEAT_URL`
  - Exemplo staging: `https://staging.seriesbd.pages.dev/api/heartbeat`
  - Exemplo produção: `https://seriesbd.pages.dev/api/heartbeat`
- `HEARTBEAT_TOKEN` (opcional, mas recomendado)
  - Deve ser igual à variável `HEARTBEAT_TOKEN` no projeto Pages.

## Deploy

No diretório do projeto:

```bash
npx wrangler deploy --config workers/heartbeat-cron/wrangler.toml
```

Depois configurar as variáveis:

```bash
npx wrangler secret put HEARTBEAT_TOKEN --config workers/heartbeat-cron/wrangler.toml
npx wrangler secret put HEARTBEAT_URL --config workers/heartbeat-cron/wrangler.toml
```

## Teste manual

```bash
curl -i -X POST "https://staging.seriesbd.pages.dev/api/heartbeat" \
  -H "x-heartbeat-token: <TOKEN>"
```
