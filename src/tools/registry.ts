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

/**
 * A tool's declared HTTP contract, for tools registered with addCall.
 *
 * Exposed so the contract can be asserted in tests without issuing
 * requests. The Kitchen API's shape is not guessable — labels and
 * custom fields are board-scoped, subtasks and comments are nested
 * under their task, updates are PUT and never PATCH — and every one of
 * those was originally got wrong by assuming the obvious REST layout.
 * A test that reads these specs catches the next such slip at build
 * time instead of at the first 404 in production.
 */
export interface ToolSpec {
  name: string;
  method: Method;
  readOnly: boolean;
  destructive: boolean;
  /** Build the request the tool would issue for these arguments. */
  buildRequest: (input: any) => { path: string; query?: Record<string, unknown>; body?: unknown };
  /** The Zod shape, so a test can synthesise valid arguments. */
  inputSchema: ZodRawShape | undefined;
}

export class ToolRegistry {
  private readonly tools: Array<(server: McpServer, ctxProvider: () => ToolContext) => void> = [];
  private readonly specs: ToolSpec[] = [];

  /** Declared HTTP contracts for every addCall-registered tool. */
  describe(): readonly ToolSpec[] {
    return this.specs;
  }

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
    this.specs.push({
      name: def.name,
      method: def.method,
      readOnly: def.readOnly ?? false,
      destructive: def.destructive ?? false,
      buildRequest: def.buildRequest as ToolSpec["buildRequest"],
      inputSchema: def.inputSchema,
    });
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
