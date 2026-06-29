/**
 * Kitchen's webhook UI groups event types into these categories. Each
 * category gets its own endpoint path so the user can register one
 * webhook per category in Kitchen and we know which one fired without
 * having to inspect event.type.
 *
 * Keep this list in sync with the picker shown at
 *   Kitchen → Settings → API & Webhooks → Webhooks → Events
 */
export const WEBHOOK_CATEGORIES = [
  "invoice",
  "folder",
  "file",
  "conversation",
  "board",
  "list",
  "task",
  "doc",
  "embed",
  "quote",
  "milestone",
  "client",
  "company",
] as const;

export type WebhookCategory = (typeof WEBHOOK_CATEGORIES)[number];

const CATEGORY_SET = new Set<string>(WEBHOOK_CATEGORIES);

export function isKnownCategory(value: string): value is WebhookCategory {
  return CATEGORY_SET.has(value);
}

/**
 * Per-category secret override env var name.
 * e.g. category "invoice" -> "KITCHEN_WEBHOOK_SECRETS_INVOICE"
 */
export function envVarForCategory(category: WebhookCategory): string {
  return `KITCHEN_WEBHOOK_SECRETS_${category.toUpperCase()}`;
}
