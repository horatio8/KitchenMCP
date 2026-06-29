import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import type { KitchenCredentials } from "./kitchen/credentials.js";
import { extractKitchenCredentials } from "./kitchen/credentials.js";
import { logger } from "./logger.js";
import { buildToolRegistry } from "./tools/index.js";

interface Session {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  // Set per-request so tools resolve credentials from the latest call.
  currentCredentials: KitchenCredentials | null;
  lastUsed: number;
}

const SESSION_IDLE_MS = 30 * 60 * 1000; // 30 min idle TTL
const sessions = new Map<string, Session>();

function reapIdleSessions(): void {
  const cutoff = Date.now() - SESSION_IDLE_MS;
  for (const [id, session] of sessions) {
    if (session.lastUsed < cutoff) {
      logger.info({ sessionId: id }, "reaping idle MCP session");
      session.transport.close().catch(() => undefined);
      sessions.delete(id);
    }
  }
}

setInterval(reapIdleSessions, 60_000).unref();

function buildMcpServer(getCredentials: () => KitchenCredentials): McpServer {
  const server = new McpServer(
    { name: "kitchen-mcp-server", version: "0.1.0" },
    {
      capabilities: { tools: {}, logging: {} },
      instructions:
        "Tools for the Kitchen.co client-portal API. Credentials are supplied per HTTP request via headers (X-Kitchen-API-Key + X-Kitchen-Workspace) and never logged. Use kitchen_request as an escape hatch for endpoints without dedicated tools.",
    },
  );
  const registry = buildToolRegistry();
  registry.bind(server, () => ({ credentials: getCredentials() }));
  return server;
}

export async function handleMcpRequest(req: Request, res: Response): Promise<void> {
  const sessionId = req.header("mcp-session-id");
  const credentials = extractKitchenCredentials(req);

  // Initialize a new session.
  if (!sessionId && req.method === "POST" && isInitializeRequest(req.body)) {
    if (!credentials) {
      const xfp = (req.headers["x-forwarded-proto"] as string | undefined)
        ?.split(",")[0]
        ?.trim();
      const origin = `${xfp || req.protocol}://${req.headers.host}`;
      // Per RFC 9728: tell the client where to find OAuth metadata. Claude
      // picks this up and starts the auth flow automatically.
      res
        .status(401)
        .set(
          "WWW-Authenticate",
          `Bearer realm="mcp", resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
        )
        .json({
          jsonrpc: "2.0",
          error: {
            code: -32001,
            message:
              "Authentication required. OAuth metadata at /.well-known/oauth-authorization-server, or supply X-Kitchen-API-Key + X-Kitchen-Workspace headers.",
          },
          id: null,
        });
      return;
    }

    const newId = randomUUID();
    let session: Session;
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => newId,
      enableDnsRebindingProtection: true,
      // allowedHosts is checked by the SDK against the HTTP Host header.
      // Operators can override via the transport if they expose extra hostnames.
      onsessioninitialized: (id) => {
        logger.info({ sessionId: id }, "MCP session initialized");
      },
      onsessionclosed: (id) => {
        logger.info({ sessionId: id }, "MCP session closed");
        sessions.delete(id);
      },
    });

    session = {
      transport,
      server: buildMcpServer(() => {
        const current = sessions.get(newId)?.currentCredentials;
        if (!current) {
          throw new Error("Kitchen credentials missing on request");
        }
        return current;
      }),
      currentCredentials: credentials,
      lastUsed: Date.now(),
    };

    await session.server.connect(transport);
    sessions.set(newId, session);

    await transport.handleRequest(req, res, req.body);
    return;
  }

  if (!sessionId) {
    res.status(400).json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Missing mcp-session-id header. POST an initialize request first.",
      },
      id: null,
    });
    return;
  }

  const session = sessions.get(sessionId);
  if (!session) {
    res.status(404).json({
      jsonrpc: "2.0",
      error: { code: -32004, message: "Unknown session. Re-initialize." },
      id: null,
    });
    return;
  }

  // Per-call: refresh credentials from headers if provided. This makes the
  // transport stateless wrt auth — the client can rotate keys without
  // re-initializing.
  if (credentials) {
    session.currentCredentials = credentials;
  }
  session.lastUsed = Date.now();

  await session.transport.handleRequest(req, res, req.body);
}
