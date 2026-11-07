import { z } from "zod";
import type { ToolRegistry } from "./registry.js";
import { listEvents, readEvent, searchEvents, sinkEnabled } from "../webhooks/sink.js";

/**
 * Read access to the captured webhook events.
 *
 * Capturing them is only half the point — the reason to keep them is to
 * be able to answer "what did the client say, and about what". These
 * tools are that half.
 *
 * Particularly for file thread comments, which have no read API at all:
 * the captured payload is the only retrievable copy of a client's
 * comment on a piece of creative.
 */
export function registerEventTools(reg: ToolRegistry): void {
  reg.add({
    name: "kitchen_events_list",
    description:
      "List captured Kitchen webhook events, newest first. Every verified event is stored in full, which matters most for file thread comments — clients commenting on creative — because Kitchen has no API to read those back. Omit date to list across all days.",
    readOnly: true,
    inputSchema: {
      date: z
        .string()
        .optional()
        .describe("Restrict to one day, YYYY-MM-DD. Omit for all days."),
      limit: z.number().int().min(1).max(1000).optional(),
      cursor: z.string().optional().describe("Pagination cursor from a previous call."),
    },
    handler: async ({ date, limit, cursor }) => {
      if (!sinkEnabled()) {
        return {
          error: "no_sink_configured",
          message:
            "No webhook sink is attached, so nothing is being captured. Attach a Vercel Blob store to the project — it injects BLOB_READ_WRITE_TOKEN automatically — then redeploy.",
        };
      }
      return listEvents({ date, limit, cursor });
    },
  });

  reg.add({
    name: "kitchen_events_get",
    description:
      "Read one captured webhook event in full, including the complete payload Kitchen sent. Use the key from kitchen_events_list.",
    readOnly: true,
    inputSchema: {
      key: z
        .string()
        .describe("Event key, e.g. kitchen/2026-11-07/1794033900123-evt_abc.json"),
    },
    handler: async ({ key }) => {
      if (!sinkEnabled()) {
        return { error: "no_sink_configured", message: "No webhook sink is attached." };
      }
      const record = await readEvent(key);
      return record ?? { error: "not_found", key };
    },
  });

  reg.add({
    name: "kitchen_events_search",
    description:
      "Find captured webhook events by type, category, or text anywhere in the payload. This is how to answer 'what did the client comment on the flyer' — search contains:'flyer' or type:'file.thread.created'. Returns full payloads for matches.",
    readOnly: true,
    inputSchema: {
      date: z
        .string()
        .optional()
        .describe("Restrict to one day, YYYY-MM-DD. Omit to search recent events."),
      type: z
        .string()
        .optional()
        .describe(
          "Exact event type, e.g. 'file.thread.created', 'task.comment_created'.",
        ),
      category: z
        .string()
        .optional()
        .describe("Webhook category, e.g. 'file', 'task', 'conversation'."),
      contains: z
        .string()
        .optional()
        .describe("Case-insensitive text to find anywhere in the payload."),
      limit: z.number().int().min(1).max(100).optional(),
    },
    handler: async ({ date, type, category, contains, limit }) => {
      if (!sinkEnabled()) {
        return {
          error: "no_sink_configured",
          message:
            "No webhook sink is attached, so no events have been captured. Events arriving now are verified and discarded.",
        };
      }
      return searchEvents({ date, type, category, contains, limit });
    },
  });
}
