# Supabase Setup (Sprint 2 - T01)

Este diretório guarda as migrations SQL do projeto.

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

Isto cria:

- `public.profiles`
- `public.user_settings`
- `public.library_snapshots`
- trigger automática em `auth.users` para criar linhas iniciais
- políticas RLS para acesso apenas ao próprio utilizador autenticado

## 3) Variáveis para a app

No Supabase (`Settings -> API`) copiar:

- `Project URL`
- `Publishable key` (anon)

Depois configurar no Cloudflare Pages (`Preview` e `Production`):

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

## 4) Validação rápida

1. Criar um utilizador de teste em `Authentication -> Users`.
2. Confirmar que surgem linhas correspondentes em:
   - `public.profiles`
   - `public.user_settings`
