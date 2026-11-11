import { photo } from "../screens/fixtures.ts";
import { firstPickedIndex } from "./focus.ts";

describe("firstPickedIndex", () => {
  it("opens on the picked photo, not the first of the list", () => {
    expect(firstPickedIndex([photo("a", false), photo("b", true), photo("c", true)])).toBe(1);
  });

  it("falls back to the first photo when nothing is picked or the burst is empty", () => {
    expect(firstPickedIndex([photo("a", false), photo("b", false)])).toBe(0);
    expect(firstPickedIndex([])).toBe(0);
  });
});
