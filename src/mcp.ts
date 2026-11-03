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

/**
 * Whether to mint stateful MCP sessions.
 *
 * Off by default, and deliberately so. Sessions live in this process's
 * memory, which on a serverless host (Vercel, Lambda, Cloud Run with
 * scale-to-zero) is not the same memory the next request lands in. A
 * client that is handed an `Mcp-Session-Id` will send it back on every
 * subsequent call and get a 404 the moment it hits a cold instance —
 * which looks to the user like the connector randomly breaking.
 *
 * Nothing this server does needs session affinity: there are no
 * subscriptions, no sampling, no server-initiated messages. So the
 * honest default is stateless, where every request carries everything
 * needed to serve it.
 *
 * Set MCP_SESSIONS=1 only on a single long-lived process.
 */
const USE_SESSIONS = /^(1|true|yes|on)$/i.test(
  process.env.MCP_SESSIONS?.trim() ?? "",
);

/** Whether this process mints stateful MCP sessions. Surfaced on /healthz. */
export function mcpSessionsEnabled(): boolean {
  return USE_SESSIONS;
}

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

if (USE_SESSIONS) {
  setInterval(reapIdleSessions, 60_000).unref();
}

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

/**
 * The spec requires a POST to accept both `application/json` and
 * `text/event-stream`, and the SDK enforces it with a 406. Several real
 * clients — including ones that proxy MCP on the user's behalf — send
 * only `application/json`. We cannot patch their client, and refusing
 * them buys nothing: we are willing to answer in either format. So add
 * the missing media types rather than reject the request.
 */
function widenAccept(req: Request): void {
  const current = typeof req.headers.accept === "string" ? req.headers.accept : "";
  const missing = ["application/json", "text/event-stream"].filter(
    (media) => !current.includes(media),
  );
  if (!missing.length) return;

  const widened = [current, ...missing].filter(Boolean).join(", ");
  req.headers.accept = widened;

  // The SDK hands the request to @hono/node-server, which rebuilds the
  // header set from `rawHeaders`, not from the parsed `headers` object.
  // Fixing only the parsed view changes nothing the transport can see.
  const raw = req.rawHeaders;
  if (!Array.isArray(raw)) return;
  const next: string[] = [];
  let replaced = false;
  for (let i = 0; i < raw.length; i += 2) {
    const name = raw[i];
    if (name === undefined) break;
    if (name.toLowerCase() === "accept") {
      // Collapse any repeats into the single widened value.
      if (!replaced) {
        next.push(name, widened);
        replaced = true;
      }
      continue;
    }
    next.push(name, raw[i + 1] ?? "");
  }
  if (!replaced) next.push("Accept", widened);
  req.rawHeaders = next;
}

function unauthorized(req: Request, res: Response): void {
  const xfp = (req.headers["x-forwarded-proto"] as string | undefined)
    ?.split(",")[0]
    ?.trim();
  const origin = `${xfp || req.protocol}://${req.headers.host}`;
  // Per RFC 9728: tell the client where to find OAuth metadata. Clients
  // that support MCP auth pick this up and start the flow automatically.
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
}

/**
 * Serve one request with a throwaway server and transport.
 *
 * A stateless transport may handle exactly one request — reusing it
 * collides message ids between callers — so it is built, used and
 * discarded here. `enableJsonResponse` keeps the reply a plain JSON
 * body instead of a one-message SSE stream, which travels through
 * serverless hosts and intermediary proxies far more reliably.
 */
async function handleStateless(
  req: Request,
  res: Response,
  credentials: KitchenCredentials,
): Promise<void> {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  const server = buildMcpServer(() => credentials);

  let closed = false;
  const cleanup = (): void => {
    if (closed) return;
    closed = true;
    transport.close().catch(() => undefined);
    server.close().catch(() => undefined);
  };
  res.once("close", cleanup);

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    cleanup();
    throw err;
  }
}

export async function handleMcpRequest(req: Request, res: Response): Promise<void> {
  const sessionId = req.header("mcp-session-id");
  const credentials = extractKitchenCredentials(req);
  const session = sessionId ? sessions.get(sessionId) : undefined;

  // ---- Known session: the warm, stateful path. -----------------------
  if (session) {
    if (credentials) {
      // Refresh from headers so a client can rotate keys without
      // re-initializing.
      session.currentCredentials = credentials;
    }
    session.lastUsed = Date.now();
    if (req.method === "POST") widenAccept(req);
    await session.transport.handleRequest(req, res, req.body);
    return;
  }

  // ---- No session we hold. ------------------------------------------
  if (req.method === "DELETE") {
    // Nothing to tear down. Saying so is kinder than a 404 the client
    // then has to interpret.
    res.status(204).end();
    return;
  }

  if (req.method === "GET") {
    // The standalone SSE stream only means something for a session we
    // are holding open. Without one there is nothing to stream, and a
    // hanging connection on a serverless host is worse than a clear no.
    // The spec allows 405 for exactly this case.
    res.status(405).set("Allow", "POST, DELETE").json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "This endpoint does not offer a standalone SSE stream. POST instead.",
      },
      id: null,
    });
    return;
  }

  if (!credentials) {
    unauthorized(req, res);
    return;
  }

  widenAccept(req);

  // Mint a session only when explicitly enabled, and only for a real
  // initialize. Everything else is served statelessly — including a
  // request bearing a session id we no longer hold, which is what a
  // cold start or a redeploy looks like from the client's side. Falling
  // back here rather than 404ing is the difference between a connector
  // that keeps working and one that breaks after every deploy.
  if (USE_SESSIONS && !sessionId && isInitializeRequest(req.body)) {
    const newId = randomUUID();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => newId,
      enableDnsRebindingProtection: true,
      onsessioninitialized: (id) => {
        logger.info({ sessionId: id }, "MCP session initialized");
      },
      onsessionclosed: (id) => {
        logger.info({ sessionId: id }, "MCP session closed");
        sessions.delete(id);
      },
    });

    const created: Session = {
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

    await created.server.connect(transport);
    sessions.set(newId, created);
    await transport.handleRequest(req, res, req.body);
    return;
  }

  if (sessionId) {
    logger.info(
      { sessionId },
      "unknown MCP session id — serving statelessly",
    );
  }

  await handleStateless(req, res, credentials);
}
