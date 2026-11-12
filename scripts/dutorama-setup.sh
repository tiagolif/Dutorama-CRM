#!/usr/bin/env bash
# Dutorama CRM — instalação em Supabase (nuvem) + Vercel, a partir de um Codespace.
#
# O que você digita: o e-mail e a senha de login do CRM, a senha do banco do
# Supabase, e aprova os logins do Supabase e da Vercel no navegador. Todo o resto
# (chaves de criptografia, schema, variáveis da Vercel, deploy) o script faz.
#
# Segredos gerados ficam em /workspaces/.dutorama-secrets.env (fora do git, 600).
# NÃO apague esse arquivo: as chaves de criptografia não podem mudar depois que
# houver dados cifrados no banco.
#
# Uso:  bash scripts/dutorama-setup.sh
# Reexecutar é seguro: reaproveita o que já existe.

set -euo pipefail

REF="${SUPABASE_PROJECT_REF:-fymtycbozzpmdzppjcqx}"
REGION="sa-east-1"
VERCEL_PROJECT="${VERCEL_PROJECT:-dutorama-crm}"
ORG_NAME="${OWNER_ORG_NAME:-Valdir Móveis Ubatuba}"
SECRETS="/workspaces/.dutorama-secrets.env"
LOGDIR="/workspaces/logs"
mkdir -p "$LOGDIR"

ok()   { printf '\033[32m✓ %s\033[0m\n' "$*"; }
info() { printf '\033[36m• %s\033[0m\n' "$*"; }
die()  { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

cd "$(dirname "$0")/.."

# ── 0. Ferramentas ──────────────────────────────────────────────────────────
if ! command -v psql >/dev/null 2>&1; then
  info "instalando o cliente do Postgres"
  sudo apt-get update -qq >/dev/null && sudo apt-get install -y -qq postgresql-client >/dev/null
fi
command -v pnpm >/dev/null 2>&1 || corepack enable
[ -d node_modules ] || pnpm install --frozen-lockfile
SUPA="npx -y supabase@latest"
VC="npx -y vercel@latest"

# ── 1. Segredos (gerados uma vez só) ────────────────────────────────────────
touch "$SECRETS"; chmod 600 "$SECRETS"
# shellcheck disable=SC1090
set -a; . "$SECRETS"; set +a
gerar() { # nome comando
  local nome="$1"; shift
  if [ -z "${!nome:-}" ]; then
    local v; v="$("$@")"
    printf '%s=%s\n' "$nome" "$v" >> "$SECRETS"
    export "$nome=$v"
  fi
}
gerar INTERNAL_SECRET openssl rand -hex 32
gerar CPF_ENCRYPTION_KEY openssl rand -base64 32
gerar AI_CRED_AES_KEY openssl rand -base64 32
gerar WAHA_BYO_ENCRYPTION_KEY openssl rand -base64 32
gerar NUVEMSHOP_OAUTH_ENCRYPTION_KEY openssl rand -hex 32
gerar IMPERSONATE_COOKIE_SECRET openssl rand -hex 32
gerar LGPD_SIGNING_KEY openssl rand -hex 32
ok "chaves de criptografia prontas ($SECRETS)"

# ── 2. Banco: senha + endereço do pooler ────────────────────────────────────
if [ -z "${SUPABASE_DB_PASSWORD:-}" ]; then
  echo
  echo "Senha do BANCO do Supabase (projeto dutorama-crm)."
  echo "Se não sabe: supabase.com › projeto dutorama-crm › Database › Settings › Reset database password."
  read -rsp "Senha do banco: " SUPABASE_DB_PASSWORD; echo
  [ -n "$SUPABASE_DB_PASSWORD" ] || die "senha vazia"
fi
PASS_ENC="$(python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1],safe=""))' "$SUPABASE_DB_PASSWORD")"

POOLER=""
for prefixo in aws-0 aws-1; do
  host="${prefixo}-${REGION}.pooler.supabase.com"
  if PGCONNECT_TIMEOUT=10 psql "postgresql://postgres.${REF}:${PASS_ENC}@${host}:5432/postgres?sslmode=require" -tAc 'select 1' >/dev/null 2>&1; then
    POOLER="$host"; break
  fi
done
[ -n "$POOLER" ] || die "não consegui entrar no banco — confira a senha do banco e rode de novo"
ADMIN_URL="postgresql://postgres.${REF}:${PASS_ENC}@${POOLER}:5432/postgres?sslmode=require"
APP_DB_URL="postgresql://postgres.${REF}:${PASS_ENC}@${POOLER}:6543/postgres?sslmode=require"
grep -q '^SUPABASE_DB_PASSWORD=' "$SECRETS" || printf 'SUPABASE_DB_PASSWORD=%s\n' "$SUPABASE_DB_PASSWORD" >> "$SECRETS"
ok "banco acessível ($POOLER)"

# ── 3. Schema ───────────────────────────────────────────────────────────────
tem_schema="$(psql "$ADMIN_URL" -tAc "select 1 from information_schema.tables where table_schema='public' and table_name='organizations'" | tr -d '[:space:]')"
if [ "$tem_schema" = "1" ]; then
  ok "schema já aplicado — pulando"
else
  info "aplicando o schema (alguns minutos)"
  psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -qc \
    "create extension if not exists vector with schema public; create extension if not exists citext with schema public; create extension if not exists pg_trgm with schema public;"
  psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -f supabase/baseline.sql > "$LOGDIR/schema.log" 2>&1 \
    || die "o schema falhou — veja $LOGDIR/schema.log"
  ok "schema aplicado"
fi
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -qc \
  "insert into private.app_secrets (name, value) values ('nuvemshop_oauth_key', '${NUVEMSHOP_OAUTH_ENCRYPTION_KEY}'), ('cpf_key', '${CPF_ENCRYPTION_KEY}') on conflict (name) do update set value = excluded.value, updated_at = now();"
ok "chaves de cifra semeadas no banco"

# ── 4. Chaves da API do Supabase ────────────────────────────────────────────
if [ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ] || [ -z "${NEXT_PUBLIC_SUPABASE_ANON_KEY:-}" ]; then
  if ! $SUPA projects list >/dev/null 2>&1; then
    echo; info "login no Supabase: abra o link que aparecer e aprove"
    $SUPA login
  fi
  chaves="$($SUPA projects api-keys --project-ref "$REF" -o json)"
  anon="$(printf '%s' "$chaves" | node -e 'const k=JSON.parse(require("fs").readFileSync(0));process.stdout.write((k.find(x=>x.name==="anon")||{}).api_key||"")')"
  srv="$(printf '%s' "$chaves" | node -e 'const k=JSON.parse(require("fs").readFileSync(0));process.stdout.write((k.find(x=>x.name==="service_role")||{}).api_key||"")')"
  [ -n "$anon" ] && [ -n "$srv" ] || die "não consegui ler as chaves da API do Supabase"
  printf 'NEXT_PUBLIC_SUPABASE_ANON_KEY=%s\nSUPABASE_SERVICE_ROLE_KEY=%s\n' "$anon" "$srv" >> "$SECRETS"
  export NEXT_PUBLIC_SUPABASE_ANON_KEY="$anon" SUPABASE_SERVICE_ROLE_KEY="$srv"
fi
export NEXT_PUBLIC_SUPABASE_URL="https://${REF}.supabase.co"
ok "chaves da API do Supabase prontas"

# ── 5. Vercel: projeto + variáveis ──────────────────────────────────────────
if ! $VC whoami >/dev/null 2>&1; then
  echo; info "login na Vercel: abra o link que aparecer e aprove"
  $VC login
fi
$VC link --yes --project "$VERCEL_PROJECT" >/dev/null
ok "projeto Vercel '$VERCEL_PROJECT' ligado"

env_vercel() { # nome valor
  $VC env rm "$1" production --yes >/dev/null 2>&1 || true
  printf '%s' "$2" | $VC env add "$1" production >/dev/null
}
for v in NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY \
         INTERNAL_SECRET CPF_ENCRYPTION_KEY AI_CRED_AES_KEY WAHA_BYO_ENCRYPTION_KEY \
         NUVEMSHOP_OAUTH_ENCRYPTION_KEY IMPERSONATE_COOKIE_SECRET LGPD_SIGNING_KEY; do
  env_vercel "$v" "${!v}"
done
env_vercel SUPABASE_DB_URL "$APP_DB_URL"
env_vercel APP_NAME "Dutorama CRM"
env_vercel APP_LOCALE "pt-BR"
env_vercel NODE_OPTIONS "--max-old-space-size=7168"
ok "variáveis cadastradas na Vercel"

# ── 6. Deploy (duas passadas: a 2ª já com o endereço público) ───────────────
publicar() { $VC deploy --prod --yes 2>"$LOGDIR/deploy.log" | tail -1; }
info "publicando na Vercel (o build roda lá, ~10 min)"
url_deploy="$(publicar)" || die "deploy falhou — veja $LOGDIR/deploy.log"
APP_URL="$($VC inspect "$url_deploy" 2>&1 | grep -oE 'https://[a-z0-9.-]+\.vercel\.app' | awk '{print length, $0}' | sort -n | head -1 | cut -d' ' -f2)"
[ -n "$APP_URL" ] || APP_URL="$url_deploy"
env_vercel NEXT_PUBLIC_APP_URL "$APP_URL"
env_vercel NEXT_PUBLIC_ADMIN_URL "$APP_URL"
publicar >/dev/null || die "2º deploy falhou — veja $LOGDIR/deploy.log"
ok "publicado em $APP_URL"

# ── 7. Dono do CRM ──────────────────────────────────────────────────────────
echo
read -rp "E-mail de login do CRM (dono): " OWNER_EMAIL
read -rsp "Senha de login do CRM (mín. 12 caracteres): " OWNER_PASSWORD; echo
OWNER_EMAIL="$OWNER_EMAIL" OWNER_PASSWORD="$OWNER_PASSWORD" OWNER_ORG_NAME="$ORG_NAME" \
  NEXT_PUBLIC_APP_URL="$APP_URL" APP_LOCALE="pt-BR" npx tsx scripts/bootstrap-owner.ts
unset OWNER_PASSWORD

echo
ok "Dutorama CRM no ar: $APP_URL"
echo "  Webhook da Meta: o endereço e o token de verificação aparecem em Conexões › Canal oficial."
