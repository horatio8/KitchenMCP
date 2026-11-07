import { request } from "undici";
import { logger } from "../logger.js";

/**
 * Log the body of each verified event, not just its id and type.
 *
 * Needed because parts of Kitchen have no read API — see the comment in
 * dispatch(). Writes client content to the host's logs, so it is opt-in
 * and should be turned off again once whatever you are chasing is
 * caught.
 */
const LOG_PAYLOAD = /^(1|true|yes|on)$/i.test(
  process.env.WEBHOOK_LOG_PAYLOAD?.trim() ?? "",
);
const PAYLOAD_LOG_LIMIT = 8 * 1024;

export interface KitchenWebhookEvent {
  id: string;
  type: string;
  created: number;
  data: unknown;
  previous_attributes?: unknown;
}

export interface DispatchOptions {
  /**
   * Optional downstream URL to POST verified events to. If your real
   * application logic lives elsewhere, set this so the receiver becomes
   * a thin verifying proxy.
   */
  forwardUrl?: string | null;
  /**
   * Optional shared secret added as `X-Forward-Token` when forwarding.
   * The downstream service should verify this in constant time.
   */
  forwardToken?: string | null;
}

export class WebhookDispatcher {
  constructor(private readonly opts: DispatchOptions) {}

  /**
   * Process a verified Kitchen event. Override / extend this for your
   * own integrations. Default behaviour: log + optional forward.
   *
   * Per Kitchen's best-practices, handlers should be fast and offload
   * heavy work to a queue. We perform forward POSTs asynchronously and
   * never block the original HTTP response on them.
   */
  async dispatch(
    event: KitchenWebhookEvent,
    category: string | null = null,
  ): Promise<void> {
    logger.info(
      { eventId: event.id, type: event.type, category, created: event.created },
      "kitchen webhook received",
    );

    // Some things Kitchen sends have no read API at all — file thread
    // comments are the main one: every /api/files/{id}/threads or
    // /comments route 404s and `expand` refuses them, so the webhook
    // payload is the only copy that exists outside the UI. Without the
    // payload in the log there is no way to recover what a client said
    // on a piece of creative.
    //
    // Off unless WEBHOOK_LOG_PAYLOAD is set, because this writes client
    // content into the host's logs, where it then sits for whatever the
    // retention period is.
    if (LOG_PAYLOAD) {
      const json = JSON.stringify(event.data ?? null);
      logger.info(
        {
          eventId: event.id,
          type: event.type,
          category,
          truncated: json.length > PAYLOAD_LOG_LIMIT,
          data: json.slice(0, PAYLOAD_LOG_LIMIT),
        },
        "kitchen webhook payload",
      );
    }

    if (this.opts.forwardUrl) {
      // Fire-and-forget; errors are logged but do not surface to Kitchen.
      this.forward(event, category).catch((err) => {
        logger.warn(
          { eventId: event.id, type: event.type, category, err: String(err) },
          "kitchen webhook forward failed",
        );
      });
    }
  }

  private async forward(
    event: KitchenWebhookEvent,
    category: string | null,
  ): Promise<void> {
    if (!this.opts.forwardUrl) return;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": "kitchen-mcp-server/0.1.0",
    };
    if (this.opts.forwardToken) {
      headers["X-Forward-Token"] = this.opts.forwardToken;
    }
    if (category) {
      headers["X-Kitchen-Category"] = category;
    }
    const res = await request(this.opts.forwardUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(event),
      headersTimeout: 10_000,
      bodyTimeout: 10_000,
    });
    // Drain to free the socket.
    await res.body.dump();
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new Error(`forward returned ${res.statusCode}`);
    }
  }
}
