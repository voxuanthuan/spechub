---
name: testing-spechub-dashboard
description: Test the SpecHub dashboard UI end-to-end locally. Use when verifying UI changes to the Next.js dashboard, modals, or document rendering.
---

# Testing SpecHub Dashboard

## Prerequisites

- Node 22+, pnpm 9+
- `pnpm install` completed

## Build & Run

1. Build the project (required — Next.js is static-export only):
   ```bash
   cd /home/ubuntu/repos/spechub
   pnpm build
   ```

2. Create test documents. SpecHub scans for repos with `.git` directories and looks for files matching `docs/**/*.{md,markdown,html}` by default:
   ```bash
   mkdir -p /home/ubuntu/test-docs/docs
   # Create markdown files in docs/ subdirectory
   cat > /home/ubuntu/test-docs/docs/sample.md << 'EOF'
   # Sample Document
   Test content with headings, code blocks, lists, etc.
   EOF
   cd /home/ubuntu/test-docs && git init
   ```

3. Start the server pointing at the test docs:
   ```bash
   cd /home/ubuntu/repos/spechub
   npx tsx src/cli.ts --roots /home/ubuntu/test-docs --port 3456
   ```

4. Verify the API returns documents:
   ```bash
   curl -s http://127.0.0.1:3456/api/docs | python3 -m json.tool
   ```

## Key UI Interactions

- **Select a document**: Click an item in the document list (left panel)
- **Full view modal**: Click "Full view" button (top-right of document view), or double-click the preview area
- **Close full view**: Press `Escape` or click the X button
- **Settings modal**: Click the gear icon in the sidebar header
- **Refresh index**: Click the refresh icon in the filter bar, or use `?refresh=1` query param

## Important Notes

- The Next.js app is **static-export only** — there are no Next API routes. All backend behavior is the Express server in `src/server.ts`.
- `pnpm dev:web` starts the Next.js dev server but it **won't have the backend API** — use the full CLI (`npx tsx src/cli.ts`) for end-to-end testing.
- Document scan requires the test directory to look like a repository (needs `.git`, `package.json`, or `docs/` subdirectory).
- The doc patterns default to `docs/**/*.{md,markdown,html}` — test files must be placed in a `docs/` subdirectory.
- To kill a running server on a port: `fuser -k <port>/tcp`

## Lint/Type/Test Commands

```bash
pnpm typecheck   # TypeScript type checking
pnpm test         # Run all Vitest tests
pnpm build        # Build Next.js static export + server
```

Always run `pnpm typecheck && pnpm test && pnpm build` before pushing changes.

## Devin Secrets Needed

None — SpecHub is a fully local tool with no external service dependencies.
