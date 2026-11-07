import express, { type Request, type Response } from "express";
import { config, secretsForCategory } from "../config.js";
import { logger } from "../logger.js";
import {
  WEBHOOK_CATEGORIES,
  isKnownCategory,
  type WebhookCategory,
} from "./categories.js";
import { EventDedupeStore } from "./dedup.js";
import { WebhookDispatcher, type KitchenWebhookEvent } from "./dispatcher.js";
import { verifyKitchenSignature } from "./verify.js";

const MAX_WEBHOOK_BYTES = 1 * 1024 * 1024; // 1 MiB cap on inbound webhook bodies

/**
 * Whether to finish dispatching before acking Kitchen.
 *
 * True on a serverless host, where work started after the response is
 * not guaranteed to run. WEBHOOK_DISPATCH_BEFORE_ACK forces it either
 * way for hosts we do not detect.
 */
const DISPATCH_BEFORE_ACK = (() => {
  const override = process.env.WEBHOOK_DISPATCH_BEFORE_ACK?.trim();
  if (override) return /^(1|true|yes|on)$/i.test(override);
  return Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
})();

const dedupe = new EventDedupeStore();
const dispatcher = new WebhookDispatcher({
  forwardUrl: config.webhookForwardUrl,
  forwardToken: config.webhookForwardToken,
});

const rawJsonParser = express.raw({
  type: ["application/json", "application/*+json", "text/json"],
  limit: MAX_WEBHOOK_BYTES,
});

/**
 * Express router for Kitchen webhook ingress.
 *
 *   POST /webhooks/kitchen                — catch-all, no category tag
 *   POST /webhooks/kitchen/:category      — one endpoint per Kitchen
 *                                            event category. Lets you
 *                                            register one webhook per
 *                                            category in Kitchen and
 *                                            route downstream by URL.
 *
 * - Uses a raw body parser so signature verification operates on the
 *   exact bytes Kitchen signed.
 * - Constant-time HMAC-SHA256 comparison. Secrets resolved from the
 *   per-category env var (e.g. KITCHEN_WEBHOOK_SECRETS_INVOICE) when
 *   present, otherwise the shared KITCHEN_WEBHOOK_SECRETS list.
 * - Idempotency: each event.id is processed at most once per 24h.
 * - Asynchronous dispatch: we ack Kitchen in <1s; user code runs after.
 */
/** Whether dispatch is awaited before acking. Surfaced on /healthz. */
export function webhookDispatchBeforeAck(): boolean {
  return DISPATCH_BEFORE_ACK;
}

export function buildWebhookRouter(): express.Router {
  const router = express.Router();

  // Catch-all (legacy / single-webhook deployments)
  router.post("/kitchen", rawJsonParser, (req, res) =>
    handleKitchenWebhook(req, res, null),
  );

  // One route per category — keeps the URL shape obvious to operators
  // and rejects unknown categories with 404 (rather than forwarding any
  // path the caller invents).
  for (const category of WEBHOOK_CATEGORIES) {
    router.post(`/kitchen/${category}`, rawJsonParser, (req, res) =>
      handleKitchenWebhook(req, res, category),
    );
  }

  return router;
}

async function handleKitchenWebhook(
  req: Request,
  res: Response,
  category: WebhookCategory | null,
): Promise<void> {
  if (category && !isKnownCategory(category)) {
    res.status(404).json({ error: "unknown_category" });
    return;
  }

  const secrets = secretsForCategory(category);
  if (secrets.length === 0) {
    logger.error(
      { category },
      "webhook received but no secrets are configured for this category",
    );
    res.status(503).json({ error: "webhook_receiver_not_configured", category });
    return;
  }

  // express.raw → req.body is Buffer
  const raw: Buffer | undefined = Buffer.isBuffer(req.body) ? req.body : undefined;
  if (!raw || raw.length === 0) {
    res.status(400).json({ error: "empty_body" });
    return;
  }

  const sigHeader = req.header("signature") ?? req.header("Signature");
  const ok = verifyKitchenSignature(raw, sigHeader, secrets);
  if (!ok) {
    logger.warn(
      { ip: req.ip, category, hasSig: Boolean(sigHeader) },
      "kitchen webhook signature mismatch",
    );
    res.status(401).json({ error: "invalid_signature" });
    return;
  }

  let event: KitchenWebhookEvent;
  try {
    event = JSON.parse(raw.toString("utf8")) as KitchenWebhookEvent;
  } catch {
    res.status(400).json({ error: "invalid_json" });
    return;
  }

  if (
    !event ||
    typeof event.id !== "string" ||
    typeof event.type !== "string"
  ) {
    res.status(400).json({ error: "invalid_event_shape" });
    return;
  }

  const fresh = dedupe.recordIfNew(event.id);
  if (!fresh) {
    logger.info(
      { eventId: event.id, type: event.type, category },
      "kitchen webhook duplicate ignored",
    );
    // Still ack 200 so Kitchen stops retrying.
    res.status(200).json({ ok: true, duplicate: true });
    return;
  }

  // Kitchen's best practice is to ack fast and work afterwards, which is
  // right for a long-lived process. On a serverless host it is wrong:
  // once the response is sent the instance can be frozen immediately,
  // so anything started after it may simply never run. That failure is
  // silent — the delivery shows as a success in Kitchen and nothing
  // happened. So on serverless we finish the work first and ack after.
  //
  // The cost is latency on the ack. Kitchen retries on timeout, and
  // because the dedupe store is also per-instance memory, a retry can
  // re-run the handler and repeat a comment. Noise, not damage, and
  // preferable to dropping every event.
  if (DISPATCH_BEFORE_ACK) {
    try {
      await dispatcher.dispatch(event, category);
    } catch (err) {
      logger.error(
        { eventId: event.id, type: event.type, category, err: String(err) },
        "kitchen webhook dispatch failed",
      );
    }
    res.status(200).json({ ok: true });
    return;
  }

  res.status(200).json({ ok: true });

  void dispatcher.dispatch(event, category).catch((err) => {
    logger.error(
      { eventId: event.id, type: event.type, category, err: String(err) },
      "kitchen webhook dispatch crashed",
    );
  });
}
