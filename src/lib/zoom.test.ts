import {
  actualPixelsZoom,
  FIT_VIEW,
  fitScale,
  fromTransform,
  maxZoom,
  panView,
  toTransform,
  zoomTo,
  zoomView,
} from "./zoom.ts";

const pane = { w: 800, h: 600 };
const photo = { w: 4000, h: 3000 };

describe("fit", () => {
  it("fits the whole photo in the pane", () => {
    expect(fitScale(pane, photo)).toBeCloseTo(0.2);
    expect(fitScale(pane, { w: 2000, h: 1000 })).toBeCloseTo(0.4);
  });

  it("centres a photo that is wider than tall", () => {
    const t = toTransform(FIT_VIEW, pane, { w: 4000, h: 2000 });
    expect(t.scale).toBeCloseTo(0.2);
    expect(t.x).toBeCloseTo(0);
    expect(t.y).toBeCloseTo(100);
  });

  it("does not blow up on an empty pane or image", () => {
    expect(Number.isFinite(fitScale({ w: 0, h: 0 }, { w: 0, h: 0 }))).toBe(true);
  });
});

describe("actual pixels", () => {
  it("is the zoom at which one source pixel is one screen pixel", () => {
    expect(actualPixelsZoom(pane, photo, 1)).toBeCloseTo(5);
    // On a 125 % Windows display one CSS pixel is 1.25 device pixels.
    expect(actualPixelsZoom(pane, photo, 1.25)).toBeCloseTo(4);
  });

  it("lets the person zoom past actual pixels but not without limit", () => {
    expect(maxZoom(pane, photo, 1)).toBeCloseTo(20);
    expect(maxZoom(pane, { w: 800, h: 600 }, 1)).toBe(4);
    expect(maxZoom(pane, { w: 100, h: 100 }, 4)).toBeGreaterThanOrEqual(2);
  });
});

describe("zoom and pan", () => {
  const source = (x: number, y: number, view = FIT_VIEW) => {
    const t = toTransform(view, pane, photo);
    return { x: (x - t.x) / t.scale, y: (y - t.y) / t.scale };
  };

  it("keeps the point under the cursor where it was", () => {
    const at = { x: 200, y: 150 };
    const before = source(at.x, at.y);
    const zoomed = zoomView(FIT_VIEW, pane, photo, 5, at, 20);
    expect(zoomed.zoom).toBeCloseTo(5);
    const after = source(at.x, at.y, zoomed);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it("never zooms out past the fit or in past the limit", () => {
    expect(zoomView(FIT_VIEW, pane, photo, 0.1, { x: 400, y: 300 }, 20).zoom).toBe(1);
    expect(zoomView(FIT_VIEW, pane, photo, 100, { x: 400, y: 300 }, 20).zoom).toBeCloseTo(20);
  });

  it("jumps to a target zoom", () => {
    expect(zoomTo(FIT_VIEW, pane, photo, 5, { x: 400, y: 300 }, 20).zoom).toBeCloseTo(5);
  });

  it("cannot drag a photo that already fits", () => {
    const moved = panView(FIT_VIEW, pane, photo, 120, -80);
    expect(moved.u).toBeCloseTo(0.5);
    expect(moved.v).toBeCloseTo(0.5);
  });

  it("stops dragging at the photo's edge", () => {
    const zoomed = zoomView(FIT_VIEW, pane, photo, 5, { x: 400, y: 300 }, 20);
    const left = panView(zoomed, pane, photo, 100000, 0);
    // The left edge sits at the pane's left edge: the view centre is half a pane in.
    expect(left.u).toBeCloseTo(400 / 4000);
    const right = panView(zoomed, pane, photo, -100000, 0);
    expect(right.u).toBeCloseTo(1 - 400 / 4000);
  });

  it("round-trips between a view and a transform", () => {
    const view = zoomView(FIT_VIEW, pane, photo, 4, { x: 300, y: 200 }, 20);
    const back = fromTransform(toTransform(view, pane, photo), pane, photo);
    expect(back.zoom).toBeCloseTo(view.zoom);
    expect(back.u).toBeCloseTo(view.u);
    expect(back.v).toBeCloseTo(view.v);
  });

  it("shows the same part of the scene in a pane of another size", () => {
    const wide = { w: 1600, h: 1200 };
    const view = zoomView(FIT_VIEW, pane, photo, 4, { x: 300, y: 200 }, 20);
    const t = toTransform(view, wide, photo);
    const centre = {
      u: (wide.w / 2 - t.x) / (photo.w * t.scale),
      v: (wide.h / 2 - t.y) / (photo.h * t.scale),
    };
    expect(centre.u).toBeCloseTo(view.u);
    expect(centre.v).toBeCloseTo(view.v);
  });
});
