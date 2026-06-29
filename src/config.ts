import "dotenv/config";

function parseList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const config = {
  port: parseInteger(process.env.PORT, 3000),
  allowedOrigins: parseList(process.env.ALLOWED_ORIGINS),
  mcpGateToken: process.env.MCP_GATE_TOKEN?.trim() || null,
  fallbackKitchenApiKey: process.env.KITCHEN_API_KEY?.trim() || null,
  fallbackKitchenWorkspace: process.env.KITCHEN_WORKSPACE?.trim() || null,
  httpRateLimitPerMinute: parseInteger(
    process.env.HTTP_RATE_LIMIT_PER_MINUTE,
    120,
  ),
  trustProxy: process.env.TRUST_PROXY === "1" || process.env.TRUST_PROXY === "true",
  logLevel: process.env.LOG_LEVEL?.trim() || "info",

  // Webhook receiver
  webhookSecrets: parseList(process.env.KITCHEN_WEBHOOK_SECRETS),
  webhookForwardUrl: process.env.KITCHEN_WEBHOOK_FORWARD_URL?.trim() || null,
  webhookForwardToken: process.env.KITCHEN_WEBHOOK_FORWARD_TOKEN?.trim() || null,
} as const;

export type Config = typeof config;
