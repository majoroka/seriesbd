#!/bin/sh
set -eu

ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null)"
if [ -z "$ROOT_DIR" ]; then
  echo "Este comando tem de ser executado dentro do repositório git." >&2
  exit 1
fi

cd "$ROOT_DIR"

if ! git rev-parse --verify HEAD >/dev/null 2>&1; then
  echo "Não existe um commit HEAD para empacotar." >&2
  exit 1
fi

if ! git diff --quiet --ignore-submodules --exit-code || ! git diff --cached --quiet --ignore-submodules --exit-code; then
  echo "O worktree tem alterações por commit. Faça commit ou stash antes de gerar o bundle auditável." >&2
  exit 1
fi

OUTPUT_DIR="${AUDIT_BUNDLE_DIR:-artifacts}"
mkdir -p "$OUTPUT_DIR"

STAMP="$(date +"%Y%m%d-%H%M%S")"
SHORT_SHA="$(git rev-parse --short HEAD)"
BUNDLE_PATH="$OUTPUT_DIR/seriesBD-audit-${STAMP}-${SHORT_SHA}.zip"

git archive --format=zip --output "$BUNDLE_PATH" HEAD

echo "Bundle auditável criado em: $BUNDLE_PATH"
