#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

if ! command -v docker >/dev/null 2>&1; then
  echo "[workspace-supabase] Docker nao encontrado. O ambiente de preview precisa de Docker." >&2
  exit 2
fi

corepack enable >/dev/null 2>&1 || true
if ! command -v pnpm >/dev/null 2>&1; then
  corepack prepare pnpm@9.15.9 --activate >/dev/null
fi

SUPABASE_CLI_VERSION="${SUPABASE_CLI_VERSION:-latest}"
supabase_cli() {
  pnpm --silent dlx "supabase@${SUPABASE_CLI_VERSION}" "$@"
}

echo "[workspace-supabase] Verificando Supabase local isolado..."
if ! supabase_cli status >/dev/null 2>&1; then
  echo "[workspace-supabase] Iniciando Supabase local. Na primeira vez pode levar alguns minutos..."
  supabase_cli start
fi

STATUS_ENV="$(supabase_cli status -o env)"
# A saida vem do Supabase CLI local e contem somente as credenciais efemeras
# deste ambiente de desenvolvimento.
eval "$STATUS_ENV"

: "${API_URL:?API_URL ausente no status do Supabase local}"
: "${ANON_KEY:?ANON_KEY ausente no status do Supabase local}"
: "${SERVICE_ROLE_KEY:?SERVICE_ROLE_KEY ausente no status do Supabase local}"
: "${DB_URL:?DB_URL ausente no status do Supabase local}"

PUBLIC_SUPABASE_URL="$API_URL"
PUBLIC_APP_URL="http://localhost:3000"

if [[ -n "${CODESPACE_NAME:-}" ]]; then
  FORWARD_DOMAIN="${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"
  PUBLIC_SUPABASE_URL="https://${CODESPACE_NAME}-54321.${FORWARD_DOMAIN}"
  PUBLIC_APP_URL="https://${CODESPACE_NAME}-3000.${FORWARD_DOMAIN}"

  # O browser precisa falar com a API Supabase local. Como essa instancia e
  # efemera, sem dados de producao e protegida por RLS, tornamos apenas a porta
  # da API local acessivel durante o Codespace. Nunca fazemos isso na VPS.
  if command -v gh >/dev/null 2>&1; then
    gh codespace ports visibility 54321:public -c "$CODESPACE_NAME" >/dev/null 2>&1 || true
  fi
fi

cat > .env.local <<EOF
# Gerado por scripts/workspace-supabase.sh
# Ambiente isolado de desenvolvimento. Nunca copie secrets de producao para ca.
NEXT_PUBLIC_SUPABASE_URL=${PUBLIC_SUPABASE_URL}
NEXT_PUBLIC_SUPABASE_ANON_KEY=${ANON_KEY}
SUPABASE_SERVICE_ROLE_KEY=${SERVICE_ROLE_KEY}
SUPABASE_DB_URL=${DB_URL}
NEXT_PUBLIC_APP_URL=${PUBLIC_APP_URL}
NEXT_PUBLIC_ADMIN_URL=${PUBLIC_APP_URL}
SENTRY_DSN=off
EOF

chmod 600 .env.local

echo "[workspace-supabase] Ambiente DEV pronto e isolado da producao."
echo "[workspace-supabase] API local: porta 54321"
echo "[workspace-supabase] Banco local: porta 54322"
echo "[workspace-supabase] .env.local gerado sem exibir credenciais."
