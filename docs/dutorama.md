# Dutorama CRM — base de trabalho

CRM da Valdir Móveis Ubatuba para atendimento e vendas pelo WhatsApp Business.
Derivado do [DeskcommCRM](https://github.com/melgarafael/DeskcommCRM) (licença MIT).

## Base

- Branch: `dutorama/base-v1.109.0`
- Origem: tag `v1.109.0` do DeskcommCRM (commit `0cead2817`), com o histórico completo.
- A branch antiga `vercel-restart-v1.74.0` fica guardada só como referência.
- Motivo da troca: a v1.109.0 já traz o canal oficial da Meta (`lib/channels/adapters/meta-cloud.ts`)
  com **coexistência** — o webhook assina `smb_message_echoes` (respostas dadas pelo app
  WhatsApp Business) e `smb_app_state_sync` (contatos do app), e a conexão por cadastro
  incorporado aceita `coexistencia: true`. A v1.74.0 dependia de WAHA.

## Decisões de infraestrutura

| Item | Escolha |
|---|---|
| WhatsApp | Só a API oficial da Meta (Cloud API em coexistência). Sem WAHA. |
| Hospedagem | Vercel, plano grátis (Hobby), região `gru1`, enquanto for treino |
| Banco | Supabase, plano grátis |
| Rotinas | `pg_cron` do Supabase chamando as rotas `/api/v1/cron/*` (fase 2) |
| Worker | Sem processo ligado 24 h (fase 2) |
| Redis | Opcional. Sem ele, rate limit e debounce usam memória — ok para teste |

## O que mudou em relação ao upstream

- `lib/env.ts`: `WAHA_API_BASE_URL`, `WAHA_API_KEY`, `WAHA_WEBHOOK_BASE_URL`,
  `UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN` deixam de ser obrigatórias em produção.
  O código já tratava "não configurado" (tela de Conexões, `/api/v1/health`, fallback em memória).
- `workers/agent-worker/main.ts`: o vigia de sessão do WAHA só liga com as variáveis preenchidas
  (antes ligava com string vazia).
- `vercel.json`: Next.js, pnpm com lockfile, região São Paulo. Sem crons da Vercel — o plano
  grátis só aceita 1×/dia e as rotinas vão para o `pg_cron`.

## Variáveis de ambiente (Vercel)

Obrigatórias:

| Variável | Origem |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase › Project Settings › API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | idem |
| `SUPABASE_SERVICE_ROLE_KEY` | idem (secreta) |
| `SUPABASE_DB_URL` | Supabase › Connect › pooler de transações (porta 6543) |
| `INTERNAL_SECRET` | `openssl rand -hex 32` — também autentica as chamadas do `pg_cron` |
| `CPF_ENCRYPTION_KEY` | `openssl rand -hex 32` |
| `WAHA_BYO_ENCRYPTION_KEY` | `openssl rand -hex 32` (exigida pelo boot; não usada sem WAHA) |
| `AI_CRED_AES_KEY` | `openssl rand -base64 32` |
| `NEXT_PUBLIC_APP_URL` / `NEXT_PUBLIC_ADMIN_URL` | endereço publicado na Vercel |
| `APP_NAME` | `Dutorama CRM` |

Opcionais: `UPSTASH_REDIS_REST_URL`/`TOKEN` (plano grátis do Upstash), `META_WEBHOOK_BASE_URL`,
chaves de IA (`AI_GATEWAY_API_KEY` ou a credencial cadastrada pela tela).

As credenciais da Meta (token, número, WABA) são gravadas pela tela de conexão do canal oficial,
cifradas na sessão — não vão para variável de ambiente.

**Nunca commitar valores secretos.** As chaves de criptografia não podem mudar depois que houver
dados cifrados no banco.

## Instalação

Num Codespace do repositório (4 núcleos), rode `bash scripts/dutorama-setup.sh`. Ele gera as chaves,
aplica o schema no projeto Supabase `dutorama-crm` (sa-east-1), cadastra as variáveis na Vercel,
publica e cria o dono. Você só digita a senha do banco, o login do CRM e aprova os logins do
Supabase e da Vercel. As chaves ficam em `/workspaces/.dutorama-secrets.env` — não apague.

## Fases

1. **Base nova** a partir da versão atual do DeskcommCRM — esta branch.
2. Rotinas e worker sem processo ligado 24 h (`pg_cron` → rotas de cron; fila do `event_log`).
3. Importação do histórico de 6 meses da Meta (coexistência).
4. Testes com o número de teste da Meta.
5. Conexão do número da loja (47 99750-7391) só depois de tudo testado.
6. Importação dos clientes do Sankhya no padrão `CL código NOME`.
