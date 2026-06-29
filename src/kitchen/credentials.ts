import type { Request } from "express";
import { config } from "../config.js";

export interface KitchenCredentials {
  apiKey: string;
  workspace: string;
}

const WORKSPACE_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,62}$/;

/**
 * Pull Kitchen credentials from per-request headers. Falls back to env
 * defaults only when explicitly configured (single-tenant mode).
 *
 * Recognized headers (case-insensitive):
 *   X-Kitchen-API-Key   — Kitchen workspace bearer token
 *   X-Kitchen-Workspace — Workspace subdomain (e.g. "acme" -> acme.kitchen.co)
 */
export function extractKitchenCredentials(
  req: Request,
): KitchenCredentials | null {
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
