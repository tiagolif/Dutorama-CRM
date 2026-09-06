#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

TARGET_BRANCH="${DUTORAMA_DEV_BRANCH:-develop}"
SYNC_SECONDS="${DUTORAMA_SYNC_SECONDS:-5}"
CURRENT_BRANCH="$(git branch --show-current)"

if [[ "$CURRENT_BRANCH" != "$TARGET_BRANCH" ]]; then
  echo "[workspace-dev] Branch atual: $CURRENT_BRANCH"
  echo "[workspace-dev] Troque para '$TARGET_BRANCH' antes de iniciar."
  exit 2
fi

# Codespaces costuma trazer Node/Corepack. Mantemos o pnpm na versao do projeto.
corepack enable >/dev/null 2>&1 || true
if ! command -v pnpm >/dev/null 2>&1; then
  corepack prepare pnpm@9.15.9 --activate
fi

if [[ ! -x node_modules/.bin/next ]]; then
  echo "[workspace-dev] Dependencias ausentes. Instalando uma unica vez..."
  pnpm install --frozen-lockfile
fi

autosync() {
  while true; do
    # Alteracoes locais em arquivos rastreados nunca sao sobrescritas.
    if ! git diff --quiet || ! git diff --cached --quiet; then
      echo "[autosync] Alteracao local rastreada detectada; sincronizacao pausada."
    else
      if git fetch origin "$TARGET_BRANCH" --quiet; then
        local_sha="$(git rev-parse HEAD)"
        remote_sha="$(git rev-parse "origin/$TARGET_BRANCH")"

        if [[ "$local_sha" != "$remote_sha" ]]; then
          base_sha="$(git merge-base HEAD "origin/$TARGET_BRANCH")"
          if [[ "$base_sha" == "$local_sha" ]]; then
            if git merge --ff-only "origin/$TARGET_BRANCH" --quiet; then
              echo "[autosync] Atualizado para $(git rev-parse --short HEAD)."
            else
              echo "[autosync] Nao foi possivel aplicar fast-forward; verifique o Git."
            fi
          else
            echo "[autosync] Branch local divergiu de origin/$TARGET_BRANCH; sincronizacao pausada."
          fi
        fi
      else
        echo "[autosync] Falha temporaria no fetch; nova tentativa em ${SYNC_SECONDS}s."
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

echo "[workspace-dev] Auto-sync: origin/$TARGET_BRANCH a cada ${SYNC_SECONDS}s."
echo "[workspace-dev] Iniciando Next.js em modo dev na porta 3000."
echo "[workspace-dev] Deixe este terminal aberto durante a validacao."

pnpm dev --hostname 0.0.0.0 &
DEV_PID=$!
wait "$DEV_PID"
