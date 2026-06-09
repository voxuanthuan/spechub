# SpecHub

SpecHub is a local browser dashboard for finding, reading, and organizing AI-generated specs, implementation plans, and HTML reports across your workspace.

It indexes local repositories and agent folders, groups documents by repository, renders Markdown safely, previews HTML in a sandboxed frame, and lets you open or copy the original file paths without moving your documents into a hosted service.

## What It Does

- Scans one or more local folders for Markdown and HTML documents.
- Detects document type such as `spec`, `plan`, `doc`, or `superpowers` from file paths.
- Groups documents by repository and supports direct global folders like `~/.claude/plans`.
- Provides browser filters for repository, document type, date, path, and search text.
- Renders Markdown with sanitized HTML and GitHub-flavored Markdown support.
- Previews HTML documents in a restricted iframe.
- Lets you copy file paths, open source files, open folders, and override display titles.

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

## Scan Specific Folders

By default, SpecHub scans common workspace locations. To choose folders explicitly:

```sh
spechub --roots ~/workspace ~/projects --open
```

## Configuration

SpecHub reads config from:

```txt
~/.config/spechub/config.json
```

Example:

```json
{
  "roots": ["~/workspace"],
  "ignorePatterns": [".git", "node_modules", "dist", "build", ".next", "coverage", "vendor"],
  "docPatterns": [
    "docs/**/*.{md,markdown,html}",
    "docs/superpowers/**/*.{md,html}",
    "docs/plans/**/*.md",
    "docs/specs/**/*.{md,html}",
    "specs/**/*.{md,html}",
    "Spec.md",
    "spec.md",
    "plan.md"
  ],
  "sources": [
    {
      "name": "repositories",
      "mode": "repositories",
      "roots": ["~/workspace"],
      "patterns": [
        "docs/**/*.{md,markdown,html}",
        "specs/**/*.{md,markdown,html}",
        "Spec.md",
        "spec.md",
        "plan.md"
      ]
    },
    {
      "name": "claude-plans",
      "mode": "direct",
      "roots": ["~/.claude/plans"],
      "patterns": ["*.md", "*.markdown"],
      "inferRepoFromContent": true,
      "defaultCategory": "plan"
    }
  ],
  "titleOverrides": {
    "~/workspace/my-repo/docs/specs/api.md": "API Redesign Spec"
  }
}
```

If `sources` is omitted, SpecHub uses the legacy `roots` and `docPatterns` repository scan behavior.

Use `mode: "repositories"` when each child folder is a project repository. Use `mode: "direct"` for global agent folders such as `~/.claude`, `~/.codex`, or shared notes folders.

`titleOverrides` only changes the display title in SpecHub. It does not edit the source Markdown or HTML file.

## How SpecHub Works

SpecHub has three main parts:

```txt
CLI command
  starts local Express server
  loads config and scans local files
  serves API routes and browser dashboard

Scanner
  walks configured roots
  ignores build/dependency folders
  classifies documents by path and extension
  returns document metadata

Browser UI
  fetches /api/docs
  filters and groups documents
  fetches /api/docs/:id for the selected file
  renders Markdown or sandboxed HTML preview
```

### Runtime Flow

1. `spechub --open` starts a local server on `127.0.0.1`.
2. The server resolves config from CLI flags and `~/.config/spechub/config.json`.
3. The scanner finds matching Markdown and HTML files.
4. The browser dashboard calls `/api/docs` to list documents.
5. Selecting a document calls `/api/docs/:id`.
6. Markdown is rendered and sanitized on the server. HTML is served through `/raw/:id` and previewed in a sandboxed iframe.

## Project Architecture

```txt
app/
  Next.js browser dashboard

src/
  cli.ts        command-line entrypoint
  server.ts     local Express app and API routes
  scanner.ts    document discovery and classification
  config.ts     config loading and title overrides
  markdown.ts   Markdown rendering and sanitization
  opener.ts     local file/folder open helpers

test/
  scanner, server, renderer, desktop, and UI behavior tests

src-tauri/
  optional desktop wrapper around the same exported browser UI
```

The browser dashboard is exported with Next.js into `out/`. The Express server serves that exported UI and provides the local API routes used by the dashboard.

## Browser Controls

- Search: title, repository, path, extension, and category text.
- Repository rail: limit the document list to one repository.
- Type: filter by `spec`, `plan`, `doc`, or `superpowers`.
- Date: show recently modified documents.
- Path: narrow results to a folder such as `docs/specs`.
- Refresh: rescan local files.
- Full view: open a larger reading modal.
- `/`: focus search.
- `F`: open full view for the selected document.
- `Esc`: close full view.

## Development

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

Run the browser dashboard during development:

```sh
pnpm dev:browser
```

Run the Next.js frontend only:

```sh
pnpm dev:web
```

Run checks:

```sh
pnpm typecheck
pnpm test
pnpm build
```

## Notes

SpecHub is local-first. It is designed for personal and team workstations where specs and plans already live in local repositories or agent output folders.

The desktop/Tauri app exists, but the browser dashboard is the primary supported flow for now.
