/**
 * Tiny LRU-with-TTL for webhook event idempotency.
 *
 * Kitchen retries failed deliveries up to 3 times; we keep event IDs
 * for 24h so retries find a hit even after a quiet period.
 */
export class EventDedupeStore {
  private readonly map = new Map<string, number>();
  private readonly max: number;
  private readonly ttlMs: number;

  constructor(opts: { max?: number; ttlMs?: number } = {}) {
    this.max = opts.max ?? 50_000;
    this.ttlMs = opts.ttlMs ?? 24 * 60 * 60 * 1000;
  }

  /** Returns true iff the id is new; records it. */
  recordIfNew(id: string): boolean {
    const now = Date.now();
    const existing = this.map.get(id);
    if (existing && existing > now) {
      // Refresh LRU order.
      this.map.delete(id);
      this.map.set(id, existing);
      return false;
    }
    this.map.set(id, now + this.ttlMs);
    this.evict(now);
    return true;
  }

  private evict(now: number): void {
    // Drop the oldest expired entries first, then enforce max size.
    if (this.map.size > this.max) {
      // Map iteration is insertion order; oldest first.
      const overflow = this.map.size - this.max;
      let dropped = 0;
      for (const key of this.map.keys()) {
        this.map.delete(key);
        if (++dropped >= overflow) break;
      }
    }
    // Lazy TTL sweep: only do a bounded amount of work per call.
    let scanned = 0;
    for (const [key, expiry] of this.map) {
      if (scanned++ > 50) break;
      if (expiry <= now) this.map.delete(key);
    }
  }
}
