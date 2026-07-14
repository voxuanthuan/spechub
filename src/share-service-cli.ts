#!/usr/bin/env node
import { Command } from "commander";
import { startShareServer } from "./share-service.js";

interface ShareServerOptions {
  dataDir?: string;
  publicUrl?: string;
  host?: string;
  port?: number;
}

const program = new Command()
  .name("spechub-share")
  .description("Hosted snapshot service for public SpecHub review links")
  .option("--data-dir <path>", "persistent directory for shared documents")
  .option("--public-url <url>", "public origin used when generating share links")
  .option("--host <host>", "listen host", "127.0.0.1")
  .option("--port <port>", "listen port", (value) => Number.parseInt(value, 10), 8787)
  .action(async (options: ShareServerOptions) => {
    const { server, url } = await startShareServer(options);
    console.log(`SpecHub share service: ${url}`);

    const shutdown = () => {
      server.close(() => process.exit(0));
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });

await program.parseAsync(process.argv);
