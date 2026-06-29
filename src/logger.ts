import pino from "pino";
import { config } from "./config.js";

export const logger = pino({
  level: config.logLevel,
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers['x-kitchen-api-key']",
      "req.headers['x-mcp-auth']",
      "req.headers.cookie",
      "headers.authorization",
      "headers['x-kitchen-api-key']",
      "headers['x-mcp-auth']",
      "kitchenApiKey",
      "apiKey",
      "token",
    ],
    censor: "[REDACTED]",
  },
});
