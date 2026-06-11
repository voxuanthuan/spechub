import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readStateFile, updateStateFile } from "../src/state.js";

async function fixturePath() {
  const root = await mkdtemp(path.join(tmpdir(), "spechub-state-"));
  return path.join(root, "state.json");
}

describe("state file", () => {
  it("returns empty defaults when the state file is missing or corrupt", async () => {
    const statePath = await fixturePath();
    await expect(readStateFile(statePath)).resolves.toEqual({
      favorites: [],
      tags: {},
      hiddenRepos: []
    });

    await writeFile(statePath, "{ not json");
    await expect(readStateFile(statePath)).resolves.toEqual({
      favorites: [],
      tags: {},
      hiddenRepos: []
    });
  });

  it("merges partial updates and writes normalized state with a trailing newline", async () => {
    const statePath = await fixturePath();
    await updateStateFile(statePath, {
      favorites: ["/repo/a.md", " /repo/a.md ", "/repo/b.md"],
      tags: {
        "/repo/a.md": ["api", " api ", ""]
      }
    });

    const updated = await updateStateFile(statePath, {
      hiddenRepos: ["core", " core ", ""],
      tags: {
        "/repo/b.md": ["plan"]
      }
    });

    expect(updated).toEqual({
      favorites: ["/repo/a.md", "/repo/b.md"],
      tags: {
        "/repo/b.md": ["plan"]
      },
      hiddenRepos: ["core"]
    });
    expect((await readFile(statePath, "utf8")).endsWith("\n")).toBe(true);
  });
});
