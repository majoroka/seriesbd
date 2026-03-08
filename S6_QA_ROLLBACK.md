# Sprint 6 - QA, UAT e Rollback

## 1) Checklist técnico antes de release
- `npm run test -- --run` sem falhas.
- `npm run build` sem falhas.
- Cloudflare Pages:
  - Preview (`staging`) com deploy verde.
  - Production com as variáveis obrigatórias configuradas.
- Supabase:
  - RLS ativo em `profiles`, `user_settings`, `library_snapshots`, `system_heartbeat`.
  - Endpoint heartbeat a gravar registos em `public.system_heartbeat`.

## 2) UAT funcional (bloqueadores P0/P1)
- Auth:
  - Registo com email novo funciona.
  - Login/logout funciona.
  - Não autenticado não vê dados privados.
- Séries:
  - Pesquisa, detalhe, trailer, adicionar/remover, progresso.
- Filmes:
  - Pesquisa, detalhe, trailer, marcar visto/não visto, mover entre secções.
- Livros:
  - Pesquisa (Google/OpenLibrary fallback), detalhe, marcar lido/não lido, progresso.
- Sincronização:
  - Reload não perde dados.
  - Estado entre sessões consistente para o mesmo utilizador.

## 3) Observabilidade mínima (produção)
- Verificar logs JSON por endpoint:
  - `proxy.request`
  - `proxy.upstream_error`
  - `proxy.unexpected_error`
- Verificar headers de diagnóstico em chamadas API:
  - `x-request-id`
  - `x-upstream-status`
  - `x-upstream-latency-ms`
  - `x-ratelimit-limit`, `x-ratelimit-remaining`, `x-ratelimit-reset`

## 4) Testes rápidos com curl
```bash
curl -i "https://seriesbd.pages.dev/api/tmdb/trending/tv/week"
curl -i "https://seriesbd.pages.dev/api/trakt/search/show?query=dexter"
curl -i "https://seriesbd.pages.dev/api/tvmaze/resolve/show?query=dexter"
curl -i "https://seriesbd.pages.dev/api/books/search?query=cosmos"
```

## 5) Plano de rollback (Cloudflare + Git)
1. Rollback imediato de deploy:
   - Cloudflare Pages > `seriesbd` > Deployments > selecionar deploy anterior estável > `Rollback`.
2. Rollback de código (se necessário):
   - Fazer `git revert` do commit com problema.
   - Push para `staging`, validar preview, PR para `main`.
3. Confirmações pós-rollback:
   - Auth a funcionar.
   - APIs (`/api/tmdb`, `/api/trakt`, `/api/tvmaze`, `/api/books`) a responder 200/4xx esperados.
   - Heartbeat mantém inserções em `system_heartbeat`.

