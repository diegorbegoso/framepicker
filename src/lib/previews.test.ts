import type { PreviewImage } from "./engine.ts";
import { PreviewStore, type Tier } from "./previews.ts";

function image(label: string): PreviewImage {
  return {
    url: `data:image/jpeg;base64,${label}`,
    width: 10,
    height: 10,
    sourceWidth: 20,
    sourceHeight: 20,
  };
}

/** A loader whose requests stay open until the test settles them, so order can be observed. */
function controlled() {
  const calls: { photoId: string; tier: Tier; settle: (ok: boolean) => void }[] = [];
  const loader = (photoId: string, tier: Tier) =>
    new Promise<PreviewImage>((resolve, reject) => {
      calls.push({
        photoId,
        tier,
        settle: (ok) => (ok ? resolve(image(`${tier}-${photoId}`)) : reject(new Error("boom"))),
      });
    });
  return { calls, loader };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("PreviewStore", () => {
  it("asks the engine once for the same photo and size", async () => {
    const { calls, loader } = controlled();
    const store = new PreviewStore(loader);
    const first = store.request("a", "view");
    const second = store.request("a", "view");
    expect(calls).toHaveLength(1);
    expect(store.status("a", "view")).toBe("loading");
    calls[0]?.settle(true);
    expect(await first).toEqual(await second);
    expect(store.status("a", "view")).toBe("ready");
    expect(store.peek("a", "view")?.url).toContain("view-a");
    await store.request("a", "view");
    expect(calls).toHaveLength(1);
  });

  it("serves the most urgent request first", async () => {
    const { calls, loader } = controlled();
    const store = new PreviewStore(loader, 1);
    void store.request("busy", "thumb", 2);
    void store.request("thumb-b", "thumb", 2);
    void store.request("focused", "view", 0);
    void store.request("neighbour", "view", 1);
    calls[0]?.settle(true);
    await flush();
    expect(calls.map((c) => c.photoId)).toEqual(["busy", "focused"]);
    calls[1]?.settle(true);
    await flush();
    expect(calls.map((c) => c.photoId)).toEqual(["busy", "focused", "neighbour"]);
  });

  it("promotes a request that is already waiting", async () => {
    const { calls, loader } = controlled();
    const store = new PreviewStore(loader, 1);
    void store.request("busy", "thumb", 2);
    void store.request("a", "thumb", 2);
    void store.request("b", "thumb", 2);
    void store.request("b", "thumb", 0);
    calls[0]?.settle(true);
    await flush();
    expect(calls.map((c) => c.photoId)).toEqual(["busy", "b"]);
  });

  it("keeps only the most recently used images of a size", async () => {
    const { calls, loader } = controlled();
    const store = new PreviewStore(loader, 3, { view: 2 });
    for (const id of ["a", "b", "c"]) void store.request(id, "view");
    for (const call of calls) call.settle(true);
    await flush();
    expect(store.status("a", "view")).toBe("idle");
    expect(store.status("b", "view")).toBe("ready");
    expect(store.status("c", "view")).toBe("ready");
  });

  it("reports a failure and tries again on retry", async () => {
    const { calls, loader } = controlled();
    const store = new PreviewStore(loader);
    const attempt = store.request("a", "view");
    calls[0]?.settle(false);
    await expect(attempt).rejects.toThrow("boom");
    expect(store.status("a", "view")).toBe("error");
    void store.retry("a", "view");
    expect(store.status("a", "view")).toBe("loading");
    calls[1]?.settle(true);
    await flush();
    expect(store.status("a", "view")).toBe("ready");
  });

  it("tells subscribers when something changed, and forgets everything on clear", async () => {
    const { calls, loader } = controlled();
    const store = new PreviewStore(loader);
    const seen = vi.fn();
    const stop = store.subscribe(seen);
    void store.request("a", "thumb");
    calls[0]?.settle(true);
    await flush();
    expect(seen).toHaveBeenCalled();
    const version = store.getVersion();
    store.clear();
    expect(store.getVersion()).toBeGreaterThan(version);
    expect(store.status("a", "thumb")).toBe("idle");
    stop();
  });
});
