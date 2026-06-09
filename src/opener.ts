import path from "node:path";
import open, { apps } from "open";

export async function openBrowser(url: string): Promise<void> {
  try {
    await open(url, { app: { name: apps.chrome } });
  } catch {
    await open(url);
  }
}

export async function openLocalPath(filePath: string): Promise<void> {
  await open(path.resolve(filePath));
}
