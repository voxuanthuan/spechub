import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();

describe("desktop integration", () => {
  it("configures Next.js for static export consumed by Tauri", async () => {
    const nextConfig = await readFile(path.join(root, "next.config.mjs"), "utf8");
    const tauriConfig = JSON.parse(await readFile(path.join(root, "src-tauri", "tauri.conf.json"), "utf8")) as {
      identifier?: string;
      build?: {
        beforeDevCommand?: string;
        beforeBuildCommand?: string;
        devUrl?: string;
        frontendDist?: string;
      };
      bundle?: {
        targets?: string[];
        icon?: string[];
      };
    };

    expect(nextConfig).toContain("output: \"export\"");
    expect(nextConfig).toContain("unoptimized: true");
    expect(tauriConfig.build).toMatchObject({
      beforeDevCommand: "pnpm dev:web",
      beforeBuildCommand: "pnpm build:web",
      devUrl: "http://localhost:3000",
      frontendDist: "../out"
    });
    expect(tauriConfig.identifier).not.toMatch(/\.app$/);
    expect(tauriConfig.bundle?.targets).toEqual(["deb", "rpm"]);
    expect(tauriConfig.bundle?.icon).toContain("icons/icon.png");
  });

  it("exposes package scripts for web fallback and desktop builds", async () => {
    const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    expect(pkg.scripts).toMatchObject({
      "dev:web": "next dev",
      "build:web": "next build",
      "dev:desktop": "tauri dev",
      "build:desktop": "tauri build"
    });
    expect(pkg.dependencies).toHaveProperty("next");
    expect(pkg.dependencies).toHaveProperty("react");
    expect(pkg.dependencies).toHaveProperty("react-dom");
    expect(pkg.devDependencies).toHaveProperty("@tauri-apps/cli");
  });

  it("defines Tauri commands for local document scanning and opening", async () => {
    const main = await readFile(path.join(root, "src-tauri", "src", "main.rs"), "utf8");

    expect(main).toContain("fn scan_documents");
    expect(main).toContain("fn get_document");
    expect(main).toContain("fn read_raw_document");
    expect(main).toContain("fn open_document_source");
    expect(main).toContain("fn open_document_folder");
    expect(main).toContain("fn update_document_title");
    expect(main).toContain("title_overrides");
    expect(main).toContain("sources");
    expect(main).toContain("generate_handler!");
  });

  it("uses cached scan results for desktop document actions", async () => {
    const main = await readFile(path.join(root, "src-tauri", "src", "main.rs"), "utf8");

    expect(main).toContain("struct AppState");
    expect(main).toContain("cached_docs");
    expect(main).toContain("fn find_cached_document");
    expect(main).toContain("tauri::State");
  });

  it("includes the app icon required by Tauri context generation", async () => {
    const icon = await stat(path.join(root, "src-tauri", "icons", "icon.png"));

    expect(icon.isFile()).toBe(true);
    expect(icon.size).toBeGreaterThan(0);
  });
});
