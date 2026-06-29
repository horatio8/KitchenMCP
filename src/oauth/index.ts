import { createHash, timingSafeEqual } from "node:crypto";
import express, { type Request, type Response } from "express";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { signJwt, verifyJwt } from "./jwt.js";

/**
 * Minimal but spec-compliant MCP OAuth 2.1 implementation.
 *
 * Provides:
 *   GET  /.well-known/oauth-authorization-server    (RFC 8414)
 *   GET  /.well-known/oauth-protected-resource      (RFC 9728)
 *   POST /oauth/register                            (RFC 7591 — DCR)
 *   GET  /oauth/authorize                            (RFC 6749 — shows login form)
 *   POST /oauth/authorize                            (consume login form -> code)
 *   POST /oauth/token                                (RFC 6749 — auth code + refresh)
 *   POST /oauth/revoke                               (RFC 7009)
 *
 * Stateless: every authorization code, refresh token and access token is
 * an HS256-signed JWT. No database, no Redis. Cold starts on Vercel are
 * a non-issue for the OAuth surface.
 *
 * Auth model:
 *   - The MCP server is single-tenant: one Kitchen workspace per
 *     deployment, configured via KITCHEN_API_KEY + KITCHEN_WORKSPACE.
 *   - Users gate access with a shared password (MCP_GATE_TOKEN). On
 *     successful login the issued access token carries those workspace
 *     credentials inside the JWT payload, so the MCP layer can fish
 *     them out without consulting env vars on every request.
 *   - The MCP_GATE_TOKEN also doubles as the JWT signing secret unless
 *     an explicit OAUTH_SIGNING_KEY is set.
 */

const ACCESS_TOKEN_TTL = 12 * 60 * 60;          // 12h
const REFRESH_TOKEN_TTL = 30 * 24 * 60 * 60;    // 30d
const AUTH_CODE_TTL = 90;                       // 90s
const AUTHORIZE_REQUEST_TTL = 5 * 60;           // 5m
const CLIENT_REGISTRATION_TTL = 365 * 24 * 60 * 60; // 1y

const SCOPES_SUPPORTED = ["mcp"] as const;
const DEFAULT_SCOPE = "mcp";

export interface AccessTokenClaims {
  kind: "access";
  client_id: string;
  scope: string;
  kitchen_api_key: string;
  kitchen_workspace: string;
}

interface ClientClaims {
  kind: "client";
  redirect_uris: string[];
  client_name?: string;
  token_endpoint_auth_method?: string;
}

interface AuthorizeRequestClaims {
  kind: "authorize_request";
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: "S256";
  scope: string;
  oauth_state?: string;
}

interface AuthorizationCodeClaims {
  kind: "code";
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: "S256";
  scope: string;
  kitchen_api_key: string;
  kitchen_workspace: string;
}

interface RefreshTokenClaims {
  kind: "refresh";
  client_id: string;
  scope: string;
  kitchen_api_key: string;
  kitchen_workspace: string;
}

export function getSigningSecret(): string | null {
  return process.env.OAUTH_SIGNING_KEY?.trim() || config.mcpGateToken || null;
}

function constantEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function originFor(req: Request): string {
  const xfp = (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0]?.trim();
  const proto = xfp || req.protocol;
  return `${proto}://${req.headers.host}`;
}

function htmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function loginHtml(stateToken: string, error?: string): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Kitchen MCP — sign in</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Inter", sans-serif; margin: 0; background: #fafafa; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
  .card { background: #fff; border: 1px solid #e5e7eb; border-radius: 14px; padding: 28px 28px 24px; width: min(380px, 92vw); box-shadow: 0 1px 3px rgba(0,0,0,.06); }
  h1 { font-size: 18px; margin: 0 0 4px; }
  p { color: #6b7280; font-size: 13px; margin: 0 0 18px; line-height: 1.5; }
  label { display: block; font-size: 12px; color: #374151; margin: 14px 0 6px; font-weight: 500; }
  input { width: 100%; box-sizing: border-box; padding: 9px 11px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 14px; outline: none; }
  input:focus { border-color: #6366f1; box-shadow: 0 0 0 3px rgba(99,102,241,.15); }
  button { margin-top: 18px; width: 100%; padding: 10px; background: #111; color: #fff; border: 0; border-radius: 8px; cursor: pointer; font-weight: 600; font-size: 14px; }
  button:hover { background: #000; }
  .err { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; border-radius: 8px; padding: 9px 11px; font-size: 13px; margin-bottom: 14px; }
  .meta { font-size: 11px; color: #9ca3af; margin-top: 18px; }
  code { background: #f3f4f6; padding: 1px 5px; border-radius: 4px; font-size: 11px; }
</style></head><body>
<form class="card" method="POST" action="/oauth/authorize">
  <h1>Kitchen MCP</h1>
  <p>Sign in to authorise Claude to call your Kitchen workspace via this MCP server.</p>
  ${error ? `<div class="err">${htmlEscape(error)}</div>` : ""}
  <input type="hidden" name="state" value="${htmlEscape(stateToken)}">
  <label for="password">Access password</label>
  <input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
  <button type="submit">Authorise</button>
  <p class="meta">The password is the <code>MCP_GATE_TOKEN</code> set by your admin in Vercel.</p>
</form></body></html>`;
}

function isAllowedRedirectUri(uri: string): boolean {
  try {
    const u = new URL(uri);
    if (u.protocol === "https:") return true;
    // Allow loopback for local dev as required by the OAuth 2.1 spec.
    if (u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1")) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function buildOAuthRouter(): express.Router {
  const router = express.Router();
  // OAuth endpoints exchange URL-encoded and JSON bodies; mount per-route
  // parsers so they don't collide with the webhook receiver's raw parser.
  const urlencoded = express.urlencoded({ extended: false, limit: "32kb" });
  const jsonParser = express.json({ limit: "32kb" });

  router.get("/.well-known/oauth-authorization-server", (req, res) => {
    const origin = originFor(req);
    res.json({
      issuer: origin,
      authorization_endpoint: `${origin}/oauth/authorize`,
      token_endpoint: `${origin}/oauth/token`,
      registration_endpoint: `${origin}/oauth/register`,
      revocation_endpoint: `${origin}/oauth/revoke`,
      response_types_supported: ["code"],
      response_modes_supported: ["query"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
      scopes_supported: [...SCOPES_SUPPORTED],
    });
  });

  router.get("/.well-known/oauth-protected-resource", (req, res) => {
    const origin = originFor(req);
    res.json({
      resource: origin,
      authorization_servers: [origin],
      scopes_supported: [...SCOPES_SUPPORTED],
      bearer_methods_supported: ["header"],
    });
  });

  // ---------------- Dynamic Client Registration (RFC 7591) ----------------
  router.post("/oauth/register", jsonParser, (req, res) => {
    const secret = getSigningSecret();
    if (!secret) {
      res.status(503).json({ error: "server_misconfigured" });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
    if (redirectUris.length === 0) {
      res.status(400).json({ error: "invalid_redirect_uri" });
      return;
    }
    for (const uri of redirectUris) {
      if (typeof uri !== "string" || !isAllowedRedirectUri(uri)) {
        res.status(400).json({
          error: "invalid_redirect_uri",
          error_description: `disallowed redirect_uri: ${String(uri)}`,
        });
        return;
      }
    }
    const clientName = typeof body.client_name === "string" ? body.client_name : undefined;
    const clientId = signJwt(
      {
        kind: "client",
        redirect_uris: redirectUris,
        client_name: clientName,
      } satisfies ClientClaims,
      secret,
      { ttlSec: CLIENT_REGISTRATION_TTL },
    );

    res.status(201).json({
      client_id: clientId,
      redirect_uris: redirectUris,
      client_name: clientName,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      application_type: "web",
    });
  });

  // ---------------- Authorize (GET) — render login form ----------------
  router.get("/oauth/authorize", (req, res) => {
    const secret = getSigningSecret();
    if (!secret || !config.mcpGateToken) {
      res.status(503).type("text/plain").send("OAuth not configured: set MCP_GATE_TOKEN");
      return;
    }
    const {
      client_id,
      redirect_uri,
      response_type,
      code_challenge,
      code_challenge_method,
      scope,
      state,
    } = req.query;

    if (typeof client_id !== "string" || typeof redirect_uri !== "string") {
      res.status(400).type("text/plain").send("invalid_request: missing client_id or redirect_uri");
      return;
    }
    if (response_type !== "code") {
      res.status(400).type("text/plain").send("unsupported_response_type");
      return;
    }
    if (typeof code_challenge !== "string" || code_challenge_method !== "S256") {
      res.status(400).type("text/plain").send("invalid_request: PKCE S256 required");
      return;
    }

    const client = verifyJwt<ClientClaims>(client_id, secret);
    if (!client || client.kind !== "client") {
      res.status(400).type("text/plain").send("invalid_client");
      return;
    }
    if (!client.redirect_uris.includes(redirect_uri)) {
      res.status(400).type("text/plain").send("invalid_redirect_uri");
      return;
    }

    const requestToken = signJwt(
      {
        kind: "authorize_request",
        client_id,
        redirect_uri,
        code_challenge,
        code_challenge_method: "S256",
        scope: typeof scope === "string" ? scope : DEFAULT_SCOPE,
        oauth_state: typeof state === "string" ? state : undefined,
      } satisfies AuthorizeRequestClaims,
      secret,
      { ttlSec: AUTHORIZE_REQUEST_TTL },
    );

    res
      .set("Content-Type", "text/html; charset=utf-8")
      .set("Cache-Control", "no-store")
      .send(loginHtml(requestToken));
  });

  // ---------------- Authorize (POST) — process login, issue code ----------------
  router.post("/oauth/authorize", urlencoded, (req, res) => {
    const secret = getSigningSecret();
    if (!secret || !config.mcpGateToken) {
      res.status(503).type("text/plain").send("OAuth not configured");
      return;
    }
    const body = req.body as { state?: string; password?: string };
    const { state, password } = body;
    if (typeof state !== "string" || typeof password !== "string") {
      res.status(400).type("text/plain").send("invalid_request");
      return;
    }
    const authReq = verifyJwt<AuthorizeRequestClaims>(state, secret);
    if (!authReq || authReq.kind !== "authorize_request") {
      res.status(400).type("text/plain").send("invalid_state");
      return;
    }
    if (!config.fallbackKitchenApiKey || !config.fallbackKitchenWorkspace) {
      res
        .status(503)
        .type("text/plain")
        .send("OAuth issuance requires KITCHEN_API_KEY and KITCHEN_WORKSPACE to be set on the server");
      return;
    }
    if (!constantEqual(password, config.mcpGateToken)) {
      logger.warn({ ip: req.ip }, "oauth login: bad password");
      res
        .status(401)
        .set("Content-Type", "text/html; charset=utf-8")
        .send(loginHtml(state, "Invalid password — try again."));
      return;
    }

    const code = signJwt(
      {
        kind: "code",
        client_id: authReq.client_id,
        redirect_uri: authReq.redirect_uri,
        code_challenge: authReq.code_challenge,
        code_challenge_method: "S256",
        scope: authReq.scope,
        kitchen_api_key: config.fallbackKitchenApiKey,
        kitchen_workspace: config.fallbackKitchenWorkspace,
      } satisfies AuthorizationCodeClaims,
      secret,
      { ttlSec: AUTH_CODE_TTL },
    );

    const redirect = new URL(authReq.redirect_uri);
    redirect.searchParams.set("code", code);
    if (authReq.oauth_state) redirect.searchParams.set("state", authReq.oauth_state);
    res.redirect(302, redirect.toString());
  });

  // ---------------- Token endpoint ----------------
  router.post("/oauth/token", urlencoded, (req, res) => {
    const secret = getSigningSecret();
    if (!secret) {
      res.status(503).json({ error: "server_misconfigured" });
      return;
    }
    const body = req.body as Record<string, string | undefined>;
    const grantType = body.grant_type;

    if (grantType === "authorization_code") {
      const { code, redirect_uri, client_id, code_verifier } = body;
      if (!code || !redirect_uri || !client_id || !code_verifier) {
        res.status(400).json({ error: "invalid_request" });
        return;
      }
      const codeClaims = verifyJwt<AuthorizationCodeClaims>(code, secret);
      if (!codeClaims || codeClaims.kind !== "code") {
        res.status(400).json({ error: "invalid_grant" });
        return;
      }
      if (codeClaims.client_id !== client_id || codeClaims.redirect_uri !== redirect_uri) {
        res.status(400).json({ error: "invalid_grant", error_description: "binding mismatch" });
        return;
      }
      const computed = createHash("sha256").update(code_verifier).digest("base64url");
      if (computed !== codeClaims.code_challenge) {
        res.status(400).json({ error: "invalid_grant", error_description: "pkce_mismatch" });
        return;
      }

      const access = signJwt(
        {
          kind: "access",
          client_id,
          scope: codeClaims.scope,
          kitchen_api_key: codeClaims.kitchen_api_key,
          kitchen_workspace: codeClaims.kitchen_workspace,
        } satisfies AccessTokenClaims,
        secret,
        { ttlSec: ACCESS_TOKEN_TTL },
      );
      const refresh = signJwt(
        {
          kind: "refresh",
          client_id,
          scope: codeClaims.scope,
          kitchen_api_key: codeClaims.kitchen_api_key,
          kitchen_workspace: codeClaims.kitchen_workspace,
        } satisfies RefreshTokenClaims,
        secret,
        { ttlSec: REFRESH_TOKEN_TTL },
      );
      res.set("Cache-Control", "no-store").json({
        access_token: access,
        token_type: "Bearer",
        expires_in: ACCESS_TOKEN_TTL,
        scope: codeClaims.scope,
        refresh_token: refresh,
      });
      return;
    }

    if (grantType === "refresh_token") {
      const { refresh_token, client_id } = body;
      if (!refresh_token) {
        res.status(400).json({ error: "invalid_request" });
        return;
      }
      const refClaims = verifyJwt<RefreshTokenClaims>(refresh_token, secret);
      if (!refClaims || refClaims.kind !== "refresh") {
        res.status(400).json({ error: "invalid_grant" });
        return;
      }
      if (client_id && client_id !== refClaims.client_id) {
        res.status(400).json({ error: "invalid_grant", error_description: "client mismatch" });
        return;
      }
      const access = signJwt(
        {
          kind: "access",
          client_id: refClaims.client_id,
          scope: refClaims.scope,
          kitchen_api_key: refClaims.kitchen_api_key,
          kitchen_workspace: refClaims.kitchen_workspace,
        } satisfies AccessTokenClaims,
        secret,
        { ttlSec: ACCESS_TOKEN_TTL },
      );
      res.set("Cache-Control", "no-store").json({
        access_token: access,
        token_type: "Bearer",
        expires_in: ACCESS_TOKEN_TTL,
        scope: refClaims.scope,
      });
      return;
    }

    res.status(400).json({ error: "unsupported_grant_type" });
  });

  // ---------------- Revoke (best-effort; tokens are stateless JWTs) ----------------
  router.post("/oauth/revoke", urlencoded, (_req, res) => {
    // RFC 7009 allows the server to do nothing and still return 200 — we
    // can't truly revoke stateless JWTs without a revocation list. ACK so
    // well-behaved clients are satisfied.
    res.status(200).end();
  });

  return router;
}

/**
 * Extract the Kitchen credentials from a Bearer JWT sent by an OAuth
 * client. Returns null if the header is absent, malformed, signed with
 * the wrong key, expired, or not an access token.
 */
export function extractCredentialsFromBearer(
  authHeader: string | undefined,
): { apiKey: string; workspace: string } | null {
  if (!authHeader) return null;
  const m = /^Bearer\s+(.+)$/i.exec(authHeader);
  if (!m) return null;
  const secret = getSigningSecret();
  if (!secret) return null;
  const claims = verifyJwt<AccessTokenClaims>(m[1].trim(), secret);
  if (!claims || claims.kind !== "access") return null;
  if (!claims.kitchen_api_key || !claims.kitchen_workspace) return null;
  return { apiKey: claims.kitchen_api_key, workspace: claims.kitchen_workspace };
}
