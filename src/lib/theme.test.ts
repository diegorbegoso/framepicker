import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { applyTheme } from "./theme.ts";

const SRC = join(process.cwd(), "src");
const TOKENS = join(SRC, "styles", "tokens.css");

const COLOR_TOKENS = [
  "--bg",
  "--surface",
  "--fg",
  "--fg-muted",
  "--primary",
  "--primary-fg",
  "--border",
  "--divider",
  "--destructive",
  "--success",
  "--focus",
  "--surface-2",
  "--primary-hover",
  "--primary-press",
  "--primary-soft",
  "--success-soft",
];

// Defined once in :root: the photo stage looks the same in both themes.
const STAGE_TOKENS = [
  "--stage",
  "--stage-raised",
  "--stage-fg",
  "--stage-fg-muted",
  "--stage-border",
  "--stage-accent",
  "--stage-success",
  "--stage-focus",
];

const TEXT_PAIRS: [string, string][] = [
  ["--fg", "--bg"],
  ["--fg", "--surface"],
  ["--fg-muted", "--bg"],
  ["--fg-muted", "--surface"],
  ["--primary-fg", "--primary"],
  ["--primary", "--bg"],
  ["--destructive", "--bg"],
  ["--success", "--bg"],
  ["--fg", "--surface-2"],
  ["--fg-muted", "--surface-2"],
  ["--fg", "--primary-soft"],
  ["--primary", "--primary-soft"],
  ["--success", "--success-soft"],
  ["--stage-fg", "--stage"],
  ["--stage-fg", "--stage-raised"],
  ["--stage-fg-muted", "--stage"],
  ["--stage-fg-muted", "--stage-raised"],
  ["--stage-accent", "--stage"],
  ["--stage-success", "--stage"],
  ["--stage-focus", "--stage"],
];

function block(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  expect(start, `block ${selector} not found`).toBeGreaterThanOrEqual(0);
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
  const tokens: Record<string, string> = {};
  for (const match of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    const [, name, value] = match;
    if (name && value) tokens[name] = value.trim();
  }
  return tokens;
}

function luminance(hex: string): number {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match?.[1]) throw new Error(`not a #rrggbb colour: ${hex}`);
  const value = match[1];
  const channels = [0, 2, 4].map((offset) => {
    const c = Number.parseInt(value.slice(offset, offset + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const [r = 0, g = 0, b = 0] = channels;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|css)$/.test(name) ? [path] : [];
  });
}

const css = readFileSync(TOKENS, "utf8");
const themes = {
  light: block(css, ":root"),
  dark: block(css, ':root[data-theme="dark"]'),
};

describe("applyTheme", () => {
  it("writes the theme to the html element", () => {
    applyTheme("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    applyTheme("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});

describe("tokens.css", () => {
  it("defines the same colour tokens in the light and the dark block", () => {
    for (const name of COLOR_TOKENS) {
      expect(themes.light[name], `light ${name}`).toMatch(/^#[0-9a-f]{6}$/i);
      expect(themes.dark[name], `dark ${name}`).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("keeps the photo stage identical in both themes", () => {
    for (const name of STAGE_TOKENS) {
      expect(themes.light[name], `light ${name}`).toMatch(/^#[0-9a-f]{6}$/i);
      expect(themes.dark[name], `${name} must not be overridden by the dark theme`).toBeUndefined();
    }
    expect(themes.light["--stage-hud"]).toMatch(/^rgb\(/);
    expect(themes.dark["--stage-hud"]).toBeUndefined();
  });

  it("collapses every motion duration under prefers-reduced-motion", () => {
    const media = /@media \(prefers-reduced-motion: reduce\)\s*\{\s*:root\s*\{([^}]*)\}/.exec(css);
    expect(media, "reduced-motion block").not.toBeNull();
    const reduced = media?.[1] ?? "";
    for (const name of ["--dur-fast", "--dur", "--dur-slow"]) {
      expect(reduced, name).toMatch(new RegExp(`${name}:\\s*0ms`));
      expect(themes.light[name], `${name} has a normal value`).toMatch(/^[1-9]\d*ms$/);
    }
  });

  for (const [mode, tokens] of Object.entries(themes)) {
    it(`meets the contrast minimums in the ${mode} theme`, () => {
      const lightTokens = themes.light;
      const value = (name: string) => tokens[name] ?? lightTokens[name] ?? "";
      for (const [fg, bg] of TEXT_PAIRS) {
        expect(contrast(value(fg), value(bg)), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrast(value("--border"), value("--bg")), "--border on --bg").toBeGreaterThanOrEqual(
        3,
      );
    });
  }
});

describe("colour literals", () => {
  it("appear nowhere in src outside tokens.css and the tests", () => {
    const literal = /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsl\(/i;
    const offenders = sourceFiles(SRC)
      .filter((path) => path !== TOKENS && !/\.test\.(ts|tsx)$/.test(path))
      .filter((path) => literal.test(readFileSync(path, "utf8")))
      .map((path) => relative(SRC, path));
    expect(offenders).toEqual([]);
  });
});
