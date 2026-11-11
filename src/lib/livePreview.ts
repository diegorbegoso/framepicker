import { useSyncExternalStore } from "react";
import { type Adjustments, type PreviewImage, preview } from "./engine.ts";

/** Smaller than the normal view: a frame has to come back fast enough to follow the slider. */
const LIVE_PX = 1000;

export type LiveLoader = (photoId: string, adjustments: Adjustments) => Promise<PreviewImage>;

/**
 * The photo as it would look with a correction that is still being dragged, before anything is saved.
 *
 * Only one request is in flight per photo. While it runs, newer values only replace the one waiting,
 * so the screen follows the slider at the speed the engine can draw instead of queueing every step.
 */
export class LivePreviewStore {
  private frames = new Map<string, PreviewImage>();
  private waiting = new Map<string, Adjustments>();
  private flying = new Set<string>();
  private epochs = new Map<string, number>();
  private listeners = new Set<() => void>();
  private version = 0;

  constructor(private load: LiveLoader) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = (): number => this.version;

  peek(photoId: string | undefined): PreviewImage | undefined {
    return photoId ? this.frames.get(photoId) : undefined;
  }

  /** The latest frame wins: ask for these values as soon as the engine is free. */
  update(photoId: string, adjustments: Adjustments): void {
    this.waiting.set(photoId, adjustments);
    if (!this.flying.has(photoId)) void this.run(photoId);
  }

  /** The saved view is back in charge: forget the frames and anything still on its way. */
  clear(photoId: string): void {
    this.waiting.delete(photoId);
    this.epochs.set(photoId, (this.epochs.get(photoId) ?? 0) + 1);
    if (this.frames.delete(photoId)) this.changed();
  }

  private async run(photoId: string): Promise<void> {
    this.flying.add(photoId);
    try {
      for (;;) {
        const next = this.waiting.get(photoId);
        if (!next) return;
        this.waiting.delete(photoId);
        const epoch = this.epochs.get(photoId) ?? 0;
        try {
          const frame = await this.load(photoId, next);
          if ((this.epochs.get(photoId) ?? 0) === epoch) {
            this.frames.set(photoId, frame);
            this.changed();
          }
        } catch {
          // A frame that fails is skipped; the next one, or the saved view, takes over.
        }
      }
    } finally {
      this.flying.delete(photoId);
    }
  }

  private changed(): void {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }
}

export const livePreview = new LivePreviewStore((photoId, adjustments) =>
  preview(photoId, { maxPx: LIVE_PX, adjustments }),
);

/** The frame being dragged for this photo, if any; re-renders as new ones arrive. */
export function useLivePreview(photoId: string | undefined): PreviewImage | undefined {
  useSyncExternalStore(livePreview.subscribe, livePreview.getVersion);
  return livePreview.peek(photoId);
}
