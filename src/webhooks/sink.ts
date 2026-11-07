import { get, list, put } from "@vercel/blob";
import { logger } from "../logger.js";

/**
 * Durable capture of every verified Kitchen webhook event.
 *
 * Why this exists: parts of Kitchen have no read API. File thread
 * comments are the clearest case — /api/files/{id}/threads,
 * /api/files/{id}/comments and /api/file-threads all 404, and the file
 * object refuses to expand `threads`. So when a client comments on a
 * piece of creative, the webhook payload is the only copy of what they
 * said that exists outside the Kitchen UI. Before this, the receiver
 * verified that payload, logged its id and type, and dropped the body.
 *
 * Logs are not a substitute. They expire on the host's schedule, they
 * are searchable only as text, and the payload log truncates at 8 KiB.
 *
 * Storage is Vercel Blob, private access. One JSON object per event,
 * under a date prefix:
 *
 *   kitchen/2026-11-07/1794033900123-evt_c68457a659fe0eb1b45f0fb2.json
 *
 * The key is derived from the event id with no random suffix, so a
 * Kitchen retry of the same event writes the same key with the same
 * content. That makes capture idempotent across instances — which the
 * in-memory dedupe store cannot be on a serverless host, since each
 * invocation may land in different memory.
 *
 * Unconfigured is not an error: with no BLOB_READ_WRITE_TOKEN the sink
 * is a no-op, so local runs and un-provisioned deployments behave as
 * before rather than failing every delivery.
 */

const TOKEN = process.env.BLOB_READ_WRITE_TOKEN?.trim() || null;
const PREFIX = "kitchen";

/** Whether a store is attached. Surfaced on /healthz. */
export function sinkEnabled(): boolean {
  return TOKEN !== null;
}

export interface StoredEvent {
  event_id: string;
  event_type: string;
  category: string | null;
  /** When Kitchen says the event happened. */
  kitchen_created_at: string | null;
  /** When we received and verified it. */
  received_at: string;
  signature_verified: boolean;
  /** The complete event, exactly as Kitchen sent it. */
  payload: unknown;
}

function keyFor(eventId: string, receivedAt: Date): string {
  const day = receivedAt.toISOString().slice(0, 10);
  // Millisecond prefix keeps a day's keys in chronological order, since
  // Blob lists lexicographically.
  return `${PREFIX}/${day}/${receivedAt.getTime()}-${eventId}.json`;
}

/**
 * Persist one verified event. Never throws into the caller: losing a
 * capture must not turn into a failed delivery and a Kitchen retry
 * loop. Returns the key on success.
 */
export async function captureEvent(args: {
  eventId: string;
  eventType: string;
  category: string | null;
  created?: number | undefined;
  payload: unknown;
}): Promise<string | null> {
  if (!TOKEN) return null;

  const receivedAt = new Date();
  const key = keyFor(args.eventId, receivedAt);
  const record: StoredEvent = {
    event_id: args.eventId,
    event_type: args.eventType,
    category: args.category,
    kitchen_created_at:
      typeof args.created === "number"
        ? new Date(args.created * 1000).toISOString()
        : null,
    received_at: receivedAt.toISOString(),
    signature_verified: true,
    payload: args.payload,
  };

  try {
    await put(key, JSON.stringify(record, null, 2), {
      access: "private",
      token: TOKEN,
      contentType: "application/json",
      // Deterministic key + overwrite = a retried event rewrites the
      // same object with the same bytes, rather than duplicating.
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return key;
  } catch (err) {
    logger.error(
      { eventId: args.eventId, type: args.eventType, key, err: String(err) },
      "webhook sink write failed",
    );
    return null;
  }
}

export interface EventSummary {
  key: string;
  size: number;
  uploadedAt: string;
}

/** List captured event keys, newest-day-first when no date is given. */
export async function listEvents(args: {
  date?: string | undefined;
  limit?: number | undefined;
  cursor?: string | undefined;
}): Promise<{ events: EventSummary[]; cursor: string | null; hasMore: boolean }> {
  if (!TOKEN) throw new Error("No webhook sink configured (BLOB_READ_WRITE_TOKEN unset)");

  const prefix = args.date ? `${PREFIX}/${args.date}/` : `${PREFIX}/`;
  const res = await list({
    token: TOKEN,
    prefix,
    limit: args.limit ?? 100,
    ...(args.cursor ? { cursor: args.cursor } : {}),
  });

  return {
    events: res.blobs
      .map((b) => ({
        key: b.pathname,
        size: b.size,
        uploadedAt:
          b.uploadedAt instanceof Date ? b.uploadedAt.toISOString() : String(b.uploadedAt),
      }))
      // Newest first is what anyone asking "what just came in" wants.
      .sort((a, b) => b.key.localeCompare(a.key)),
    cursor: res.cursor ?? null,
    hasMore: res.hasMore,
  };
}

/** Read one captured event in full. */
export async function readEvent(key: string): Promise<StoredEvent | null> {
  if (!TOKEN) throw new Error("No webhook sink configured (BLOB_READ_WRITE_TOKEN unset)");

  const res = await get(key, { access: "private", token: TOKEN });
  if (!res || res.statusCode !== 200 || !res.stream) return null;

  const text = await new Response(res.stream).text();
  try {
    return JSON.parse(text) as StoredEvent;
  } catch {
    logger.warn({ key }, "captured event is not valid JSON");
    return null;
  }
}

/**
 * Scan captured events and return the ones that match.
 *
 * Blob has no query language, so this reads objects and filters in
 * process. At this workspace's volume — a few hundred events over
 * months — that is cheaper than running a database. `scanned` is
 * returned so a caller can tell "no matches" from "did not look far
 * enough".
 */
export async function searchEvents(args: {
  date?: string | undefined;
  type?: string | undefined;
  category?: string | undefined;
  contains?: string | undefined;
  limit?: number | undefined;
}): Promise<{ matches: StoredEvent[]; scanned: number; truncated: boolean }> {
  const scanLimit = Math.min(args.limit ?? 25, 100);
  // Read a generous window so filtering has something to work on, but
  // bounded so one call cannot walk the whole store.
  const { events, hasMore } = await listEvents({
    ...(args.date ? { date: args.date } : {}),
    limit: 200,
  });

  const needle = args.contains?.toLowerCase();
  const matches: StoredEvent[] = [];
  let scanned = 0;

  for (const summary of events) {
    if (matches.length >= scanLimit) break;
    const record = await readEvent(summary.key);
    scanned += 1;
    if (!record) continue;
    if (args.type && record.event_type !== args.type) continue;
    if (args.category && record.category !== args.category) continue;
    if (needle && !JSON.stringify(record.payload).toLowerCase().includes(needle)) {
      continue;
    }
    matches.push(record);
  }

  return { matches, scanned, truncated: hasMore || matches.length >= scanLimit };
}
