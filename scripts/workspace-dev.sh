#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

TARGET_BRANCH="${DUTORAMA_DEV_BRANCH:-develop}"
SYNC_SECONDS="${DUTORAMA_SYNC_SECONDS:-5}"

if [[ "$(git branch --show-current)" != "$TARGET_BRANCH" ]]; then
  echo "ERRO: troque para a branch $TARGET_BRANCH antes de iniciar." >&2
  exit 2
fi

if [[ ! -f .env.local ]]; then
  echo "ERRO: .env.local ausente." >&2
  echo "Execute uma vez: bash scripts/bootstrap-cloud-dev.sh" >&2
  exit 3
fi

corepack enable >/dev/null 2>&1 || true
if ! command -v pnpm >/dev/null 2>&1; then
  corepack prepare pnpm@9.15.9 --activate >/dev/null
fi

if [[ ! -x node_modules/.bin/next ]]; then
  echo "[workspace-dev] Instalando dependencias..."
  pnpm install --frozen-lockfile
fi

if [[ -n "${CODESPACE_NAME:-}" ]] && command -v gh >/dev/null 2>&1; then
  gh codespace ports visibility 3000:public -c "$CODESPACE_NAME" >/dev/null 2>&1 || true
fi

autosync() {
  while true; do
    if ! git diff --quiet || ! git diff --cached --quiet; then
      echo "[autosync] Alteracao local detectada; sincronizacao pausada."
    elif git fetch origin "$TARGET_BRANCH" --quiet; then
      local_sha="$(git rev-parse HEAD)"
      remote_sha="$(git rev-parse "origin/$TARGET_BRANCH")"
      if [[ "$local_sha" != "$remote_sha" ]]; then
        base_sha="$(git merge-base HEAD "origin/$TARGET_BRANCH")"
        if [[ "$base_sha" == "$local_sha" ]]; then
          git merge --ff-only "origin/$TARGET_BRANCH" --quiet
          echo "[autosync] Atualizado para $(git rev-parse --short HEAD)."
        else
          echo "[autosync] Branch local divergiu; sincronizacao pausada."
        fi
      fi
    fi
    sleep "$SYNC_SECONDS"
  done
}

autosync &
SYNC_PID=$!
DEV_PID=""

cleanup() {
  kill "$SYNC_PID" >/dev/null 2>&1 || true
  if [[ -n "$DEV_PID" ]]; then
    kill "$DEV_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

echo "[workspace-dev] Supabase: projeto DEV em nuvem"
echo "[workspace-dev] Auto-sync: origin/$TARGET_BRANCH a cada ${SYNC_SECONDS}s"
echo "[workspace-dev] Iniciando Next.js na porta 3000"

pnpm dev --hostname 0.0.0.0 &
DEV_PID=$!
wait "$DEV_PID"
