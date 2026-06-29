import { z } from "zod";
import { callKitchen } from "../kitchen/client.js";
import type { ToolRegistry } from "./registry.js";

const ALLOWED_PATH = /^\/api\/[a-zA-Z0-9\-_/.~%]+$/;

/**
 * A low-level escape hatch that lets clients call any Kitchen API endpoint
 * we haven't exposed via a dedicated tool. The path is constrained to
 * /api/* — no arbitrary host, no scheme override, no double-slash that
 * could be interpreted as a protocol-relative URL.
 */
export function registerRawTool(reg: ToolRegistry): void {
  reg.add({
    name: "kitchen_request",
    description:
      "Low-level passthrough to any Kitchen API endpoint. Use when no dedicated tool exists. The 'path' must start with /api/. See https://developer.kitchen.co for endpoint shapes.",
    inputSchema: {
      method: z.enum(["GET", "POST", "PATCH", "PUT", "DELETE"]),
      path: z
        .string()
        .min(1)
        .refine((p) => ALLOWED_PATH.test(p), {
          message: "Path must match /^\\/api\\/[a-zA-Z0-9\\-_/.~%]+$/",
        })
        .refine((p) => !p.includes("//"), {
          message: "Path may not contain '//'",
        }),
      query: z.record(z.unknown()).optional(),
      body: z.unknown().optional(),
    },
    handler: async (input, ctx) => {
      return callKitchen(ctx.credentials, {
        method: input.method,
        path: input.path,
        query: input.query as Record<string, unknown> | undefined,
        body: input.body,
      });
    },
  });
}
