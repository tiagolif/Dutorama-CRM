#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

DEV_PROJECT_REF="hbosmcxdzoujqzeflqnb"
DEV_PROJECT_URL="https://${DEV_PROJECT_REF}.supabase.co"
DEV_PUBLISHABLE_KEY="sb_publishable_DHYQBPaldv8l9vJ_A73MEw__PzcV0q4"
DEV_DB_HOST="db.${DEV_PROJECT_REF}.supabase.co"
PROD_PROJECT_REF="tznysoyydleooqfyuiem"

if [[ "$(git branch --show-current)" != "develop" ]]; then
  echo "ERRO: execute este script somente na branch develop." >&2
  exit 2
fi

if [[ "$DEV_PROJECT_REF" == "$PROD_PROJECT_REF" ]]; then
  echo "ERRO CRITICO: o projeto DEV coincide com producao. Abortando." >&2
  exit 3
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "ERRO: Docker nao encontrado no workspace." >&2
  exit 4
fi

if [[ ! -f "$ROOT/supabase/baseline.sql" ]]; then
  echo "ERRO: supabase/baseline.sql nao encontrado." >&2
  exit 5
fi

echo "============================================================"
echo " DUTORAMA DEV - RESET CONTROLADO DO SUPABASE DE DESENVOLVIMENTO"
echo "============================================================"
echo "Projeto DEV: ${DEV_PROJECT_REF}"
echo "Producao bloqueada por ref: ${PROD_PROJECT_REF}"
echo
read -r -p "Digite APAGAR ORBIT DEV para continuar: " CONFIRMA
if [[ "$CONFIRMA" != "APAGAR ORBIT DEV" ]]; then
  echo "Cancelado."
  exit 0
fi

read -r -s -p "Senha do banco do projeto Orbit/Dutorama DEV: " DBPASS
echo
read -r -s -p "Service Role Key do projeto Orbit/Dutorama DEV: " SERVICE_ROLE_KEY
echo

if [[ -z "$DBPASS" || -z "$SERVICE_ROLE_KEY" ]]; then
  echo "ERRO: senha do banco e Service Role Key sao obrigatorias." >&2
  exit 6
fi

PSQL_IMAGE="postgres:17-alpine"

run_psql() {
  docker run --rm --network host \
    -e PGPASSWORD="$DBPASS" \
    "$PSQL_IMAGE" \
    psql -h "$DEV_DB_HOST" -p 5432 -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"
}

echo "[1/5] Testando conexao com o banco DEV..."
run_psql -tAc "select current_database(), current_user" >/dev/null

echo "[2/5] Limpando somente o projeto DEV..."
run_psql <<'SQL'
begin;

drop schema if exists public cascade;
create schema public;
alter schema public owner to pg_database_owner;
grant usage on schema public to postgres, anon, authenticated, service_role;
grant all on schema public to postgres, service_role;

-- Dados antigos do projeto Orbit nao sao reaproveitados no Dutorama DEV.
delete from storage.objects;
delete from storage.buckets;
delete from auth.users;

create extension if not exists vector with schema public;
create extension if not exists citext with schema public;
create extension if not exists pg_trgm with schema public;

commit;
SQL

echo "[3/5] Aplicando o baseline atual do Dutorama..."
docker run --rm --network host -i \
  -e PGPASSWORD="$DBPASS" \
  "$PSQL_IMAGE" \
  psql -h "$DEV_DB_HOST" -p 5432 -U postgres -d postgres -v ON_ERROR_STOP=1 -f - \
  < "$ROOT/supabase/baseline.sql"

echo "[4/5] Validando schema Dutorama..."
HAS_ORGS="$(run_psql -tAc "select to_regclass('public.organizations') is not null" | tr -d '[:space:]')"
HAS_CONTACTS="$(run_psql -tAc "select to_regclass('public.contacts') is not null" | tr -d '[:space:]')"
HAS_LLM="$(run_psql -tAc "select to_regclass('public.llm_calls') is not null" | tr -d '[:space:]')"

if [[ "$HAS_ORGS" != "t" || "$HAS_CONTACTS" != "t" || "$HAS_LLM" != "t" ]]; then
  echo "ERRO: baseline terminou, mas tabelas essenciais nao foram encontradas." >&2
  exit 7
fi

APP_URL="http://localhost:3000"
if [[ -n "${CODESPACE_NAME:-}" ]]; then
  FORWARD_DOMAIN="${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"
  APP_URL="https://${CODESPACE_NAME}-3000.${FORWARD_DOMAIN}"
fi

ENCODED_PASS="$(DBPASS="$DBPASS" python3 - <<'PY'
from urllib.parse import quote
import os
print(quote(os.environ['DBPASS'], safe=''))
PY
)"

AI_CRED_AES_KEY="$(openssl rand -base64 32 | tr -d '\n')"
INTERNAL_SECRET="$(openssl rand -hex 32)"
IMPERSONATE_COOKIE_SECRET="$(openssl rand -hex 32)"
CPF_ENCRYPTION_KEY="$(openssl rand -hex 32)"
WAHA_BYO_ENCRYPTION_KEY="$(openssl rand -hex 32)"

cat > "$ROOT/.env.local" <<EOF
# Dutorama DEV - gerado por scripts/bootstrap-cloud-dev.sh
# Nunca copiar para producao.
NEXT_PUBLIC_SUPABASE_URL=${DEV_PROJECT_URL}
NEXT_PUBLIC_SUPABASE_ANON_KEY=${DEV_PUBLISHABLE_KEY}
SUPABASE_SERVICE_ROLE_KEY=${SERVICE_ROLE_KEY}
SUPABASE_DB_URL=postgresql://postgres:${ENCODED_PASS}@${DEV_DB_HOST}:5432/postgres?sslmode=require
NEXT_PUBLIC_APP_URL=${APP_URL}
NEXT_PUBLIC_ADMIN_URL=${APP_URL}
INTERNAL_SECRET=${INTERNAL_SECRET}
INTERNAL_CRON_SECRET=${INTERNAL_SECRET}
IMPERSONATE_COOKIE_SECRET=${IMPERSONATE_COOKIE_SECRET}
CPF_ENCRYPTION_KEY=${CPF_ENCRYPTION_KEY}
WAHA_BYO_ENCRYPTION_KEY=${WAHA_BYO_ENCRYPTION_KEY}
AI_CRED_AES_KEY=${AI_CRED_AES_KEY}
SENTRY_DSN=
EOF
chmod 600 "$ROOT/.env.local"

echo "[5/5] Ambiente DEV preparado."
echo "Supabase DEV: OK"
echo "Schema Dutorama: OK"
echo ".env.local: OK"
echo "Nenhuma credencial foi exibida."

unset DBPASS SERVICE_ROLE_KEY ENCODED_PASS
