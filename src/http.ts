import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { timingSafeEqual } from "node:crypto";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { handleMcpRequest } from "./mcp.js";
import { buildOAuthRouter, extractCredentialsFromBearer, getSigningSecret } from "./oauth/index.js";
import { buildWebhookRouter } from "./webhooks/receiver.js";

const JSON_MAX = "1mb";

function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function gateMcpAuth(req: Request, res: Response, next: NextFunction): void {
  if (!config.mcpGateToken) return next();

  const auth = req.header("authorization");
  const xMcp = req.header("x-mcp-auth");

  // Path 1: OAuth Bearer JWT issued by our /oauth/token endpoint. Any
  // valid access token grants /mcp access — credentials live inside
  // the token itself.
  if (auth && extractCredentialsFromBearer(auth)) {
    return next();
  }

  // Path 2: legacy shared bearer / X-MCP-Auth header equal to
  // MCP_GATE_TOKEN. Kept for non-browser MCP clients that can send
  // arbitrary headers.
  let provided: string | null = null;
  if (auth?.startsWith("Bearer ")) provided = auth.slice("Bearer ".length).trim();
  else if (xMcp) provided = xMcp.trim();
  if (provided && constantTimeEquals(provided, config.mcpGateToken)) {
    return next();
  }

  // Surface the OAuth metadata location so Claude can start a flow.
  const xfp = (req.headers["x-forwarded-proto"] as string | undefined)
    ?.split(",")[0]
    ?.trim();
  const origin = `${xfp || req.protocol}://${req.headers.host}`;
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
          "Unauthorized. Start OAuth at /.well-known/oauth-authorization-server, or send a valid MCP gate token.",
      },
      id: null,
    });
}

function originGate(req: Request, res: Response, next: NextFunction): void {
  if (config.allowedOrigins.length === 0 || config.allowedOrigins.includes("*")) {
    return next();
  }
  const origin = req.header("origin");
  // Same-origin (no Origin header), or whitelisted origin -> allow.
  if (!origin || config.allowedOrigins.includes(origin)) return next();

  res.status(403).json({
    jsonrpc: "2.0",
    error: { code: -32003, message: `Origin not allowed: ${origin}` },
    id: null,
  });
}

export function buildApp(): express.Express {
  const app = express();

  if (config.trustProxy) {
    app.set("trust proxy", 1);
  }

  app.use(
    helmet({
      contentSecurityPolicy: false, // not a browser app; CSP irrelevant
      crossOriginResourcePolicy: { policy: "same-site" },
    }),
  );

  const allowedOrigins = config.allowedOrigins;
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (allowedOrigins.length === 0 || allowedOrigins.includes("*"))
          return callback(null, true);
        if (allowedOrigins.includes(origin)) return callback(null, true);
        return callback(new Error("Not allowed by CORS"));
      },
      credentials: false,
      allowedHeaders: [
        "Content-Type",
        "Accept",
        "Authorization",
        "Mcp-Session-Id",
        "Mcp-Protocol-Version",
        "X-Kitchen-API-Key",
        "X-Kitchen-Workspace",
        "X-MCP-Auth",
      ],
      exposedHeaders: ["Mcp-Session-Id"],
      maxAge: 600,
    }),
  );

  app.use(
    pinoHttp({
      logger,
      // Don't log bodies — they may contain client data.
      serializers: {
        req: (req: any) => ({ method: req.method, url: req.url, id: req.id }),
        res: (res: any) => ({ statusCode: res.statusCode }),
      },
    }),
  );

  // IMPORTANT: mount the webhook router BEFORE express.json() so its
  // express.raw() parser captures the untouched bytes Kitchen signed.
  // The receiver has its own size cap.
  app.use("/webhooks", buildWebhookRouter());

  // OAuth router mounts its own body parsers per-route, so it can sit
  // before the global JSON parser too.
  app.use(buildOAuthRouter());

  app.use(express.json({ limit: JSON_MAX }));

  const limiter = rateLimit({
    windowMs: 60_000,
    limit: config.httpRateLimitPerMinute,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    // Skip rate-limiting on webhook deliveries — Kitchen retries on
    // failure and we don't want our edge to drop legitimate redelivery.
    // Also skip OAuth surface so login flows aren't accidentally
    // throttled per-IP.
    skip: (req) =>
      req.path.startsWith("/webhooks/") ||
      req.path.startsWith("/oauth/") ||
      req.path.startsWith("/.well-known/"),
    // Identify clients primarily by API key (workspace+token hash) when
    // available, falling back to IP. Use a fingerprint that doesn't leak
    // the raw key into limiter storage.
    keyGenerator: (req) => {
      const k = req.header("x-kitchen-api-key");
      const w = req.header("x-kitchen-workspace");
      if (k && w) {
        // 12 chars of the key combined with workspace is enough to discriminate.
        return `tenant:${w}:${k.slice(0, 12)}`;
      }
      return `ip:${req.ip ?? "unknown"}`;
    },
    message: {
      jsonrpc: "2.0",
      error: {
        code: -32005,
        message: "Too many requests. Slow down.",
      },
      id: null,
    },
  });
  app.use(limiter);

  app.get("/healthz", (_req, res) => {
    const enabledCategories: string[] = [];
    const allCategories = [
      "invoice",
      "folder",
      "file",
      "conversation",
      "board",
      "list",
      "task",
      "doc",
      "embed",
      "quote",
      "milestone",
      "client",
      "company",
    ];
    const hasShared = config.webhookSecrets.length > 0;
    for (const cat of allCategories) {
      const override = process.env[`KITCHEN_WEBHOOK_SECRETS_${cat.toUpperCase()}`];
      if ((override && override.trim().length > 0) || hasShared) {
        enabledCategories.push(cat);
      }
    }
    const oauthReady = Boolean(
      getSigningSecret() &&
        config.mcpGateToken &&
        config.fallbackKitchenApiKey &&
        config.fallbackKitchenWorkspace,
    );
    res.json({
      ok: true,
      service: "kitchen-mcp-server",
      version: "0.1.0",
      webhookReceiver: hasShared || enabledCategories.length > 0 ? "enabled" : "disabled",
      webhookCategoriesEnabled: enabledCategories,
      oauth: {
        ready: oauthReady,
        // Surface which prerequisites are missing without leaking values.
        missing: [
          !getSigningSecret() && "OAUTH_SIGNING_KEY (or MCP_GATE_TOKEN)",
          !config.mcpGateToken && "MCP_GATE_TOKEN (login password)",
          !config.fallbackKitchenApiKey && "KITCHEN_API_KEY",
          !config.fallbackKitchenWorkspace && "KITCHEN_WORKSPACE",
        ].filter(Boolean),
      },
    });
  });

  // MCP endpoint
  app.all("/mcp", originGate, gateMcpAuth, async (req, res) => {
    try {
      await handleMcpRequest(req, res);
    } catch (err) {
      logger.error({ err: String(err) }, "MCP handler crashed");
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  // Friendly root.
  app.get("/", (_req, res) => {
    res.json({
      name: "kitchen-mcp-server",
      transport: "streamable-http",
      endpoint: "/mcp",
      docs: "https://github.com/horatio8/kitchenmcp",
    });
  });

  // Fallback
  app.use((_req, res) => {
    res.status(404).json({
      jsonrpc: "2.0",
      error: { code: -32601, message: "Not found" },
      id: null,
    });
  });

  return app;
}
