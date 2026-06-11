import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { normalizeRoots, readConfigFile, resolveConfig, updateRoots } from "../src/config.js";

describe("resolveConfig", () => {
  it("keeps common agent sources when a legacy roots config is present", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "spechub-config-"));
    const configPath = path.join(root, "config.json");

    await writeFile(
      configPath,
      JSON.stringify(
        {
          roots: ["~/workspace"],
          docPatterns: ["docs/**/*.md"]
        },
        null,
        2
      )
    );

    const config = await resolveConfig({ configPath });

    expect(config.sources.map((source) => source.name)).toEqual([
      "repositories",
      "opencode",
      "opencode-plan-sessions",
      "codex",
      "claude",
      "cursor",
      "augment",
      "windsurf"
    ]);
    expect(config.sources[0].patterns).toEqual(expect.arrayContaining([
      "docs/**/*.md",
      "docs/superpowers/specs/**/*.{md,markdown,html}",
      "docs/supperpowers/specs/**/*.{md,markdown,html}"
    ]));
  });

  it("flags agent-storage scoping when roots are user-provided", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "spechub-config-scope-"));
    const configPath = path.join(root, "config.json");
    await writeFile(configPath, JSON.stringify({ roots: ["~/workspace/work"] }, null, 2));

    const fromFile = await resolveConfig({ configPath });
    expect(fromFile.restrictAgentStorageToRoots).toBe(true);

    const fromCli = await resolveConfig({ configPath, roots: ["~/workspace/work"] });
    expect(fromCli.restrictAgentStorageToRoots).toBe(true);
  });

  it("does not scope agent storage when relying on default roots", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "spechub-config-default-"));
    const configPath = path.join(root, "config.json");

    const config = await resolveConfig({ configPath });
    expect(config.restrictAgentStorageToRoots).toBe(false);
  });
});

describe("normalizeRoots", () => {
  it("trims, drops empty strings, and deduplicates with home expansion", () => {
    const result = normalizeRoots([
      "  ~/work  ",
      "~/work",
      "",
      "/var/projects",
      "/var/projects",
      "   "
    ]);
    expect(result).toEqual(["~/work", "/var/projects"]);
  });
});

describe("updateRoots", () => {
  it("writes normalized roots while preserving other config keys", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "spechub-update-roots-"));
    const configPath = path.join(root, "config.json");
    await writeFile(
      configPath,
      JSON.stringify(
        {
          roots: ["~/old"],
          titleOverrides: { "/abs/path/doc.md": "Renamed" }
        },
        null,
        2
      )
    );

    const stored = await updateRoots(configPath, ["~/new", "/var/projects", " ~/new "]);
    expect(stored).toEqual(["~/new", "/var/projects"]);

    const after = (await readConfigFile(configPath)) as {
      roots: string[];
      titleOverrides: Record<string, string>;
    };
    expect(after.roots).toEqual(["~/new", "/var/projects"]);
    expect(after.titleOverrides).toEqual({ "/abs/path/doc.md": "Renamed" });

    const raw = await readFile(configPath, "utf8");
    expect(raw.endsWith("\n")).toBe(true);
  });

  it("syncs roots into a repositories source when sources are explicit", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "spechub-update-roots-sources-"));
    const configPath = path.join(root, "config.json");
    await writeFile(
      configPath,
      JSON.stringify(
        {
          roots: ["~/old"],
          sources: [
            { name: "repositories", mode: "repositories", roots: ["~/old"], patterns: ["docs/**/*.md"] },
            { name: "claude", mode: "direct", roots: ["~/.claude"], patterns: ["plans/**/*.md"] }
          ]
        },
        null,
        2
      )
    );

    await updateRoots(configPath, ["~/new"]);
    const after = (await readConfigFile(configPath)) as {
      roots: string[];
      sources: Array<{ name: string; mode: string; roots: string[] }>;
    };
    expect(after.roots).toEqual(["~/new"]);
    expect(after.sources[0]).toMatchObject({ name: "repositories", roots: ["~/new"] });
    expect(after.sources[1]).toMatchObject({ name: "claude", roots: ["~/.claude"] });
  });

  it("rejects an empty roots list", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "spechub-update-roots-empty-"));
    const configPath = path.join(root, "config.json");
    await expect(updateRoots(configPath, ["   ", ""])).rejects.toThrow(/at least one workspace root/i);
  });

  it("creates the config file when missing", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "spechub-update-roots-create-"));
    const configPath = path.join(root, "nested", "config.json");
    await updateRoots(configPath, ["~/work"]);
    const after = (await readConfigFile(configPath)) as { roots: string[] };
    expect(after.roots).toEqual(["~/work"]);
  });
});
