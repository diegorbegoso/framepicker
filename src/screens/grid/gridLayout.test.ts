import { readFileSync } from "node:fs";
import { join } from "node:path";

// jsdom does not lay anything out, so the rules that keep the grid from collapsing are checked in
// the stylesheets themselves. Without them, with hundreds of photos every row past the first screenful
// is 0 px tall (rows are sized to their content only while the scrolling container has free space).
const dir = join(process.cwd(), "src", "screens", "grid");

/** The declarations of the first rule written with exactly this selector. */
function rule(file: string, selector: string): string {
  const css = `\n${readFileSync(join(dir, file), "utf8")}`;
  const start = css.indexOf(`\n${selector} {`);
  expect(start, `${selector} in ${file}`).toBeGreaterThanOrEqual(0);
  return css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
}

describe("the photo grid keeps its shape with any number of photos", () => {
  it("sizes every row to its cells instead of to the space left", () => {
    expect(rule("GridScreen.module.css", ".grid")).toMatch(/grid-auto-rows:\s*max-content/);
  });

  it("makes every cell 3:2 on its own, whatever the picture inside is", () => {
    expect(rule("GridCell.module.css", ".cell")).toMatch(/aspect-ratio:\s*3\s*\/\s*2/);
    const picture = rule("GridCell.module.css", ".picture");
    expect(picture).toMatch(/height:\s*100%/);
    expect(picture).not.toMatch(/aspect-ratio/);
  });

  it("fills the cell with the picture, cropping the edges of vertical photos", () => {
    expect(rule("GridCell.module.css", ".picture img,\n.fill")).toMatch(/object-fit:\s*cover/);
  });
});
