/**
 * Jomish — Lightweight Server-side In-Memory Cache
 * Reduces repeated DB queries for rarely-changing data.
 * Entries auto-expire after TTL (default 5 minutes).
 */

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes
const store = new Map();

const cache = {
  get(key) {
    const entry = store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) { store.delete(key); return undefined; }
    return entry.value;
  },
  set(key, value, ttlMs = DEFAULT_TTL_MS, tags = []) {
    store.set(key, { value, expiresAt: Date.now() + ttlMs, tags });
  },
  del(key) { store.delete(key); },
  invalidateTag(tag) {
    for (const [key, entry] of store.entries()) {
      if (entry.tags && entry.tags.includes(tag)) store.delete(key);
    }
  },
  async getOrSet(key, loader, ttlMs = DEFAULT_TTL_MS, tags = []) {
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    const value = await loader();
    cache.set(key, value, ttlMs, tags);
    return value;
  },
};

module.exports = cache;
