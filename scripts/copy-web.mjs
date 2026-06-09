import { chmod, cp, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
await mkdir(join(root, "dist", "src"), { recursive: true });
await cp(join(root, "src", "web"), join(root, "dist", "src", "web"), {
  recursive: true
});
await chmod(join(root, "dist", "src", "cli.js"), 0o755);
