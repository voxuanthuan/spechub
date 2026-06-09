# SpecHub Shell Installer Design

## Context

SpecHub can already be started from a built clone with `./dist/src/cli.js --open`, and `package.json` already defines a `spechub` bin entry. That is awkward for new users because they need to clone the repo, know to build it, and run an implementation path instead of a product command.

The preferred user experience is a Claude Code-style shell installer:

```sh
curl -fsSL https://raw.githubusercontent.com/voxuanthuan/spechub/main/install.sh | sh
spechub --open
```

## Goals

- Make remote installation the primary documented path.
- Install from `voxuanthuan/spechub` into a stable local directory.
- Build the existing TypeScript and exported web dashboard assets.
- Expose `spechub` as a terminal command after installation.
- Keep local cloned-repo installation working for contributors.
- Keep the installer readable and auditable as a plain shell script.

## Non-Goals

- Do not publish to npm in this change.
- Do not create binary release artifacts in this change.
- Do not install the Tauri desktop app.
- Do not hide local-first behavior behind a hosted service.

## Installer Behavior

Add a root `install.sh`.

When run from curl, the script clones or updates the GitHub repository at:

```txt
https://github.com/voxuanthuan/spechub.git
```

The default install directory is:

```txt
~/.spechub
```

The script supports environment overrides for testing and advanced users:

```sh
SPECHUB_REPO=https://github.com/example/spechub.git SPECHUB_BRANCH=my-branch SPECHUB_INSTALL_DIR=/tmp/spechub ./install.sh
```

When run from inside a cloned SpecHub repository, the script installs from the current checkout instead of cloning into `~/.spechub`.

## Dependency Handling

The installer requires:

- `git`
- `node`
- `pnpm`

If `pnpm` is missing and `corepack` is available, the script enables pnpm through Corepack. If pnpm still is not available, the script prints a clear error and exits.

## Build and Link Flow

The installer runs:

```sh
pnpm install --frozen-lockfile
pnpm build
```

`pnpm build` already runs the web export and server TypeScript build, producing `dist/src/cli.js`. The existing `bin` mapping in `package.json` points `spechub` at that entry.

After building, the installer creates a symlink to the built CLI in a user-controlled bin directory (defaulting to `$HOME/.local/bin/spechub`, overridable with `SPECHUB_BIN_DIR`):

```sh
mkdir -p "$SPECHUB_BIN_DIR"
chmod +x "$SPECHUB_DIR/dist/src/cli.js"
ln -sf "$SPECHUB_DIR/dist/src/cli.js" "$SPECHUB_BIN_DIR/spechub"
```

The installer intentionally does not use `pnpm link --global`. That command depends on pnpm's global bin directory, which requires a one-time `pnpm setup` (or a `PNPM_HOME` environment variable) that is not configured by default on macOS Homebrew or Corepack installs, producing `ERR_PNPM_NO_GLOBAL_BIN_DIR`. The self-managed symlink works on any platform regardless of how pnpm was installed.

After linking, the script verifies that `spechub` is on `PATH`. If it is, the install is complete. If not, the script prints the exact `export PATH=...` line the user should add to `~/.zshrc` or `~/.bashrc`.

## README Changes

Update Quick Start to use the remote installer and `spechub --open`. Move clone/build instructions into a development section. Remove normal-user instructions that call `./dist/src/cli.js`.

## Error Handling

- Missing required commands produce actionable errors.
- Git clone/update failures stop the install.
- Build failures stop the install and keep the checkout for debugging.
- Existing `~/.spechub` checkouts are updated with `git fetch`, `git checkout`, and `git pull --ff-only`.
- If `pnpm build` does not produce `dist/src/cli.js`, the script fails before attempting to symlink.
- If the symlink succeeds but `$SPECHUB_BIN_DIR` is not on `PATH`, the script prints the exact `export PATH=...` line to add to the user's shell config and exits successfully (install is considered complete; only PATH wiring is left).

## Testing

Add or verify checks for:

- `pnpm build`
- `pnpm test`
- Local installer execution from the current clone
- `spechub --help` after linking

Remote curl behavior can be validated after `install.sh` is pushed to GitHub because raw GitHub URLs require the file to exist on the target branch.
