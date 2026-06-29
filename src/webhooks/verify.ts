import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verify a Kitchen webhook signature.
 *
 * Per Kitchen's best-practices doc, the `Signature` header is:
 *   hash_hmac('sha256', <payload bytes>, <webhook secret>)
 * expressed as a lowercase hex string.
 *
 * We verify against the raw HTTP body as received — not a re-encoded
 * form — to avoid serialization drift between languages.
 *
 * Returns true iff `signature` matches an HMAC computed with any of the
 * supplied secrets. Comparison is constant-time. An empty `secrets`
 * array always returns false (fail-closed).
 */
export function verifyKitchenSignature(
  rawBody: Buffer | string,
  signature: string | undefined,
  secrets: readonly string[],
): boolean {
  if (!signature || secrets.length === 0) return false;

  const provided = signature.trim().toLowerCase();
  // Sig is hex; expect 64 chars for sha256.
  if (!/^[0-9a-f]{64}$/.test(provided)) return false;

  const body = typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : rawBody;
  const providedBuf = Buffer.from(provided, "hex");

  let match = false;
  for (const secret of secrets) {
    if (!secret) continue;
    const expected = createHmac("sha256", secret).update(body).digest();
    if (expected.length === providedBuf.length && timingSafeEqual(expected, providedBuf)) {
      match = true;
      // Don't short-circuit — keep work uniform across candidates to
      // avoid leaking which secret matched via timing.
    }
  }
  return match;
}
