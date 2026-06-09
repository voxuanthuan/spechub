# SpecHub Shell Installer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Claude Code-style installer so users can run `curl -fsSL https://raw.githubusercontent.com/voxuanthuan/spechub/main/install.sh | sh` and then start SpecHub with `spechub --open`.

**Architecture:** The installer is a POSIX-compatible root `install.sh` that either installs from the current clone or clones/updates `voxuanthuan/spechub` into `~/.spechub`. It uses the existing `pnpm build` and `bin.spechub` mapping, then verifies that the linked command is available on `PATH`.

**Tech Stack:** POSIX shell, Git, Node.js, pnpm/Corepack, Vitest, existing TypeScript/Next build.

---

## File Structure

- Create `install.sh`: installer entrypoint for remote curl and local cloned-repo installs.
- Create `test/installer.test.ts`: contract tests for script presence, shell syntax, expected clone/build/link behavior, and README command.
- Modify `README.md`: document curl install as Quick Start and move direct clone/build commands to Development.

### Task 1: Installer Contract Test

**Files:**
- Create: `test/installer.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/installer.test.ts` with:

```ts
import { access, readFile, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

describe("installer", () => {
  test("install.sh is executable POSIX shell", async () => {
    await access("install.sh", constants.X_OK);
    const info = await stat("install.sh");

    expect(info.isFile()).toBe(true);
    await expect(execFileAsync("sh", ["-n", "install.sh"])).resolves.toBeDefined();
  });

  test("install.sh documents the remote repository build and link flow", async () => {
    const script = await readFile("install.sh", "utf8");

    expect(script).toContain("https://github.com/voxuanthuan/spechub.git");
    expect(script).toContain("SPECHUB_INSTALL_DIR");
    expect(script).toContain("SPECHUB_BRANCH");
    expect(script).toContain("pnpm install --frozen-lockfile");
    expect(script).toContain("pnpm build");
    expect(script).toContain("pnpm link --global");
    expect(script).toContain("spechub --open");
  });

  test("README promotes curl install and spechub command instead of dist path", async () => {
    const readme = await readFile("README.md", "utf8");

    expect(readme).toContain("curl -fsSL https://raw.githubusercontent.com/voxuanthuan/spechub/main/install.sh | sh");
    expect(readme).toContain("spechub --open");
    expect(readme).not.toContain("./dist/src/cli.js --open");
    expect(readme).not.toContain("./dist/src/cli.js --roots");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```sh
pnpm vitest run test/installer.test.ts
```

Expected: FAIL because `install.sh` does not exist and the README still contains `./dist/src/cli.js`.

### Task 2: Installer Script

**Files:**
- Create: `install.sh`

- [ ] **Step 1: Write the installer**

Create `install.sh` with:

```sh
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
```

- [ ] **Step 2: Make it executable**

Run:

```sh
chmod +x install.sh
```

Expected: `install.sh` is executable.

- [ ] **Step 3: Run focused test**

Run:

```sh
pnpm vitest run test/installer.test.ts
```

Expected: README assertion still FAILS until Task 3 updates docs.

### Task 3: README Install UX

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update Quick Start**

Replace the current Quick Start build-and-dist commands with:

```md
## Quick Start: Browser Dashboard

Install SpecHub:

```sh
curl -fsSL https://raw.githubusercontent.com/voxuanthuan/spechub/main/install.sh | sh
```

Open SpecHub in your browser:

```sh
spechub --open
```

The command prints a local URL such as:

```txt
SpecHub dashboard: http://127.0.0.1:43210
```

SpecHub only serves a local dashboard from your machine. Your documents stay on disk.
```

- [ ] **Step 2: Update scan folder command**

Change:

```sh
./dist/src/cli.js --roots ~/workspace ~/projects --open
```

to:

```sh
spechub --roots ~/workspace ~/projects --open
```

Remove the follow-up paragraph that says "After linking or installing the package".

- [ ] **Step 3: Keep contributor commands in Development**

Add this under `## Development`:

```md
Install from a cloned checkout:

```sh
pnpm install
pnpm build
pnpm link --global
spechub --open
```

You can also run the installer from the checkout:

```sh
./install.sh
```
```

- [ ] **Step 4: Run focused test**

Run:

```sh
pnpm vitest run test/installer.test.ts
```

Expected: PASS.

### Task 4: Verification

**Files:**
- Verify: `install.sh`
- Verify: `README.md`
- Verify: `test/installer.test.ts`

- [ ] **Step 1: Run installer syntax check**

Run:

```sh
sh -n install.sh
```

Expected: exit 0.

- [ ] **Step 2: Run focused installer test**

Run:

```sh
pnpm vitest run test/installer.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run full test suite**

Run:

```sh
pnpm test
```

Expected: PASS.

- [ ] **Step 4: Run build**

Run:

```sh
pnpm build
```

Expected: PASS.

- [ ] **Step 5: Verify CLI help through direct built entrypoint**

Run:

```sh
node dist/src/cli.js --help
```

Expected: command help includes `Usage: spechub [options]`.

- [ ] **Step 6: Verify local installer if safe**

Run:

```sh
./install.sh
```

Expected: dependencies install, build succeeds, and global link either makes `spechub` available or prints a PATH-specific error. If PATH is the only blocker, report that explicitly.
