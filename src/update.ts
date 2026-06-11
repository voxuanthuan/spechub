import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface UpdateOptions {
  branch?: string;
  installDir?: string;
}

function expandHome(input: string): string {
  if (input === "~") return os.homedir();
  if (input.startsWith("~/")) return path.join(os.homedir(), input.slice(2));
  return input;
}

function isSpecHubCheckout(dir: string): boolean {
  const packagePath = path.join(dir, "package.json");
  if (!existsSync(packagePath) || !existsSync(path.join(dir, "src"))) return false;
  try {
    return (JSON.parse(readFileSync(packagePath, "utf8")) as { name?: string }).name === "spechub";
  } catch {
    return false;
  }
}

function resolveInstallDir(explicit?: string): string {
  const fromEnv = explicit ?? process.env.SPECHUB_INSTALL_DIR;
  if (fromEnv) return path.resolve(expandHome(fromEnv));

  // Walk up from this module (dist/src/update.js or src/update.ts) to the repo root.
  let dir = path.dirname(fileURLToPath(import.meta.url));
  while (true) {
    if (isSpecHubCheckout(dir)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("Could not locate the SpecHub install directory. Set SPECHUB_INSTALL_DIR to override.");
}

function run(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
      // CI=true keeps pnpm non-interactive so it never aborts on a no-TTY purge prompt.
      env: { ...process.env, CI: "true" }
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

export async function runUpdate(options: UpdateOptions = {}): Promise<void> {
  const installDir = resolveInstallDir(options.installDir);
  const branch = options.branch ?? process.env.SPECHUB_BRANCH ?? "main";

  if (!existsSync(path.join(installDir, ".git"))) {
    throw new Error(
      `SpecHub at ${installDir} is not a git checkout, so it cannot self-update. Re-run the install script instead.`
    );
  }

  console.log(`Updating SpecHub in ${installDir} (branch ${branch})...`);
  await run("git", ["fetch", "origin", branch], installDir);
  await run("git", ["checkout", branch], installDir);
  await run("git", ["pull", "--ff-only", "origin", branch], installDir);

  console.log("Installing dependencies...");
  await run("pnpm", ["install", "--frozen-lockfile"], installDir);

  console.log("Building SpecHub...");
  await run("pnpm", ["build"], installDir);

  console.log("SpecHub updated. Restart any running `spechub` process to load the new build.");
}
