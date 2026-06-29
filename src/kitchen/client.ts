import { request } from "undici";
import { logger } from "../logger.js";
import type { KitchenCredentials } from "./credentials.js";

export class KitchenApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
    message: string,
  ) {
    super(message);
    this.name = "KitchenApiError";
  }
}

export type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export interface CallOptions {
  method: Method;
  path: string;
  query?: Record<string, unknown> | undefined;
  body?: unknown;
}

const USER_AGENT = "kitchen-mcp-server/0.1.0 (+https://github.com/horatio8/kitchenmcp)";
const MAX_RETRIES = 2;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024; // 2 MiB safety cap

function buildBaseUrl(workspace: string): string {
  return `https://${workspace}.kitchen.co`;
}

function encodeQuery(query: Record<string, unknown> | undefined): string {
  if (!query) return "";
  const parts: string[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item === undefined || item === null) continue;
        parts.push(`${encodeURIComponent(key)}[]=${encodeURIComponent(String(item))}`);
      }
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

async function readJsonOrText(body: any): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of body) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > MAX_RESPONSE_BYTES) {
      throw new KitchenApiError(
        502,
        null,
        `Kitchen response exceeded ${MAX_RESPONSE_BYTES} bytes`,
      );
    }
    chunks.push(buf);
  }
  if (!chunks.length) return null;
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function callKitchen(
  creds: KitchenCredentials,
  opts: CallOptions,
): Promise<unknown> {
  const url =
    buildBaseUrl(creds.workspace) +
    (opts.path.startsWith("/") ? opts.path : `/${opts.path}`) +
    encodeQuery(opts.query);

  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": USER_AGENT,
    Authorization: `Bearer ${creds.apiKey}`,
    "X-Requested-With": "XMLHttpRequest",
  };

  let payload: string | undefined;
  if (opts.body !== undefined && opts.method !== "GET" && opts.method !== "DELETE") {
    payload = JSON.stringify(opts.body);
    headers["Content-Type"] = "application/json";
  }

  let attempt = 0;
  // Retry only on 429 and 5xx, with jitter; cap total attempts to MAX_RETRIES + 1.
  while (true) {
    let res;
    try {
      res = await request(url, {
        method: opts.method,
        headers,
        body: payload,
        headersTimeout: 30_000,
        bodyTimeout: 30_000,
      });
    } catch (err) {
      if (attempt >= MAX_RETRIES) {
        throw new KitchenApiError(
          502,
          null,
          `Network error talking to Kitchen: ${(err as Error).message}`,
        );
      }
      const backoff = 200 * 2 ** attempt + Math.random() * 200;
      logger.warn({ url, attempt, err: String(err) }, "kitchen transport error, retrying");
      await sleep(backoff);
      attempt++;
      continue;
    }

    const status = res.statusCode;
    const retryable = status === 429 || (status >= 500 && status <= 599);

    if (retryable && attempt < MAX_RETRIES) {
      const retryAfterHeader = res.headers["retry-after"];
      const retryAfter = Array.isArray(retryAfterHeader)
        ? retryAfterHeader[0]
        : retryAfterHeader;
      const waitMs = retryAfter
        ? Math.min(15_000, Number.parseInt(String(retryAfter), 10) * 1000 || 0)
        : 0;
      const backoff = waitMs || 300 * 2 ** attempt + Math.random() * 300;
      // Drain body to free the socket.
      try {
        await res.body.dump();
      } catch {
        /* ignore */
      }
      logger.warn(
        { url, status, attempt, backoffMs: backoff },
        "kitchen retryable status, retrying",
      );
      await sleep(backoff);
      attempt++;
      continue;
    }

    const data = await readJsonOrText(res.body);
    if (status >= 200 && status < 300) {
      return data;
    }
    throw new KitchenApiError(
      status,
      data,
      `Kitchen API ${opts.method} ${opts.path} -> ${status}`,
    );
  }
}
