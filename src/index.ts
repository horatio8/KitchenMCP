import { config } from "./config.js";
import { buildApp } from "./http.js";
import { logger } from "./logger.js";

const app = buildApp();

const server = app.listen(config.port, () => {
  logger.info(
    { port: config.port, gated: Boolean(config.mcpGateToken) },
    "Kitchen MCP server listening",
  );
});

function shutdown(signal: string): void {
  logger.info({ signal }, "shutting down");
  server.close((err) => {
    if (err) {
      logger.error({ err: String(err) }, "shutdown error");
      process.exit(1);
    }
    process.exit(0);
  });
  // Hard exit after 10s
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("unhandledRejection", (reason) => {
  logger.error({ reason: String(reason) }, "unhandled rejection");
});
process.on("uncaughtException", (err) => {
  logger.error({ err: String(err) }, "uncaught exception");
});
