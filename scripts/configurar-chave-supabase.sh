#!/usr/bin/env bash
set -euo pipefail

# Configura a chave administrativa do Supabase sem exibi-la no terminal,
# no histórico do shell ou nos argumentos de processos.

PROJECT_DIR="${1:-/root/DeskcommCRM}"
ENV_FILE="${PROJECT_DIR}/.env"
COMPOSE_FILE="${PROJECT_DIR}/docker-compose.prod.yml"
TMP_FILE=""
SUPABASE_KEY=""

cleanup() {
  SUPABASE_KEY=""
  unset SUPABASE_KEY
  if [ -n "$TMP_FILE" ] && [ -f "$TMP_FILE" ]; then
    rm -f -- "$TMP_FILE"
  fi
}
trap cleanup EXIT
umask 077

if [ ! -f "$ENV_FILE" ]; then
  printf 'ERRO: arquivo %s não encontrado.\n' "$ENV_FILE" >&2
  exit 1
fi

printf 'Cole a NOVA Secret key do projeto Dutorama CRM e pressione Enter.\n'
printf 'A chave ficará invisível: '
IFS= read -r -s SUPABASE_KEY
printf '\n'

if [ -z "$SUPABASE_KEY" ]; then
  printf 'ERRO: nenhuma chave foi recebida; nada foi alterado.\n' >&2
  exit 1
fi

case "$SUPABASE_KEY" in
  sb_secret_*|eyJ*) ;;
  *)
    printf 'ERRO: use uma Secret key (sb_secret_) ou a service_role legada; nada foi alterado.\n' >&2
    exit 1
    ;;
esac

SUPABASE_URL="$(sed -n 's/^NEXT_PUBLIC_SUPABASE_URL=//p' "$ENV_FILE" | tail -n 1)"
SUPABASE_URL="${SUPABASE_URL#\"}"
SUPABASE_URL="${SUPABASE_URL%\"}"
SUPABASE_URL="${SUPABASE_URL#\'}"
SUPABASE_URL="${SUPABASE_URL%\'}"
SUPABASE_URL="${SUPABASE_URL%/}"

if [ -z "$SUPABASE_URL" ]; then
  printf 'ERRO: NEXT_PUBLIC_SUPABASE_URL está ausente; nada foi alterado.\n' >&2
  exit 1
fi

printf 'Validando a chave diretamente no Supabase...\n'
if ! HTTP_STATUS="$(curl -sS --connect-timeout 10 --max-time 30 -o /dev/null -w '%{http_code}' \
  "${SUPABASE_URL}/rest/v1/platform_branding?select=id&limit=1" \
  -H "apikey: ${SUPABASE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_KEY}")"; then
  printf 'ERRO: não foi possível alcançar o Supabase; nada foi alterado.\n' >&2
  exit 1
fi

if [ "$HTTP_STATUS" != "200" ]; then
  printf 'ERRO: o Supabase recusou a chave (HTTP %s); nada foi alterado.\n' "$HTTP_STATUS" >&2
  exit 1
fi

BACKUP_FILE="${ENV_FILE}.backup-chave-$(date -u +%Y%m%d-%H%M%S)"
cp -p -- "$ENV_FILE" "$BACKUP_FILE"

TMP_FILE="$(mktemp "${ENV_FILE}.tmp.XXXXXX")"
{ grep -vE '^(SUPABASE_SERVICE_ROLE_KEY|APP_IMAGE|APP_PULL_POLICY)=' "$ENV_FILE" || true; } > "$TMP_FILE"
printf '%s\n' \
  "SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_KEY}" \
  'APP_IMAGE=dutorama-crm:local' \
  'APP_PULL_POLICY=never' >> "$TMP_FILE"
chmod 600 "$TMP_FILE"
mv -- "$TMP_FILE" "$ENV_FILE"
TMP_FILE=""

# Apaga a chave da variável antes de chamar o Docker. O Compose a lê do .env.
SUPABASE_KEY=""
unset SUPABASE_KEY

cd "$PROJECT_DIR"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" \
  up -d --no-deps --force-recreate --pull never app

CONTAINER_ID="$(docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps -q app)"
if [ -z "$CONTAINER_ID" ]; then
  printf 'ERRO: o container do app não foi criado. Backup: %s\n' "$BACKUP_FILE" >&2
  exit 1
fi

printf 'Aguardando o CRM ficar saudável...\n'
for _ in $(seq 1 45); do
  HEALTH="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$CONTAINER_ID" 2>/dev/null || true)"
  if [ "$HEALTH" = "healthy" ]; then
    if docker exec "$CONTAINER_ID" node -e 'process.exit(process.env.SUPABASE_SERVICE_ROLE_KEY ? 0 : 1)'; then
      printf 'SUCESSO: chave aceita, salva e carregada. CRM saudável.\n'
      exit 0
    fi
    printf 'ERRO: o CRM subiu sem carregar a chave. Backup: %s\n' "$BACKUP_FILE" >&2
    exit 1
  fi
  if [ "$HEALTH" = "unhealthy" ]; then
    printf 'ERRO: o CRM ficou unhealthy após reiniciar. Backup: %s\n' "$BACKUP_FILE" >&2
    exit 1
  fi
  sleep 2
done

printf 'ERRO: o CRM não ficou saudável no tempo esperado. Backup: %s\n' "$BACKUP_FILE" >&2
exit 1
