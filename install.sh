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

SPECHUB_BIN_DIR="${SPECHUB_BIN_DIR:-$HOME/.local/bin}"
SPECHUB_ENTRY="$SPECHUB_DIR/dist/src/cli.js"

if ! test -f "$SPECHUB_ENTRY"; then
  fail "build did not produce $SPECHUB_ENTRY"
fi

log "Installing spechub command to $SPECHUB_BIN_DIR/spechub..."
mkdir -p "$SPECHUB_BIN_DIR"
chmod +x "$SPECHUB_ENTRY"
ln -sf "$SPECHUB_ENTRY" "$SPECHUB_BIN_DIR/spechub"

if command -v spechub >/dev/null 2>&1; then
  log "SpecHub installed."
  log "Run: spechub --open"
  exit 0
fi

log "SpecHub installed to $SPECHUB_BIN_DIR/spechub."
log "Add this line to your shell config (~/.zshrc or ~/.bashrc) and reopen the terminal:"
log ""
log "  export PATH=\"$SPECHUB_BIN_DIR:\$PATH\""
log ""
log "Then run: spechub --open"
