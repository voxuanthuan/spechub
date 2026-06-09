#!/usr/bin/env node
import { Command } from "commander";
import { DEFAULT_CONFIG_PATH, resolveConfig } from "./config.js";
import { openBrowser } from "./opener.js";
import { startServer } from "./server.js";

const program = new Command()
  .name("spechub")
  .description("Local dashboard for AI-generated specs and plans")
  .option("--open", "open Chrome to the dashboard after starting")
  .option("--roots <paths...>", "repo roots or workspace folders to scan")
  .option("--config <path>", "config file path")
  .option("--port <port>", "preferred local port", (value) => Number.parseInt(value, 10));

program.parse(process.argv);

const options = program.opts<{
  open?: boolean;
  roots?: string[];
  config?: string;
  port?: number;
}>();

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
