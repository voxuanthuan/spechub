import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveConfig } from "../src/config.js";

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
});
