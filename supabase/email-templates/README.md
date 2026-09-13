# Templates de e-mail (Supabase Auth)

Modelos em PT-BR para colar no painel do Supabase. Sem isso, o Supabase envia e-mails em inglês e
genéricos.

## Onde colar

Supabase Dashboard > **Authentication** > **Email Templates**. Selecione cada template e cole o
conteúdo do arquivo correspondente:

| Template no painel | Arquivo | Assunto sugerido |
| --- | --- | --- |
| Confirm signup | `confirm-signup.html` | Confirme seu e-mail no VitrineZap |
| Reset password | `reset-password.html` | Redefinir senha do VitrineZap |
| Magic link | `magic-link.html` | Seu link de acesso ao VitrineZap |
| Change email address | `change-email.html` | Confirme seu novo e-mail |
| Invite user | `invite.html` | Você foi convidado para o VitrineZap |

Variáveis usadas: `{{ .ConfirmationURL }}` e `{{ .NewEmail }}` (no change email). Não remova essas
chaves.

## Ativar a confirmação de e-mail

Authentication > **Providers** > Email: deixe **Confirm email** ligado. Com isso, o cadastro mostra a
tela "Confirme seu e-mail" e o usuário só entra após clicar no link.

## URL Configuration

Authentication > **URL Configuration**:

- **Site URL**: `https://SEU_DOMINIO` (ex.: `https://wolfsistemas.github.io/app`)
- **Redirect URLs**: inclua `https://SEU_DOMINIO/**` (e `http://localhost:5173/**` para testar).

## SMTP de produção (importante)

Por padrão o Supabase usa um SMTP compartilhado, com **limite baixo** e alta chance de cair em spam.
Para vender, configure um SMTP próprio em **Project Settings > Auth > SMTP** (ou Authentication >
Settings), usando um provedor como **Resend**, **Brevo**, **SendGrid** ou **Amazon SES**:

- Host, porta, usuário e senha do provedor.
- **From**: algo como `VitrineZap <nao-responda@seudominio.com>`.
- Configure **SPF** e **DKIM** no DNS do domínio para melhorar a entrega.

Enquanto não tiver domínio, você pode manter o SMTP padrão para testes, mas evite divulgar o cadastro
em massa.

## Observações

- O remetente padrão do Supabase é genérico; personalize em SMTP > Sender name/email.
- Rate limit: veja Authentication > Rate Limits. Cadastros/reenvios muito frequentes são bloqueados
  para evitar abuso.
- Os links de confirmação/recuperação precisam que o `Site URL` e `Redirect URLs` estejam corretos,
  senão o usuário cai numa página de erro.
