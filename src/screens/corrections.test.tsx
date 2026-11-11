import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as engine from "../lib/engine.ts";
import { type Adjustments, NEUTRAL } from "../lib/engine.ts";
import { livePreview } from "../lib/livePreview.ts";
import { previews } from "../lib/previews.ts";
import { RESULT } from "./fixtures.ts";
import { ReviewScreen } from "./ReviewScreen.tsx";
import { buildScopes, scopeText } from "./review/scopes.ts";

vi.mock("../lib/engine.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/engine.ts")>();
  return {
    ...actual,
    preview: vi.fn(),
    getSettings: vi.fn(),
    setSetting: vi.fn(),
    onEngineEvent: vi.fn(),
    setPick: vi.fn(),
    listLuts: vi.fn(),
    getEdits: vi.fn(),
    setEdits: vi.fn(),
    resetEdits: vi.fn(),
  };
});
vi.mock("../lib/window.ts", () => ({ setFullscreen: vi.fn() }));

const mocked = vi.mocked(engine);
const WARM = { id: "l1", name: "Cálido", size: 33 };

beforeEach(() => {
  vi.clearAllMocks();
  previews.clear();
  livePreview.clear("IMG_2");
  Object.defineProperty(window, "innerWidth", { value: 1280, configurable: true, writable: true });
  mocked.onEngineEvent.mockResolvedValue(() => undefined);
  mocked.preview.mockResolvedValue({
    url: "data:image/jpeg;base64,AAAA",
    width: 1600,
    height: 1067,
    sourceWidth: 6000,
    sourceHeight: 4000,
  });
  mocked.getSettings.mockRejectedValue(new Error("not needed"));
  mocked.setSetting.mockImplementation(async (key, value) => ({ key, value }));
  mocked.listLuts.mockResolvedValue([WARM]);
  mocked.getEdits.mockResolvedValue({});
  mocked.setEdits.mockImplementation(async (_s, ids) => ({ photo_ids: ids }));
  mocked.resetEdits.mockImplementation(async (_s, ids) => ({ photo_ids: ids }));
});

function openReview() {
  const user = userEvent.setup();
  render(
    <ReviewScreen
      sessionId="s1"
      initial={RESULT}
      theme="light"
      onThemeChange={vi.fn()}
      immersive={false}
      onImmersiveChange={vi.fn()}
      onReset={vi.fn()}
    />,
  );
  return user;
}

function drag(slider: HTMLElement, value: number) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(slider, String(value));
    slider.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const panel = () => screen.getByRole("region", { name: "Corrección básica" });
const SAVED = (patch: Partial<Adjustments>): Adjustments => ({ ...NEUTRAL, ...patch });

describe("scopes", () => {
  it("name the photos each choice reaches", () => {
    const scopes = buildScopes(RESULT.bursts, "IMG_1", new Set(["IMG_5"]));
    expect(scopes.current).toEqual(["IMG_1"]);
    expect(scopes.burst).toEqual(["IMG_1", "IMG_2", "IMG_3"]);
    expect(scopes.picked).toEqual(["IMG_2", "IMG_4"]);
    expect(scopes.marked).toEqual(["IMG_5"]);
    expect(scopes.all).toHaveLength(5);
    expect(scopeText("burst", scopes)).toBe("Esta ráfaga (3)");
    expect(scopeText("current", scopes)).toBe("Solo esta foto");
  });

  it("are empty when nothing is on screen", () => {
    const scopes = buildScopes(RESULT.bursts, undefined, new Set());
    expect([scopes.current, scopes.burst, scopes.marked]).toEqual([[], [], []]);
  });
});

describe("the corrections panel", () => {
  it("saves a slider on the photo on screen shortly after you stop dragging", async () => {
    openReview();
    drag(within(panel()).getByRole("slider", { name: "Exposición" }), 1);
    drag(within(panel()).getByRole("slider", { name: "Exposición" }), 1.5);
    expect(
      within(panel()).getByRole("spinbutton", { name: "Exposición (valor)" }),
    ).toHaveDisplayValue("1.5");
    expect(mocked.setEdits).not.toHaveBeenCalled(); // still dragging
    await waitFor(() => expect(mocked.setEdits).toHaveBeenCalledTimes(1));
    expect(mocked.setEdits).toHaveBeenCalledWith("s1", ["IMG_2"], SAVED({ exposure: 1.5 }));
  });

  it("draws the viewer with the slider's values at once, before anything is saved", async () => {
    openReview();
    drag(within(panel()).getByRole("slider", { name: "Exposición" }), 1);
    await waitFor(() =>
      expect(mocked.preview).toHaveBeenCalledWith("IMG_2", {
        maxPx: 1000,
        adjustments: SAVED({ exposure: 1 }),
      }),
    );
    expect(mocked.setEdits).not.toHaveBeenCalled();
    drag(within(panel()).getByRole("slider", { name: "Exposición" }), 1.4);
    await waitFor(() =>
      expect(mocked.preview).toHaveBeenCalledWith("IMG_2", {
        maxPx: 1000,
        adjustments: SAVED({ exposure: 1.4 }),
      }),
    );
  });

  it("hands the viewer back to the saved view once the correction is stored", async () => {
    openReview();
    drag(within(panel()).getByRole("slider", { name: "Contraste" }), 0.3);
    await waitFor(() => expect(mocked.setEdits).toHaveBeenCalled());
    await waitFor(() => expect(livePreview.peek("IMG_2")).toBeUndefined());
  });

  it("asks again for the views of a photo whose corrections changed", async () => {
    openReview();
    await waitFor(() => expect(mocked.preview).toHaveBeenCalledWith("IMG_2", expect.anything()));
    const before = mocked.preview.mock.calls.filter(([id]) => id === "IMG_2").length;
    drag(within(panel()).getByRole("slider", { name: "Contraste" }), 0.4);
    await waitFor(() =>
      expect(mocked.preview.mock.calls.filter(([id]) => id === "IMG_2").length).toBeGreaterThan(
        before,
      ),
    );
  });

  it("takes a number typed next to the slider, and moves it with the arrow keys", async () => {
    const user = openReview();
    const exposure = within(panel()).getByRole("spinbutton", { name: "Exposición (valor)" });
    await user.click(exposure);
    await user.keyboard("{Control>}a{/Control}1,5");
    expect(within(panel()).getByRole("slider", { name: "Exposición" })).toHaveValue("1.5");
    await user.keyboard("{ArrowUp}");
    expect(exposure).toHaveDisplayValue("1.6");
    expect(within(panel()).getByRole("slider", { name: "Exposición" })).toHaveValue("1.6");
    await waitFor(() => expect(mocked.setEdits).toHaveBeenCalledTimes(1));
    expect(mocked.setEdits).toHaveBeenCalledWith("s1", ["IMG_2"], SAVED({ exposure: 1.6 }));
  });

  it("shows the other controls from -100 to 100 and turns them back into fractions", async () => {
    const user = openReview();
    const contrast = within(panel()).getByRole("spinbutton", { name: "Contraste (valor)" });
    await user.click(contrast);
    await user.keyboard("{Control>}a{/Control}25");
    expect(within(panel()).getByRole("slider", { name: "Contraste" })).toHaveValue("0.25");
    await user.keyboard("{Shift>}{ArrowDown}{/Shift}");
    expect(contrast).toHaveDisplayValue("15");
    await waitFor(() => expect(mocked.setEdits).toHaveBeenCalled());
    expect(mocked.setEdits).toHaveBeenLastCalledWith("s1", ["IMG_2"], SAVED({ contrast: 0.15 }));
  });

  it("keeps a typed number inside the range and takes a LUT strength in percent", async () => {
    const user = openReview();
    const saturation = within(panel()).getByRole("spinbutton", { name: "Saturación (valor)" });
    await user.click(saturation);
    await user.keyboard("{Control>}a{/Control}500");
    expect(within(panel()).getByRole("slider", { name: "Saturación" })).toHaveValue("1");
    await within(panel()).findByRole("option", { name: "Cálido" });
    await user.selectOptions(within(panel()).getByLabelText("LUT"), "Cálido");
    const strength = within(panel()).getByRole("spinbutton", {
      name: "Intensidad del LUT (valor)",
    });
    expect(strength).toHaveDisplayValue("100");
    await user.click(strength);
    await user.keyboard("{Control>}a{/Control}40");
    expect(within(panel()).getByRole("slider", { name: "Intensidad del LUT" })).toHaveValue("0.4");
  });

  it("copies the corrections to the whole burst with one button", async () => {
    const user = openReview();
    drag(within(panel()).getByRole("slider", { name: "Saturación" }), -0.5);
    await user.click(within(panel()).getByRole("button", { name: "Aplicar al grupo" }));
    await waitFor(() => expect(mocked.setEdits).toHaveBeenCalled());
    const [, ids, adjustments] = mocked.setEdits.mock.calls.at(-1) ?? [];
    expect(ids).toEqual(["IMG_1", "IMG_2", "IMG_3"]);
    expect(adjustments).toEqual(SAVED({ saturation: -0.5 }));
  });

  it("applies a LUT from the library, with its strength, to the chosen photos", async () => {
    const user = openReview();
    await within(panel()).findByRole("option", { name: "Cálido" });
    await user.selectOptions(within(panel()).getByLabelText("LUT"), "Cálido");
    drag(within(panel()).getByRole("slider", { name: "Intensidad del LUT" }), 0.6);
    await user.selectOptions(within(panel()).getByLabelText("Aplicar a"), "Las elegidas (2)");
    await user.click(within(panel()).getByRole("button", { name: "Aplicar al grupo" }));
    await waitFor(() => expect(mocked.setEdits).toHaveBeenCalled());
    const [, ids, adjustments] = mocked.setEdits.mock.calls.at(-1) ?? [];
    expect(ids).toEqual(["IMG_2", "IMG_4"]);
    expect(adjustments).toEqual(SAVED({ lut_id: "l1", lut_strength: 0.6 }));
  });

  it("shows the corrections a photo already has and can clear them", async () => {
    mocked.getEdits.mockResolvedValue({ IMG_2: SAVED({ exposure: 0.5, tint: -0.2 }) });
    const user = openReview();
    expect(
      await within(panel()).findByRole("spinbutton", { name: "Exposición (valor)" }),
    ).toHaveDisplayValue("0.5");
    await user.click(within(panel()).getByRole("button", { name: "Restablecer esta foto" }));
    await waitFor(() => expect(mocked.resetEdits).toHaveBeenCalledWith("s1", ["IMG_2"]));
    expect(within(panel()).getByRole("button", { name: "Restablecer esta foto" })).toBeDisabled();
  });

  it("removes the corrections of a group", async () => {
    const user = openReview();
    await user.click(within(panel()).getByRole("button", { name: "Quitar correcciones" }));
    await waitFor(() =>
      expect(mocked.resetEdits).toHaveBeenCalledWith("s1", ["IMG_1", "IMG_2", "IMG_3"]),
    );
  });

  it("puts the corrections back and says so when they cannot be saved", async () => {
    mocked.setEdits.mockRejectedValue(new Error("engine down"));
    openReview();
    drag(within(panel()).getByRole("slider", { name: "Luces" }), -0.3);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se pudieron guardar las correcciones.",
    );
    await waitFor(() =>
      expect(within(panel()).getByRole("slider", { name: "Luces" })).toHaveValue("0"),
    );
  });

  it("keeps a pending change for the first photo when you move to another one", async () => {
    const user = openReview();
    drag(within(panel()).getByRole("slider", { name: "Tinte" }), 0.4);
    await user.keyboard("{ArrowRight}");
    await waitFor(() => expect(mocked.setEdits).toHaveBeenCalled());
    expect(mocked.setEdits).toHaveBeenCalledWith("s1", ["IMG_2"], SAVED({ tint: 0.4 }));
    expect(within(panel()).getByRole("slider", { name: "Tinte" })).toHaveValue("0");
  });

  it("opens the export window on the group chosen in the panel", async () => {
    mocked.setSetting.mockResolvedValue({ key: "export_options", value: {} });
    const user = openReview();
    await user.selectOptions(within(panel()).getByLabelText("Aplicar a"), "Todas las fotos (5)");
    await user.click(within(panel()).getByRole("button", { name: "Exportar…" }));
    const dialog = await screen.findByRole("dialog", { name: "Exportar fotos" });
    expect(within(dialog).getByLabelText("Qué exportar")).toHaveValue("all");
    expect(within(dialog).getByText("5 fotos")).toBeInTheDocument();
  });

  it("offers the marked photos only when there are some", async () => {
    openReview();
    const marked = within(panel()).getByRole("option", { name: "Las marcadas (0)" });
    expect(marked).toBeDisabled();
  });
});

describe("marking photos in the grid", () => {
  async function openGrid() {
    const user = openReview();
    await user.click(screen.getByRole("radio", { name: "Cuadrícula" }));
    return user;
  }

  it("marks with Ctrl+click and counts them", async () => {
    const user = await openGrid();
    await user.keyboard("{Control>}");
    await user.click(screen.getByRole("button", { name: "IMG_1.jpg, no elegida" }));
    await user.click(screen.getByRole("button", { name: "IMG_4.ARW, elegida" }));
    await user.keyboard("{/Control}");
    expect(screen.getByText("2 marcadas")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "IMG_1.jpg, no elegida, marcada" })).toBeVisible();
    const grid = screen.getByRole("region", { name: "Cuadrícula de todas las fotos" });
    await user.click(within(grid).getByRole("button", { name: "Limpiar marcadas" }));
    expect(screen.getByText("0 marcadas")).toBeInTheDocument();
  });

  it("marks a range with Shift+click and all the visible ones with a button", async () => {
    const user = await openGrid();
    await user.click(screen.getByRole("button", { name: "IMG_2.jpg, elegida" }));
    await user.keyboard("{Shift>}");
    await user.click(screen.getByRole("button", { name: "IMG_4.ARW, elegida" }));
    await user.keyboard("{/Shift}");
    expect(screen.getByText("3 marcadas")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Marcar visibles" }));
    expect(screen.getByText("5 marcadas")).toBeInTheDocument();
  });

  it("toggles the focused photo's mark with M and does not change what is chosen", async () => {
    const user = await openGrid();
    await user.click(screen.getByRole("button", { name: "IMG_1.jpg, no elegida" }));
    await user.keyboard("m");
    expect(screen.getByText("1 marcadas")).toBeInTheDocument();
    expect(mocked.setPick).not.toHaveBeenCalled();
    await user.keyboard("m");
    expect(screen.getByText("0 marcadas")).toBeInTheDocument();
  });

  it("applies corrections to the marked photos only", async () => {
    const user = await openGrid();
    await user.keyboard("{Control>}");
    await user.click(screen.getByRole("button", { name: "IMG_3.jpg, no elegida" }));
    await user.click(screen.getByRole("button", { name: "IMG_5.ARW, no elegida" }));
    await user.keyboard("{/Control}");
    const side = screen.getByRole("complementary", { name: "Foto enfocada" });
    drag(within(side).getByRole("slider", { name: "Exposición" }), 0.5);
    await user.selectOptions(within(side).getByLabelText("Aplicar a"), "Las marcadas (2)");
    await user.click(within(side).getByRole("button", { name: "Aplicar al grupo" }));
    await waitFor(() => expect(mocked.setEdits).toHaveBeenCalled());
    const [, ids] = mocked.setEdits.mock.calls.at(-1) ?? [];
    expect(ids).toEqual(["IMG_3", "IMG_5"]);
  });

  it("shows which photos carry corrections", async () => {
    mocked.getEdits.mockResolvedValue({ IMG_4: SAVED({ exposure: 1 }) });
    await openGrid();
    await waitFor(() => expect(screen.getAllByTitle("Tiene correcciones")).toHaveLength(1));
  });
});
