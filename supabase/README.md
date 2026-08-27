# Supabase Setup (Sprint 2 - T01)

Este diretório guarda as migrations SQL do projeto.

Documentação complementar:

- `supabase/AUTH_EMAIL_SETUP.md` para SMTP custom, branding e template do email de confirmação

## 1) Criar projeto

No painel Supabase:

1. `New project`
2. Nome: `seenlog` (ou outro)
3. Região: preferencialmente UE (latência menor para PT)
4. Guardar a `Database Password` em local seguro

## 2) Aplicar schema inicial

1. Abrir `SQL Editor`
2. Executar o conteúdo de:

`supabase/migrations/20260307_000001_init_profiles_user_settings.sql`
`supabase/migrations/20260307_000002_init_library_snapshots.sql`
`supabase/migrations/20260307_000003_init_system_heartbeat.sql`
`supabase/migrations/20260326_000004_harden_display_name_uniqueness.sql`
`supabase/migrations/20260327_000005_harden_library_snapshots.sql`
`supabase/migrations/20260525_000006_library_snapshot_history_and_metadata.sql`
`supabase/migrations/20260827_000007_add_backup_reminder_settings.sql`

Isto cria:

- `public.profiles`
- `public.user_settings`
- `public.library_snapshots`
- `public.library_snapshot_history`
- `public.system_heartbeat`
- trigger automática em `auth.users` para criar linhas iniciais
- políticas RLS para acesso apenas ao próprio utilizador autenticado
- validação server-side e RPC controlada para `public.library_snapshots`
- histórico de snapshots e metadados de sincronização (`deviceId`, `syncReason`, contagens)
- estado sincronizado do lembrete periódico de exportação

## 3) Variáveis para a app

No Supabase (`Settings -> API`) copiar:

- `Project URL`
- `Publishable key` (anon)

Depois configurar no Cloudflare Pages (`Preview` e `Production`):

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (server-side only; usado pelo endpoint heartbeat)

## 4) Validação rápida

1. Criar um utilizador de teste em `Authentication -> Users`.
2. Confirmar que surgem linhas correspondentes em:
   - `public.profiles`
   - `public.user_settings`

## 5) Nota importante sobre grants futuros

Contexto:
- o Supabase está a mudar o comportamento por defeito da Data API para novas tabelas no schema `public`
- em projetos novos isso passa a ser default em `2026-05-30`
- em projetos existentes passa a afetar **novas tabelas criadas depois de `2026-10-30`**

Impacto no projeto:
- as tabelas e funções já existentes continuam a funcionar com os grants atuais
- o risco está em futuras migrations que criem:
  - novas tabelas
  - novas funções RPC
  sem `grant` explícito

Regra operacional daqui para a frente:
1. `create table`
2. `alter table ... enable row level security`
3. `create policy ...`
4. `revoke ...`
5. `grant ...`

Para funções RPC:
1. `create or replace function ...`
2. `revoke all on function ... from public`
3. `grant execute on function ... to authenticated` ou `service_role`

Objetivo:
- garantir que novas entidades continuam acessíveis via `supabase-js` / PostgREST apenas quando isso for explícito e intencional
