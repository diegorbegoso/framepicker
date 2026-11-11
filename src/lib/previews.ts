import { useEffect, useSyncExternalStore } from "react";
import { preview as fetchPreview, type PreviewImage } from "./engine.ts";

/**
 * Sizes the interface asks the engine for. `keep` bounds how many of each stay in memory: they are
 * `data:` URLs (the CSP does not allow `blob:`), and a full-size one weighs several megabytes.
 */
export type Tier = "thumb" | "view" | "full" | "develop";

const TIERS: Record<Tier, { maxPx: number; develop: boolean; keep: number }> = {
  thumb: { maxPx: 320, develop: false, keep: 400 },
  view: { maxPx: 1600, develop: false, keep: 30 },
  full: { maxPx: 8192, develop: false, keep: 3 },
  develop: { maxPx: 8192, develop: true, keep: 2 },
};

export type Loader = (photoId: string, tier: Tier) => Promise<PreviewImage>;
export type PreviewStatus = "idle" | "loading" | "ready" | "error";

type Job = {
  key: string;
  photoId: string;
  tier: Tier;
  priority: number;
  seq: number;
  resolve: (image: PreviewImage) => void;
  reject: (reason: unknown) => void;
};

const keyOf = (photoId: string, tier: Tier) => `${tier}:${photoId}`;

/**
 * Loads previews through a small priority queue. The engine answers one request at a time, so a
 * burst of thumbnails must not delay the photo the person is looking at: lower `priority` runs first.
 */
export class PreviewStore {
  private ready: Record<Tier, Map<string, PreviewImage>> = this.emptyCaches();
  private inflight = new Map<string, Promise<PreviewImage>>();
  private waiting: Job[] = [];
  private failed = new Set<string>();
  private listeners = new Set<() => void>();
  private running = 0;
  private seq = 0;
  private version = 0;

  constructor(
    private load: Loader,
    private concurrency = 2,
    private limits: Partial<Record<Tier, number>> = {},
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = (): number => this.version;

  /** The image if it is already loaded. Reading it marks it as recently used. */
  peek(photoId: string, tier: Tier): PreviewImage | undefined {
    const cache = this.ready[tier];
    const key = keyOf(photoId, tier);
    const image = cache.get(key);
    if (image) {
      cache.delete(key);
      cache.set(key, image);
    }
    return image;
  }

  status(photoId: string, tier: Tier): PreviewStatus {
    const key = keyOf(photoId, tier);
    if (this.ready[tier].has(key)) return "ready";
    if (this.inflight.has(key)) return "loading";
    return this.failed.has(key) ? "error" : "idle";
  }

  request(photoId: string, tier: Tier, priority = 1): Promise<PreviewImage> {
    const key = keyOf(photoId, tier);
    const cached = this.peek(photoId, tier);
    if (cached) return Promise.resolve(cached);
    const pending = this.inflight.get(key);
    if (pending) {
      const queued = this.waiting.find((job) => job.key === key);
      if (queued && priority < queued.priority) queued.priority = priority;
      return pending;
    }
    this.failed.delete(key);
    const promise = new Promise<PreviewImage>((resolve, reject) => {
      this.waiting.push({ key, photoId, tier, priority, seq: this.seq++, resolve, reject });
    });
    this.inflight.set(key, promise);
    promise.catch(() => undefined);
    this.changed();
    this.pump();
    return promise;
  }

  /** Forgets a failure so the next request tries again. */
  retry(photoId: string, tier: Tier, priority = 0): Promise<PreviewImage> {
    this.failed.delete(keyOf(photoId, tier));
    return this.request(photoId, tier, priority);
  }

  /** Drops everything: used when the person leaves the review. */
  clear(): void {
    for (const job of this.waiting) job.reject(new Error("preview cache cleared"));
    this.waiting = [];
    this.inflight.clear();
    this.failed.clear();
    this.ready = this.emptyCaches();
    this.changed();
  }

  private emptyCaches(): Record<Tier, Map<string, PreviewImage>> {
    return { thumb: new Map(), view: new Map(), full: new Map(), develop: new Map() };
  }

  private pump(): void {
    while (this.running < this.concurrency && this.waiting.length > 0) {
      this.waiting.sort((a, b) => a.priority - b.priority || a.seq - b.seq);
      const job = this.waiting.shift();
      if (!job) return;
      this.running += 1;
      this.load(job.photoId, job.tier)
        .then((image) => this.finish(job, image))
        .catch((reason: unknown) => this.fail(job, reason))
        .finally(() => {
          this.running -= 1;
          this.pump();
        });
    }
  }

  private finish(job: Job, image: PreviewImage): void {
    if (this.inflight.get(job.key) !== undefined) {
      const cache = this.ready[job.tier];
      cache.set(job.key, image);
      const keep = this.limits[job.tier] ?? TIERS[job.tier].keep;
      while (cache.size > keep) {
        const oldest = cache.keys().next();
        if (oldest.done) break;
        cache.delete(oldest.value);
      }
    }
    this.inflight.delete(job.key);
    job.resolve(image);
    this.changed();
  }

  private fail(job: Job, reason: unknown): void {
    this.inflight.delete(job.key);
    this.failed.add(job.key);
    job.reject(reason);
    this.changed();
  }

  private changed(): void {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }
}

export const previews = new PreviewStore((photoId, tier) =>
  fetchPreview(photoId, { maxPx: TIERS[tier].maxPx, develop: TIERS[tier].develop }),
);

/** The preview of a photo at a size, loaded on demand; re-renders when it arrives. */
export function usePreview(photoId: string | undefined, tier: Tier, priority = 1) {
  useSyncExternalStore(previews.subscribe, previews.getVersion);
  useEffect(() => {
    if (photoId) void previews.request(photoId, tier, priority).catch(() => undefined);
  }, [photoId, tier, priority]);
  if (!photoId) return { image: undefined, status: "idle" as PreviewStatus };
  return { image: previews.peek(photoId, tier), status: previews.status(photoId, tier) };
}
