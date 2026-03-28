# Auth Email Setup

Configuração final do email de confirmação de registo no Supabase.

## Objetivo

- enviar emails de autenticação com branding `MediaDex`
- evitar remetente genérico da Supabase
- clarificar expiração e confirmação de registo

## SMTP

No painel Supabase:

1. `Authentication`
2. `Email`
3. ativar `Custom SMTP`

Configuração usada:

- `Sender email address`: `no-reply@auth.mediadex.app`
- `Sender name`: `MediaDex`
- `Host`: `smtp.resend.com`
- `Port number`: `465`
- `Minimum interval per user`: `60`
- `Username`: `resend`
- `Password`: `Resend API key`

## Domínio de envio

Domínio configurado no Resend:

- `auth.mediadex.app`

Registos DNS esperados no Cloudflare:

- `DKIM`
- `MX`
- `SPF`

O domínio deve ficar `verified` no Resend antes do teste final.

## Expiração do link

No provider `Email` do Supabase:

- `Email OTP expiration`: `3600` segundos

Leitura funcional:

- o link de confirmação expira normalmente ao fim de `1 hora`

## Template

Template HTML final para `Confirm signup`:

```html
<div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #1f2937; line-height: 1.5;">
  <div style="text-align: center; margin-bottom: 24px;">
    <img
      src="https://mediadex.app/assets/email/mediadex-logo.png?v=20260328"
      alt="MediaDex"
      width="160"
      style="display:block; margin:0 auto; width:160px; max-width:160px; height:auto; border:0; outline:none; text-decoration:none;"
    />
  </div>

  <h2 style="margin: 0 0 16px; font-size: 28px; color: #111827;">Confirme o seu registo no MediaDex</h2>

  <p>Recebemos um pedido para criar a sua conta no <strong>MediaDex</strong>.</p>
  <p>Para concluir o registo, confirme o seu email no botão abaixo.</p>

  <div style="margin: 28px 0; text-align: center;">
    <a
      href="{{ .ConfirmationURL }}"
      style="display: inline-block; background: #5da9d6; color: #ffffff; text-decoration: none; padding: 14px 24px; border-radius: 8px; font-weight: 700;"
    >
      Confirmar email
    </a>
  </div>

  <p style="font-size: 14px; color: #4b5563;">Este link expira normalmente ao fim de 1 hora.</p>
  <p style="font-size: 14px; color: #4b5563;">Se não reconhece este pedido, pode ignorar este email.</p>

  <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />

  <p style="font-size: 12px; color: #6b7280; text-align: center;">
    MediaDex<br />
    Organize séries, filmes e livros num só lugar.
  </p>
</div>
```

## Asset do logo

Ficheiro usado no projeto:

- [mediadex-logo.png](/Users/mariocabano/Documents/GitHub/seriesBD/public/assets/email/mediadex-logo.png)

URL pública usada no template:

- `https://mediadex.app/assets/email/mediadex-logo.png?v=20260328`

## Validação

Após alteração de SMTP/template:

1. registar utilizador de teste
2. confirmar remetente:
   - `MediaDex`
   - `no-reply@auth.mediadex.app`
3. confirmar assunto do email
4. confirmar logo visível
5. confirmar botão de confirmação funcional
6. confirmar comportamento em inbox/spam
