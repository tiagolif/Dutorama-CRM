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

MIGRATIONS_DIR="$ROOT/supabase/migrations"
MIGRATIONS_STASH=""

restore_migrations() {
  if [[ -n "$MIGRATIONS_STASH" && -d "$MIGRATIONS_STASH/migrations" ]]; then
    rm -rf "$MIGRATIONS_DIR"
    mv "$MIGRATIONS_STASH/migrations" "$MIGRATIONS_DIR"
    rmdir "$MIGRATIONS_STASH" 2>/dev/null || true
    MIGRATIONS_STASH=""
  fi
}
trap restore_migrations EXIT INT TERM

start_local_stack_from_baseline() {
  # O historico antigo deste repo contem stubs de migrations que registram
  # mudancas aplicadas diretamente no Supabase remoto. Ele nao consegue montar
  # um banco vazio sozinho. O instalador self-host oficial usa baseline.sql como
  # snapshot; o Codespace deve seguir o mesmo caminho.
  supabase_cli stop --no-backup >/dev/null 2>&1 || true

  MIGRATIONS_STASH="$(mktemp -d)"
  mv "$MIGRATIONS_DIR" "$MIGRATIONS_STASH/migrations"
  mkdir -p "$MIGRATIONS_DIR"

  echo "[workspace-supabase] Subindo stack local limpa sem replay das migrations historicas..."
  if ! supabase_cli start; then
    restore_migrations
    return 1
  fi

  restore_migrations
}

echo "[workspace-supabase] Verificando Supabase local isolado..."
if ! supabase_cli status >/dev/null 2>&1; then
  echo "[workspace-supabase] Primeira inicializacao ou stack incompleta detectada."
  start_local_stack_from_baseline
fi

STATUS_ENV="$(supabase_cli status -o env)"
# A saida vem do Supabase CLI local e contem somente credenciais efemeras deste DEV.
eval "$STATUS_ENV"

: "${API_URL:?API_URL ausente no status do Supabase local}"
: "${ANON_KEY:?ANON_KEY ausente no status do Supabase local}"
: "${SERVICE_ROLE_KEY:?SERVICE_ROLE_KEY ausente no status do Supabase local}"
: "${DB_URL:?DB_URL ausente no status do Supabase local}"

# O baseline e o caminho de bootstrap usado pelo proprio instalador do projeto.
# Ele referencia vector/citext/pg_trgm no schema public, entao habilitamos essas
# extensoes antes de importar o dump.
HAS_SCHEMA="$(docker run --rm --network host postgres:17-alpine \
  psql "$DB_URL" -tAc \
  "select 1 from information_schema.tables where table_schema='public' and table_name='organizations' limit 1" \
  2>/dev/null | tr -d '[:space:]' || true)"

if [[ "$HAS_SCHEMA" != "1" ]]; then
  echo "[workspace-supabase] Aplicando baseline atual do Dutorama no banco DEV..."

  docker run --rm --network host postgres:17-alpine \
    psql "$DB_URL" -v ON_ERROR_STOP=1 -c \
    "create extension if not exists vector with schema public; create extension if not exists citext with schema public; create extension if not exists pg_trgm with schema public;" \
    >/dev/null

  docker run --rm --network host -i postgres:17-alpine \
    psql "$DB_URL" -v ON_ERROR_STOP=1 -f - \
    < "$ROOT/supabase/baseline.sql" \
    >/tmp/dutorama-workspace-baseline.log 2>&1 || {
      echo "[workspace-supabase] ERRO ao aplicar baseline. Ultimas linhas:" >&2
      tail -20 /tmp/dutorama-workspace-baseline.log >&2 || true
      exit 1
    }

  HAS_SCHEMA="$(docker run --rm --network host postgres:17-alpine \
    psql "$DB_URL" -tAc \
    "select 1 from information_schema.tables where table_schema='public' and table_name='organizations' limit 1" \
    2>/dev/null | tr -d '[:space:]' || true)"

  if [[ "$HAS_SCHEMA" != "1" ]]; then
    echo "[workspace-supabase] Baseline terminou sem criar organizations; abortando DEV." >&2
    exit 1
  fi

  echo "[workspace-supabase] Baseline aplicado com sucesso."
fi

PUBLIC_SUPABASE_URL="$API_URL"
PUBLIC_APP_URL="http://localhost:3000"

if [[ -n "${CODESPACE_NAME:-}" ]]; then
  FORWARD_DOMAIN="${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"
  PUBLIC_SUPABASE_URL="https://${CODESPACE_NAME}-54321.${FORWARD_DOMAIN}"
  PUBLIC_APP_URL="https://${CODESPACE_NAME}-3000.${FORWARD_DOMAIN}"

  # O navegador precisa falar com a API Supabase local. Esta instancia e efemera
  # e contem apenas dados de teste. A porta e aberta somente no Codespace.
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
