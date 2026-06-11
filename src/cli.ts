#!/usr/bin/env node
import { Command } from "commander";
import { DEFAULT_CONFIG_PATH, resolveConfig } from "./config.js";
import { openBrowser } from "./opener.js";
import { startServer } from "./server.js";
import { runUpdate } from "./update.js";

interface StartOptions {
  open?: boolean;
  roots?: string[];
  config?: string;
  port?: number;
}

async function startDashboard(options: StartOptions): Promise<void> {
  const config = await resolveConfig({
    configPath: options.config,
    roots: options.roots
  });
  const { server, url } = await startServer(
    {
      ...config,
      configPath: options.config ?? DEFAULT_CONFIG_PATH,
      explicitRoots: Boolean(options.roots?.length)
    },
    Number.isFinite(options.port) ? options.port : 0
  );

  console.log(`SpecHub is indexing ${config.roots.join(", ")}`);
  console.log(`SpecHub dashboard: ${url}`);

  if (options.open) {
    await openBrowser(url);
  }

  const shutdown = () => {
    server.close(() => process.exit(0));
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

const program = new Command()
  .name("spechub")
  .description("Local dashboard for AI-generated specs and plans")
  .option("--open", "open Chrome to the dashboard after starting")
  .option("--roots <paths...>", "repo roots or workspace folders to scan")
  .option("--config <path>", "config file path")
  .option("--port <port>", "preferred local port", (value) => Number.parseInt(value, 10))
  .action((options: StartOptions) => startDashboard(options));

program
  .command("update")
  .description("Pull the latest SpecHub, reinstall dependencies, and rebuild")
  .option("--branch <branch>", "git branch to update from (default: main)")
  .action(async (options: { branch?: string }) => {
    try {
      await runUpdate({ branch: options.branch });
    } catch (error) {
      console.error(`SpecHub update failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  });

await program.parseAsync(process.argv);
