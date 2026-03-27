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
FULL_SHA="$(git rev-parse HEAD)"
BUNDLE_PATH="$OUTPUT_DIR/seriesBD-audit-${STAMP}-${SHORT_SHA}.zip"
CHECKSUM_PATH="${BUNDLE_PATH}.sha256"
METADATA_PATH="${BUNDLE_PATH%.zip}.metadata.txt"

git archive --format=zip --output "$BUNDLE_PATH" HEAD

if command -v shasum >/dev/null 2>&1; then
  shasum -a 256 "$BUNDLE_PATH" > "$CHECKSUM_PATH"
elif command -v sha256sum >/dev/null 2>&1; then
  sha256sum "$BUNDLE_PATH" > "$CHECKSUM_PATH"
else
  echo "Nem 'shasum' nem 'sha256sum' estão disponíveis para gerar checksum." >&2
  exit 1
fi

{
  echo "bundle_path=$(basename "$BUNDLE_PATH")"
  echo "commit_sha=$FULL_SHA"
  echo "commit_short_sha=$SHORT_SHA"
  echo "generated_at=$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo "git_ref=$(git symbolic-ref --quiet --short HEAD 2>/dev/null || echo detached-head)"
} > "$METADATA_PATH"

echo "Bundle auditável criado em: $BUNDLE_PATH"
echo "Checksum SHA-256 criado em: $CHECKSUM_PATH"
echo "Metadata criada em: $METADATA_PATH"
