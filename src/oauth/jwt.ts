import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Minimal HS256 JWT implementation — we use this for short-lived auth
 * codes and access tokens. Keeps OAuth state out of memory entirely so
 * cold starts on serverless don't break the flow.
 */

export interface JwtClaims {
  iss?: string;
  sub?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
  iat?: number;
  jti?: string;
  [key: string]: unknown;
}

function b64u(s: string | Buffer): string {
  return Buffer.isBuffer(s)
    ? s.toString("base64url")
    : Buffer.from(s, "utf8").toString("base64url");
}

function b64uDecode(s: string): string {
  return Buffer.from(s, "base64url").toString("utf8");
}

export function signJwt(
  payload: Record<string, unknown>,
  secret: string,
  opts: { ttlSec?: number } = {},
): string {
  const now = Math.floor(Date.now() / 1000);
  const claims: JwtClaims = {
    iat: now,
    jti: randomBytes(8).toString("hex"),
    ...payload,
    ...(opts.ttlSec !== undefined ? { exp: now + opts.ttlSec } : {}),
  };
  const header = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64u(JSON.stringify(claims));
  const sig = createHmac("sha256", secret).update(`${header}.${body}`).digest();
  return `${header}.${body}.${b64u(sig)}`;
}

export function verifyJwt<T = JwtClaims>(
  token: string,
  secret: string,
): T | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  if (!h || !p || !s) return null;
  const sig = Buffer.from(s, "base64url");
  const expected = createHmac("sha256", secret).update(`${h}.${p}`).digest();
  if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) return null;
  try {
    const claims = JSON.parse(b64uDecode(p)) as T & {
      exp?: number;
      nbf?: number;
    };
    const now = Math.floor(Date.now() / 1000);
    if (typeof claims.exp === "number" && now > claims.exp) return null;
    if (typeof claims.nbf === "number" && now < claims.nbf) return null;
    return claims;
  } catch {
    return null;
  }
}
