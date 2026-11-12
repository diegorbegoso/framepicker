import {
  type Crop,
  canvasSize,
  fitCrop,
  fitFactor,
  fractionRatio,
  moveCrop,
  outputSize,
  ratioOf,
  resizeCrop,
  turnAspect,
} from "./geometry.ts";

const side = (crop: Crop) => [crop[2] - crop[0], crop[3] - crop[1]] as const;

describe("straightening maths (same as the engine)", () => {
  it("keeps the whole picture when it is not turned", () => {
    expect(fitFactor(300, 200, 0)).toBe(1);
    expect(canvasSize(300, 200, 0)).toEqual([300, 200]);
  });

  it("matches the engine's formula and the 45 degree square", () => {
    const theta = (10 * Math.PI) / 180;
    expect(fitFactor(300, 200, 10)).toBeCloseTo(1 / (Math.cos(theta) + 1.5 * Math.sin(theta)), 10);
    expect(fitFactor(100, 100, 45)).toBeCloseTo(1 / Math.SQRT2, 10);
    expect(fitFactor(300, 200, -10)).toBeCloseTo(fitFactor(300, 200, 10), 10);
  });

  it("sizes the cut like the engine does", () => {
    const k = fitFactor(300, 200, 10);
    expect(outputSize(300, 200, 10, null)).toEqual([Math.round(300 * k), Math.round(200 * k)]);
    expect(outputSize(300, 200, 0, [0, 0, 0.5, 1])).toEqual([150, 200]);
  });
});

describe("proportions", () => {
  it("reads fixed, original and free", () => {
    expect(ratioOf("3:2", 100, 100)).toBeCloseTo(1.5);
    expect(ratioOf("9:16", 100, 100)).toBeCloseTo(0.5625);
    expect(ratioOf("original", 600, 400)).toBeCloseTo(1.5);
    expect(ratioOf("libre", 600, 400)).toBeNull();
    expect(ratioOf(null, 600, 400)).toBeNull();
  });

  it("turns the orientation of a proportion", () => {
    expect(turnAspect("3:2", 600, 400)).toBe("2:3");
    expect(turnAspect("original", 600, 400)).toBe("400:600");
    expect(turnAspect("libre", 600, 400)).toBe("libre");
  });
});

describe("the crop frame", () => {
  const canvas: [number, number] = [300, 200];
  const ratio = fractionRatio(1, canvas); // a square, in canvas fractions

  it("fits a shape inside the canvas, around the centre it had", () => {
    const [x0, y0, x1, y1] = fitCrop([0, 0, 1, 1], ratio);
    expect((x1 - x0) / (y1 - y0)).toBeCloseTo(ratio);
    expect(x0).toBeGreaterThanOrEqual(0);
    expect(x1).toBeLessThanOrEqual(1);
    expect(y1 - y0).toBeCloseTo(1); // as tall as the canvas allows
  });

  it("moves without leaving the canvas", () => {
    expect(moveCrop([0.2, 0.2, 0.6, 0.6], 5, 5)).toEqual([
      expect.closeTo(0.6),
      expect.closeTo(0.6),
      1,
      1,
    ]);
    expect(moveCrop([0.2, 0.2, 0.6, 0.6], -5, -5)).toEqual([
      0,
      0,
      expect.closeTo(0.4),
      expect.closeTo(0.4),
    ]);
  });

  it("resizes freely from a side or a corner", () => {
    expect(resizeCrop([0.2, 0.2, 0.8, 0.8], "e", 0.5, 0.5, null)).toEqual([0.2, 0.2, 0.5, 0.8]);
    expect(resizeCrop([0.2, 0.2, 0.8, 0.8], "nw", 0.1, 0.3, null)).toEqual([0.1, 0.3, 0.8, 0.8]);
    const small = resizeCrop([0.2, 0.2, 0.8, 0.8], "w", 0.9, 0.5, null);
    expect(side(small)[0]).toBeGreaterThan(0);
  });

  it.each(["nw", "ne", "se", "sw", "n", "e", "s", "w"] as const)(
    "keeps the shape and stays inside when dragging %s with a fixed proportion",
    (handle) => {
      const start = fitCrop([0.2, 0.2, 0.7, 0.7], ratio);
      for (const [px, py] of [
        [0, 0],
        [1, 1],
        [0.5, 0.4],
        [0.95, 0.05],
      ] as const) {
        const next = resizeCrop(start, handle, px, py, ratio);
        const [w, h] = side(next);
        expect(w / h).toBeCloseTo(ratio, 5);
        for (const edge of next) {
          expect(edge).toBeGreaterThanOrEqual(-1e-9);
          expect(edge).toBeLessThanOrEqual(1 + 1e-9);
        }
        expect(w).toBeGreaterThan(0.04);
      }
    },
  );

  it("keeps the opposite corner still when a corner is dragged with a fixed proportion", () => {
    const start = fitCrop([0.2, 0.2, 0.6, 0.6], ratio);
    const next = resizeCrop(start, "se", 0.4, 0.5, ratio);
    expect(next[0]).toBeCloseTo(start[0]);
    expect(next[1]).toBeCloseTo(start[1]);
  });
});
