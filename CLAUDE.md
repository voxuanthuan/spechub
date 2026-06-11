# Repository Guidelines

## Project Structure & Module Organization

SpecHub is a TypeScript/Node project with a Next.js dashboard and optional Tauri desktop shell.

- `src/`: CLI, Express server, scanner, config loading, Markdown rendering, OpenCode integration, and shared types.
- `app/`: Next.js browser dashboard UI and global styles.
- `src/web/`: legacy static dashboard assets served as a fallback.
- `src-tauri/`: Tauri desktop app wrapper and Rust entrypoint.
- `test/`: Vitest test files named `*.test.ts`.
- `docs/`: project plans/specs scanned by SpecHub itself.
- `install.sh`: shell installer for the `spechub` command.

## Build, Test, and Development Commands

Use `pnpm` for all Node workflows.

- `pnpm dev:web`: start the Next.js development server.
- `pnpm dev:desktop`: run the Tauri desktop app in development.
- `pnpm dev:browser`: build the web UI, then run the CLI with `--open`.
- `pnpm typecheck`: run TypeScript type checking without emitting files.
- `pnpm test`: run all Vitest tests.
- `pnpm test <file>` or `pnpm test -t "<name>"`: run a single test file or named test.
- `pnpm build`: build the static Next.js UI and server-side CLI output.
- `pnpm build:desktop`: build the Tauri desktop application.

## Architecture

Runtime flow: `src/cli.ts` parses flags → `resolveConfig` (`src/config.ts`) merges
`~/.config/spechub/config.json` with CLI roots → `startServer` (`src/server.ts`) boots an
Express app that **serves the static Next.js export from `out/`** and exposes a JSON API
(`/api/docs`, `/api/docs/:id`, `/raw/:id`, `/api/config`, `open-source`, `open-folder`).

`scanDocuments` (`src/scanner.ts`) is the core: it walks configured `sources` (modes
`repositories` | `direct` | `opencode-db`) via fast-glob and produces `DocumentMeta[]`.
OpenCode plan sessions are read from a sql.js SQLite DB in `src/opencode.ts`. Markdown is
rendered server-side and sanitized in `src/markdown.ts`; the data model lives in `src/types.ts`.

Two UIs exist: `app/` is the current Next.js dashboard (exported to `out/`); `src/web/` is a
legacy static fallback served at `/assets`. Prefer `app/` for UI changes.

## Gotchas

- **Next is static-export only** (`output: "export"` in `next.config.mjs`). No SSR, no Next API
  routes — all backend behavior is the Express server in `src/server.ts`.
- **ESM import suffixes**: source is `.ts` but imports use `.js` (e.g. `import { x } from "./config.js"`).
  Match this or `tsc`/runtime breaks.
- `pnpm build` runs `build:web` (Next export → `out/`) then `build:server` (tsc → `dist/`);
  `scripts/copy-web.mjs` copies `src/web/` into `dist/`. The server resolves `out/` relative to
  the module dir with fallbacks, so don't move `out/` independently.

## Coding Style & Naming Conventions

Write TypeScript as ES modules. Use two-space indentation, double quotes, semicolons, and explicit exported types where they clarify public contracts. Keep modules focused: scanner logic belongs in `src/scanner.ts`, HTTP behavior in `src/server.ts`, and source-specific integrations in dedicated files such as `src/opencode.ts`.

Prefer descriptive names like `scanDocuments`, `resolveConfig`, and `DocumentMeta`. Tests should describe behavior in plain language.

## Testing Guidelines

Vitest runs in the Node environment and loads `test/**/*.test.ts`. Add focused regression tests for scanner/config/server behavior when changing document discovery, routing, or rendering. For server routes, use `supertest`; for filesystem scanning, create temporary fixtures with `mkdtemp`.

Run `pnpm typecheck && pnpm test && pnpm build` before pushing changes.

## Commit & Pull Request Guidelines

Recent history uses concise Conventional Commit-style messages such as `feat: index opencode plan sessions`, `fix: avoid agent internal docs in default scans`, and `docs: add shell installer plan`.

PRs should include a short summary, verification commands, and screenshots for UI changes. Link related issues or user reports when available. Keep unrelated worktree changes out of the commit.

## Security & Configuration Tips

SpecHub scans local files and agent storage. Avoid logging document contents, secrets, or full database rows. User config lives at `~/.config/spechub/config.json`; preserve backward compatibility when changing defaults.
