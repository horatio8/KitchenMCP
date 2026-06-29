import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z, type ZodRawShape } from "zod";
import { callKitchen, KitchenApiError, type Method } from "../kitchen/client.js";
import type { KitchenCredentials } from "../kitchen/credentials.js";
import { logger } from "../logger.js";

export interface ToolContext {
  credentials: KitchenCredentials;
}

export type ToolHandler<Input> = (
  input: Input,
  ctx: ToolContext,
) => Promise<unknown>;

interface ToolDef<Shape extends ZodRawShape> {
  name: string;
  title?: string;
  description: string;
  inputSchema?: Shape;
  handler: ToolHandler<Shape extends ZodRawShape ? z.objectOutputType<Shape, z.ZodTypeAny> : unknown>;
  destructive?: boolean;
  readOnly?: boolean;
}

function toToolResult(value: unknown): CallToolResult {
  const text =
    typeof value === "string" ? value : JSON.stringify(value, null, 2) ?? "null";
  return { content: [{ type: "text", text }] };
}

function toErrorResult(err: unknown): CallToolResult {
  if (err instanceof KitchenApiError) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              error: "kitchen_api_error",
              status: err.status,
              message: err.message,
              body: err.body,
            },
            null,
            2,
          ),
        },
      ],
    };
  }
  const message = err instanceof Error ? err.message : String(err);
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ error: "tool_error", message }) }],
  };
}

export class ToolRegistry {
  private readonly tools: Array<(server: McpServer, ctxProvider: () => ToolContext) => void> = [];

  add<Shape extends ZodRawShape>(def: ToolDef<Shape>): void {
    this.tools.push((server, ctxProvider) => {
      server.registerTool(
        def.name,
        {
          title: def.title ?? def.name,
          description: def.description,
          inputSchema: def.inputSchema,
          annotations: {
            readOnlyHint: def.readOnly ?? false,
            destructiveHint: def.destructive ?? false,
            openWorldHint: true,
          },
        },
        (async (rawInput: any, _extra: any) => {
          try {
            const ctx = ctxProvider();
            const handler = def.handler as ToolHandler<unknown>;
            const result = await handler(rawInput, ctx);
            return toToolResult(result);
          } catch (err) {
            logger.warn({ tool: def.name, err: String(err) }, "tool error");
            return toErrorResult(err);
          }
        }) as any,
      );
    });
  }

  bind(server: McpServer, ctxProvider: () => ToolContext): void {
    for (const registerFn of this.tools) {
      registerFn(server, ctxProvider);
    }
  }

  /**
   * Convenience helper for registering a Kitchen API call as a tool.
   */
  addCall<Shape extends ZodRawShape>(
    def: Omit<ToolDef<Shape>, "handler"> & {
      method: Method;
      buildRequest: (
        input: Shape extends ZodRawShape ? z.objectOutputType<Shape, z.ZodTypeAny> : unknown,
      ) => { path: string; query?: Record<string, unknown>; body?: unknown };
    },
  ): void {
    this.add<Shape>({
      ...def,
      handler: async (input, ctx) => {
        const req = def.buildRequest(input);
        return callKitchen(ctx.credentials, {
          method: def.method,
          path: req.path,
          query: req.query,
          body: req.body,
        });
      },
    });
  }
}
