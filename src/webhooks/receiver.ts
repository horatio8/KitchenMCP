import express, { type Request, type Response } from "express";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { EventDedupeStore } from "./dedup.js";
import { WebhookDispatcher, type KitchenWebhookEvent } from "./dispatcher.js";
import { verifyKitchenSignature } from "./verify.js";

const MAX_WEBHOOK_BYTES = 1 * 1024 * 1024; // 1 MiB cap on inbound webhook bodies

const dedupe = new EventDedupeStore();
const dispatcher = new WebhookDispatcher({
  forwardUrl: config.webhookForwardUrl,
  forwardToken: config.webhookForwardToken,
});

/**
 * Express router exposing POST /webhooks/kitchen.
 *
 * - Uses a raw body parser so signature verification operates on the
 *   exact bytes Kitchen signed.
 * - Constant-time HMAC-SHA256 comparison against any of the configured
 *   secrets (supports multiple workspaces / rotation).
 * - Idempotency: each event.id is processed at most once per 24h.
 * - Asynchronous dispatch: we ack Kitchen in <1s; user code runs after.
 */
export function buildWebhookRouter(): express.Router {
  const router = express.Router();

  router.post(
    "/kitchen",
    express.raw({
      type: ["application/json", "application/*+json", "text/json"],
      limit: MAX_WEBHOOK_BYTES,
    }),
    handleKitchenWebhook,
  );

  return router;
}

async function handleKitchenWebhook(req: Request, res: Response): Promise<void> {
  const secrets = config.webhookSecrets;
  if (secrets.length === 0) {
    logger.error("webhook received but KITCHEN_WEBHOOK_SECRETS is not set");
    res.status(503).json({ error: "webhook_receiver_not_configured" });
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
      { ip: req.ip, hasSig: Boolean(sigHeader) },
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
      { eventId: event.id, type: event.type },
      "kitchen webhook duplicate ignored",
    );
    // Still ack 200 so Kitchen stops retrying.
    res.status(200).json({ ok: true, duplicate: true });
    return;
  }

  // Ack first, then dispatch — per Kitchen's "handle events asynchronously"
  // best-practice. dispatch() itself does fire-and-forget for any heavy
  // downstream work (forwarding etc.).
  res.status(200).json({ ok: true });

  void dispatcher.dispatch(event).catch((err) => {
    logger.error(
      { eventId: event.id, type: event.type, err: String(err) },
      "kitchen webhook dispatch crashed",
    );
  });
}
