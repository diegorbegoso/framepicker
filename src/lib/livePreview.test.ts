import { type Adjustments, NEUTRAL, type PreviewImage } from "./engine.ts";
import { LivePreviewStore } from "./livePreview.ts";

function frame(label: string): PreviewImage {
  return {
    url: `data:image/jpeg;base64,${label}`,
    width: 10,
    height: 10,
    sourceWidth: 20,
    sourceHeight: 20,
  };
}

const at = (exposure: number): Adjustments => ({ ...NEUTRAL, exposure });

/** A loader whose answers the test releases by hand, so ordering can be seen. */
function controlled() {
  const calls: { photoId: string; adjustments: Adjustments; answer: () => void }[] = [];
  const load = (photoId: string, adjustments: Adjustments) =>
    new Promise<PreviewImage>((resolve) => {
      calls.push({ photoId, adjustments, answer: () => resolve(frame(`${adjustments.exposure}`)) });
    });
  return { calls, load };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("LivePreviewStore", () => {
  it("asks for a frame at once and shows it when it arrives", async () => {
    const { calls, load } = controlled();
    const store = new LivePreviewStore(load);
    const seen = vi.fn();
    store.subscribe(seen);
    store.update("a", at(0.5));
    expect(calls).toHaveLength(1);
    expect(store.peek("a")).toBeUndefined();
    calls[0]?.answer();
    await flush();
    expect(store.peek("a")?.url).toContain("0.5");
    expect(seen).toHaveBeenCalled();
  });

  it("keeps one request in flight and draws the newest values next, skipping the in-between ones", async () => {
    const { calls, load } = controlled();
    const store = new LivePreviewStore(load);
    store.update("a", at(0.1));
    store.update("a", at(0.2));
    store.update("a", at(0.3));
    store.update("a", at(0.4));
    expect(calls).toHaveLength(1); // the first is still being drawn
    calls[0]?.answer();
    await flush();
    expect(store.peek("a")?.url).toContain("0.1"); // every frame that arrives is shown
    expect(calls).toHaveLength(2);
    expect(calls[1]?.adjustments.exposure).toBe(0.4); // 0.2 and 0.3 were never drawn
    calls[1]?.answer();
    await flush();
    expect(store.peek("a")?.url).toContain("0.4");
    expect(calls).toHaveLength(2);
  });

  it("works on each photo on its own", async () => {
    const { calls, load } = controlled();
    const store = new LivePreviewStore(load);
    store.update("a", at(0.1));
    store.update("b", at(0.2));
    expect(calls.map((c) => c.photoId)).toEqual(["a", "b"]);
  });

  it("forgets the frame on clear, and ignores an answer that was still on its way", async () => {
    const { calls, load } = controlled();
    const store = new LivePreviewStore(load);
    store.update("a", at(0.1));
    calls[0]?.answer();
    await flush();
    expect(store.peek("a")).toBeDefined();
    store.update("a", at(0.2));
    store.clear("a");
    expect(store.peek("a")).toBeUndefined();
    calls[1]?.answer(); // the saved view took over before this one came back
    await flush();
    expect(store.peek("a")).toBeUndefined();
  });

  it("does not draw the values that were waiting when it was cleared", async () => {
    const { calls, load } = controlled();
    const store = new LivePreviewStore(load);
    store.update("a", at(0.1));
    store.update("a", at(0.2));
    store.clear("a");
    calls[0]?.answer();
    await flush();
    expect(calls).toHaveLength(1);
  });

  it("starts again after a clear", async () => {
    const { calls, load } = controlled();
    const store = new LivePreviewStore(load);
    store.update("a", at(0.1));
    calls[0]?.answer();
    await flush();
    store.clear("a");
    store.update("a", at(0.7));
    expect(calls).toHaveLength(2);
    calls[1]?.answer();
    await flush();
    expect(store.peek("a")?.url).toContain("0.7");
  });

  it("survives a frame that fails and carries on with the next", async () => {
    const calls: { adjustments: Adjustments; fail: () => void; answer: () => void }[] = [];
    const store = new LivePreviewStore(
      (_id, adjustments) =>
        new Promise<PreviewImage>((resolve, reject) => {
          calls.push({
            adjustments,
            fail: () => reject(new Error("engine busy")),
            answer: () => resolve(frame("ok")),
          });
        }),
    );
    store.update("a", at(0.1));
    store.update("a", at(0.2));
    calls[0]?.fail();
    await flush();
    expect(calls).toHaveLength(2);
    calls[1]?.answer();
    await flush();
    expect(store.peek("a")?.url).toContain("ok");
  });
});
