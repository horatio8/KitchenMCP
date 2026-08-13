import { request } from "undici";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { handleWorkflowEvent } from "../workflow/automation.js";

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

    // Workflow automation: observe, check, annotate. Fire-and-forget so
    // a slow Kitchen API call can never delay the webhook ack.
    if (config.workflowAutomation) {
      handleWorkflowEvent({
        id: event.id,
        type: event.type,
        created: event.created,
        data: (event.data ?? {}) as Record<string, unknown>,
      })
        .then((outcome) => {
          if (outcome.actions.length) {
            logger.info(
              { eventId: event.id, type: event.type, actions: outcome.actions },
              "workflow automation ran",
            );
          }
        })
        .catch((err) => {
          logger.warn(
            { eventId: event.id, type: event.type, err: String(err) },
            "workflow automation threw",
          );
        });
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
