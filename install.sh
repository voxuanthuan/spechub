#!/usr/bin/env sh
set -eu

SPECHUB_REPO="${SPECHUB_REPO:-https://github.com/voxuanthuan/spechub.git}"
SPECHUB_BRANCH="${SPECHUB_BRANCH:-main}"
SPECHUB_INSTALL_DIR="${SPECHUB_INSTALL_DIR:-$HOME/.spechub}"

log() {
  printf '%s\n' "$1"
}

fail() {
  printf 'SpecHub install error: %s\n' "$1" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "missing required command: $1"
}

ensure_pnpm() {
  if command -v pnpm >/dev/null 2>&1; then
    return
  fi

  if command -v corepack >/dev/null 2>&1; then
    log "pnpm not found; enabling pnpm with Corepack..."
    corepack enable pnpm >/dev/null 2>&1 || corepack enable >/dev/null 2>&1 || true
  fi

  command -v pnpm >/dev/null 2>&1 || fail "pnpm is required. Install pnpm or enable Corepack, then rerun this installer."
}

is_spechub_checkout() {
  test -f package.json && grep '"name": "spechub"' package.json >/dev/null 2>&1 && test -f src/cli.ts
}

prepare_remote_checkout() {
  need_cmd git

  if test -d "$SPECHUB_INSTALL_DIR/.git"; then
    log "Updating SpecHub in $SPECHUB_INSTALL_DIR..."
    git -C "$SPECHUB_INSTALL_DIR" fetch origin "$SPECHUB_BRANCH"
    git -C "$SPECHUB_INSTALL_DIR" checkout "$SPECHUB_BRANCH"
    git -C "$SPECHUB_INSTALL_DIR" pull --ff-only origin "$SPECHUB_BRANCH"
    return
  fi

  if test -e "$SPECHUB_INSTALL_DIR"; then
    fail "$SPECHUB_INSTALL_DIR already exists but is not a git checkout"
  fi

  log "Cloning SpecHub into $SPECHUB_INSTALL_DIR..."
  git clone --branch "$SPECHUB_BRANCH" "$SPECHUB_REPO" "$SPECHUB_INSTALL_DIR"
}

if is_spechub_checkout; then
  SPECHUB_DIR="$(pwd)"
  log "Installing SpecHub from current checkout: $SPECHUB_DIR"
else
  prepare_remote_checkout
  SPECHUB_DIR="$SPECHUB_INSTALL_DIR"
fi

need_cmd node
ensure_pnpm

cd "$SPECHUB_DIR"

log "Installing dependencies..."
pnpm install --frozen-lockfile

log "Building SpecHub..."
pnpm build

log "Linking spechub command..."
pnpm link --global

if command -v spechub >/dev/null 2>&1; then
  log "SpecHub installed."
  log "Run: spechub --open"
  exit 0
fi

PNPM_HOME="$(pnpm bin --global 2>/dev/null || true)"
fail "spechub was linked, but it is not on PATH. Add pnpm's global bin directory to PATH and rerun your shell. pnpm global bin: ${PNPM_HOME:-unknown}"
