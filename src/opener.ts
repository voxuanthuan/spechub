import path from "node:path";
import open from "open";

export async function openBrowser(url: string): Promise<void> {
  const subprocess = await open(url);
  if (typeof subprocess.once === "function") {
    subprocess.once("error", (error: Error) => {
      console.warn(`Unable to open browser automatically: ${error.message}`);
      console.warn(`Open this URL manually: ${url}`);
    });
  }
}

export async function openLocalPath(filePath: string): Promise<void> {
  await open(path.resolve(filePath));
}
