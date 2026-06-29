import { z } from "zod";
import type { ToolRegistry } from "./registry.js";
import { paginationShape, pickQuery } from "./common.js";

export function registerWebhookTools(reg: ToolRegistry): void {
  reg.addCall({
    name: "kitchen_list_webhooks",
    description: "List configured webhooks.",
    readOnly: true,
    method: "GET",
    inputSchema: { ...paginationShape },
    buildRequest: (input) => ({
      path: "/api/webhooks",
      query: pickQuery(input, ["page", "per_page"]),
    }),
  });

  reg.addCall({
    name: "kitchen_get_webhook",
    description: "Get a webhook by ID.",
    readOnly: true,
    method: "GET",
    inputSchema: { id: z.string() },
    buildRequest: ({ id }) => ({
      path: `/api/webhooks/${encodeURIComponent(id)}`,
    }),
  });

  reg.addCall({
    name: "kitchen_create_webhook",
    description: "Create a webhook subscription.",
    method: "POST",
    inputSchema: {
      url: z.string().url(),
      events: z.array(z.string()).min(1),
      description: z.string().optional(),
    },
    buildRequest: (input) => ({ path: "/api/webhooks", body: input }),
  });

  reg.addCall({
    name: "kitchen_update_webhook",
    description: "Update a webhook.",
    method: "PATCH",
    inputSchema: {
      id: z.string(),
      url: z.string().url().optional(),
      events: z.array(z.string()).optional(),
      description: z.string().optional(),
    },
    buildRequest: ({ id, ...rest }) => ({
      path: `/api/webhooks/${encodeURIComponent(id)}`,
      body: rest,
    }),
  });

  reg.addCall({
    name: "kitchen_delete_webhook",
    description: "Delete a webhook.",
    destructive: true,
    method: "DELETE",
    inputSchema: { id: z.string() },
    buildRequest: ({ id }) => ({ path: `/api/webhooks/${encodeURIComponent(id)}` }),
  });
}
