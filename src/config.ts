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

  // Workflow automation reacts to verified webhook events by posting
  // compliance reports and audit warnings onto the deliverable card.
  // Off by default: it writes to the workspace, so it must be opted in.
  workflowAutomation: /^(1|true|yes|on)$/i.test(
    process.env.WORKFLOW_AUTOMATION?.trim() ?? "",
  ),
} as const;

/**
 * Resolve the secret list for a given webhook category. Per-category
 * override env vars (e.g. KITCHEN_WEBHOOK_SECRETS_INVOICE) take
 * precedence over the shared KITCHEN_WEBHOOK_SECRETS list when present.
 */
export function secretsForCategory(category: string | null): string[] {
  if (category) {
    const override = process.env[`KITCHEN_WEBHOOK_SECRETS_${category.toUpperCase()}`];
    const list = parseList(override);
    if (list.length) return list;
  }
  return [...config.webhookSecrets];
}

export type Config = typeof config;
