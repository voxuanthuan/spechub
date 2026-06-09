import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, readFile, stat } from "node:fs/promises";
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
    expect(script).toContain("SPECHUB_BIN_DIR");
    expect(script).toContain("ln -sf");
    expect(script).toContain("dist/src/cli.js");
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
