import type { Request } from "express";
import { config } from "../config.js";
import { extractCredentialsFromBearer } from "../oauth/index.js";

export interface KitchenCredentials {
  apiKey: string;
  workspace: string;
}

const WORKSPACE_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,62}$/;

/**
 * Resolve Kitchen credentials for a request. Priority:
 *   1. OAuth Bearer JWT issued by our own /oauth/token endpoint
 *      (carries the workspace creds inside the access token).
 *   2. Per-request X-Kitchen-API-Key / X-Kitchen-Workspace headers
 *      (multi-tenant clients that supply their own creds).
 *   3. KITCHEN_API_KEY + KITCHEN_WORKSPACE env vars (single-tenant
 *      fallback).
 *
 * Returns null when nothing resolves to a usable pair.
 */
export function extractKitchenCredentials(
  req: Request,
): KitchenCredentials | null {
  const bearer = extractCredentialsFromBearer(req.header("authorization"));
  if (bearer) {
    if (!WORKSPACE_PATTERN.test(bearer.workspace)) return null;
    return bearer;
  }

  const headerKey = firstHeader(req, "x-kitchen-api-key");
  const headerWs = firstHeader(req, "x-kitchen-workspace");

  const apiKey = headerKey ?? config.fallbackKitchenApiKey;
  const workspace = headerWs ?? config.fallbackKitchenWorkspace;

  if (!apiKey || !workspace) return null;
  if (!WORKSPACE_PATTERN.test(workspace)) return null;

  return { apiKey, workspace };
}

function firstHeader(req: Request, name: string): string | null {
  const v = req.headers[name];
  if (Array.isArray(v)) return v[0]?.trim() || null;
  if (typeof v === "string") return v.trim() || null;
  return null;
}
