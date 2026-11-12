import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, waitFor, within } from "@testing-library/react";
import * as engine from "../lib/engine.ts";
import { previews } from "../lib/previews.ts";
import { HomeScreen } from "./HomeScreen.tsx";

vi.mock("../lib/engine.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/engine.ts")>();
  return { ...actual, sessionsList: vi.fn(), preview: vi.fn(), onEngineEvent: vi.fn() };
});

const mocked = vi.mocked(engine);
const css = (name: string) =>
  readFileSync(join(process.cwd(), "src", "screens", "home", `${name}.module.css`), "utf-8");
const auroraCss = css("Aurora");
const cardCss = css("SessionCard");
const sheetCss = css("ContactSheet");

const SESSION: engine.SessionSummary = {
  id: "s1",
  label: "Boda de Ana",
  folder: "C:\\fotos\\boda",
  photos: 120,
  bursts: 40,
  picked: 38,
  reviewed: 10,
  edited: 2,
  updated_at: new Date().toISOString(),
  last_burst_id: null,
  available: true,
  covers: ["P1", "P2", "P3"],
};

beforeEach(() => {
  vi.clearAllMocks();
  previews.clear();
  mocked.onEngineEvent.mockResolvedValue(() => undefined);
  mocked.sessionsList.mockResolvedValue([SESSION]);
  mocked.preview.mockResolvedValue({
    url: "data:image/jpeg;base64,AAAA",
    width: 240,
    height: 320,
    sourceWidth: 6000,
    sourceHeight: 4000,
  });
});

describe("the Home screen", () => {
  it("opens with a headline, the two ways to start, what to count on and the four steps", () => {
    mocked.sessionsList.mockResolvedValue([]);
    render(<HomeScreen onResult={vi.fn()} />);
    expect(
      screen.getByRole("heading", { name: "Elige las mejores tomas de tus ráfagas" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Elegir carpeta" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Elegir archivos" })).toBeEnabled();
    const promises = screen.getByRole("list", { name: "Garantías" });
    expect(within(promises).getAllByRole("listitem")).toHaveLength(3);
    expect(within(promises).getByText("Tus originales no se tocan")).toBeVisible();
    const steps = screen.getByRole("list", { name: "Cómo funciona" });
    expect(within(steps).getAllByRole("listitem")).toHaveLength(4);
  });

  it("paints at once and loads the photos of the contact sheet and the cards afterwards", async () => {
    render(<HomeScreen onResult={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Elegir carpeta" })).toBeVisible();
    expect(mocked.preview).not.toHaveBeenCalledWith("P1", expect.anything());
    await waitFor(() => expect(mocked.preview).toHaveBeenCalledWith("P1", expect.anything()), {
      timeout: 2000,
    });
  });

  it("hides the decorations from screen readers", () => {
    render(<HomeScreen onResult={vi.fn()} />);
    expect(screen.getByTestId("aurora")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByTestId("contact-sheet")).toHaveAttribute("aria-hidden", "true");
  });

  it("shows how far a session got on its card", async () => {
    render(<HomeScreen onResult={vi.fn()} />);
    const card = await screen.findByTestId("session-card");
    expect(
      within(card).getByText(/120 fotos · 38 elegidas · 10 de 40 ráfagas revisadas/),
    ).toBeVisible();
    expect(within(card).getByRole("button", { name: "Continuar Boda de Ana" })).toBeEnabled();
  });

  it("pauses the drifting lights while the window is hidden", () => {
    render(<HomeScreen onResult={vi.fn()} />);
    const aurora = screen.getByTestId("aurora");
    expect(aurora).toHaveAttribute("data-paused", "false");
    Object.defineProperty(document, "hidden", { value: true, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(aurora).toHaveAttribute("data-paused", "true");
    Object.defineProperty(document, "hidden", { value: false, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(aurora).toHaveAttribute("data-paused", "false");
  });
});

describe("the Home's animations are cheap", () => {
  const animatedProperties = (css: string) => {
    const keyframes = [...css.matchAll(/@keyframes\s+\w+\s*\{([\s\S]*?)\n\}/g)];
    return keyframes.flatMap(([, body]) =>
      [...(body ?? "").matchAll(/^\s{4}([a-z-]+)\s*:/gm)].map(([, name]) => name),
    );
  };

  it.each([
    ["the aurora", auroraCss],
    ["the contact sheet", sheetCss],
    ["the session cards", cardCss],
  ])("%s animate only transform and opacity", (_name, css) => {
    const props = animatedProperties(css);
    expect(props.length).toBeGreaterThan(0);
    for (const prop of props) expect(["transform", "opacity"]).toContain(prop);
  });

  it.each([
    ["the aurora", auroraCss],
    ["the contact sheet", sheetCss],
    ["the session cards", cardCss],
  ])("%s switch off for people who ask for less motion", (_name, css) => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation:\s*none/);
  });

  it("the aurora uses no blur filter, which is costly on every frame", () => {
    expect(auroraCss).not.toMatch(/filter\s*:/);
  });
});
