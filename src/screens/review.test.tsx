import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as engine from "../lib/engine.ts";
import { previews } from "../lib/previews.ts";
import { setFullscreen } from "../lib/window.ts";
import { photo, RESULT } from "./fixtures.ts";
import { ReviewScreen } from "./ReviewScreen.tsx";

vi.mock("../lib/engine.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/engine.ts")>();
  return {
    ...actual,
    select: vi.fn(),
    setPick: vi.fn(),
    confirmBurst: vi.fn(),
    preview: vi.fn(),
    getSettings: vi.fn(),
    setSetting: vi.fn(),
    onEngineEvent: vi.fn(),
    exportSelection: vi.fn(),
    pickFolder: vi.fn(),
  };
});
vi.mock("../lib/window.ts", () => ({ setFullscreen: vi.fn() }));

const mocked = vi.mocked(engine);

beforeEach(() => {
  vi.clearAllMocks();
  previews.clear();
  Object.defineProperty(window, "innerWidth", { value: 1280, configurable: true, writable: true });
  mocked.onEngineEvent.mockResolvedValue(() => undefined);
  mocked.preview.mockImplementation(async () => ({
    url: "data:image/jpeg;base64,AAAA",
    width: 1600,
    height: 1067,
    sourceWidth: 6000,
    sourceHeight: 4000,
  }));
  mocked.getSettings.mockResolvedValue({
    theme: "light",
    weights: { sharpness: 0.6, exposure: 0.2, eyes: 0.2 },
    per_burst: 1,
    time_gap_s: 2,
    hamming_max: 22,
  });
  mocked.setSetting.mockImplementation(async (key, value) => ({ key, value }));
  mocked.setPick.mockImplementation(async (burstId, photoId, selected) => ({
    burst_id: burstId,
    photo_id: photoId,
    selected,
    source: "user" as const,
  }));
  mocked.confirmBurst.mockImplementation(async (burstId) => ({ burst_id: burstId, confirmed: 3 }));
  mocked.select.mockResolvedValue(RESULT);
});

function renderReview(overrides: Partial<Parameters<typeof ReviewScreen>[0]> = {}) {
  const props = {
    sessionId: "s1",
    initial: RESULT,
    immersive: false,
    onImmersiveChange: vi.fn(),
    onReset: vi.fn(),
    ...overrides,
  };
  render(<ReviewScreen {...props} />);
  return props;
}

const thumb = (name: string) => screen.getByRole("button", { name });

describe("the list of bursts", () => {
  it("has one button per burst, the progress, and the automatic picks marked", () => {
    renderReview();
    expect(screen.getByRole("button", { name: "Ráfaga 1 · 3 fotos" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ráfaga 2 · 2 fotos" })).toBeInTheDocument();
    expect(screen.getByText("Revisadas 0 de 2")).toBeInTheDocument();
    expect(screen.getAllByText("Elegida")).toHaveLength(1);
    expect(thumb("IMG_2.jpg, elegida")).toBeInTheDocument();
  });

  it("opens another burst, and the strip shows its photos", async () => {
    const user = userEvent.setup();
    renderReview();
    await user.click(screen.getByRole("button", { name: "Ráfaga 2 · 2 fotos" }));
    expect(thumb("IMG_4.ARW, elegida")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^IMG_1/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ráfaga 2 · 2 fotos" })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  it("moves between bursts with the keyboard", async () => {
    const user = userEvent.setup();
    renderReview();
    await user.keyboard("]");
    expect(thumb("IMG_4.ARW, elegida")).toBeInTheDocument();
    await user.keyboard("[["); // user-event writes a literal [ as [[
    expect(thumb("IMG_1.jpg, no elegida")).toBeInTheDocument();
  });

  it("goes back to choosing photos", async () => {
    const user = userEvent.setup();
    const { onReset } = renderReview();
    await user.click(screen.getByRole("button", { name: "Elegir otras fotos" }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});

describe("looking at the photos", () => {
  it("shows the photo you click without changing the pick", async () => {
    const user = userEvent.setup();
    renderReview();
    await user.click(thumb("IMG_3.jpg, no elegida"));
    expect(screen.getByText("3 de 3")).toBeInTheDocument();
    expect(mocked.setPick).not.toHaveBeenCalled();
    expect(thumb("IMG_3.jpg, no elegida")).toHaveAttribute("aria-current", "true");
  });

  it("moves with the arrow keys, keeping one thumbnail in the tab order", async () => {
    const user = userEvent.setup();
    renderReview();
    thumb("IMG_1.jpg, no elegida").focus();
    await user.keyboard("{ArrowRight}{ArrowRight}");
    expect(thumb("IMG_3.jpg, no elegida")).toHaveFocus();
    expect(thumb("IMG_3.jpg, no elegida")).toHaveAttribute("tabindex", "0");
    expect(thumb("IMG_1.jpg, no elegida")).toHaveAttribute("tabindex", "-1");
    expect(screen.getByText("3 de 3")).toBeInTheDocument();
  });

  it("shows the scores of the photo being viewed", async () => {
    renderReview();
    const scores = screen.getByRole("region", { name: "Puntuaciones" });
    expect(within(scores).getByText("sin rostro")).toBeInTheDocument();
    expect(within(scores).getByText("Nitidez relativa")).toBeInTheDocument();
  });

  it("asks for the big view of the photo on screen", async () => {
    renderReview();
    await waitFor(() =>
      expect(mocked.preview).toHaveBeenCalledWith("IMG_1", { maxPx: 1600, develop: false }),
    );
  });
});

describe("picking", () => {
  it("toggles the pick with Space and announces it", async () => {
    const user = userEvent.setup();
    renderReview();
    await user.click(thumb("IMG_3.jpg, no elegida"));
    await user.keyboard(" ");
    expect(mocked.setPick).toHaveBeenCalledWith("b1", "IMG_3", true);
    expect(thumb("IMG_3.jpg, elegida")).toBeInTheDocument();
    expect(screen.getAllByText("Elegida")).toHaveLength(2);
    expect(screen.getByText("IMG_3.jpg: elegida")).toBeInTheDocument();
  });

  it("toggles it with the button too, and the button says what it will do", async () => {
    const user = userEvent.setup();
    renderReview();
    await user.click(screen.getByRole("button", { name: "Elegir esta foto" }));
    expect(mocked.setPick).toHaveBeenCalledWith("b1", "IMG_1", true);
    await user.click(await screen.findByRole("button", { name: "Quitar elección" }));
    expect(mocked.setPick).toHaveBeenLastCalledWith("b1", "IMG_1", false);
  });

  it("puts the pick back and says so when it cannot be saved", async () => {
    const user = userEvent.setup();
    mocked.setPick.mockRejectedValue(new Error("engine down"));
    renderReview();
    await user.click(screen.getByRole("button", { name: "Elegir esta foto" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo guardar la elección.");
    expect(thumb("IMG_1.jpg, no elegida")).toBeInTheDocument();
  });

  it("leaves Space to a focused toolbar button", async () => {
    const user = userEvent.setup();
    renderReview();
    screen.getByRole("button", { name: "Comparar" }).focus();
    await user.keyboard(" ");
    expect(mocked.setPick).not.toHaveBeenCalled();
    expect(screen.getByText("Referencia")).toBeInTheDocument();
  });
});

describe("reviewing", () => {
  it("confirms a burst, keeps its picks and moves to the next one", async () => {
    const user = userEvent.setup();
    renderReview();
    await user.click(screen.getByRole("button", { name: "Confirmar ráfaga" }));
    expect(mocked.confirmBurst).toHaveBeenCalledWith("b1");
    expect(await screen.findByText("Revisadas 1 de 2")).toBeInTheDocument();
    expect(thumb("IMG_4.ARW, elegida")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Ráfaga 1 · 3 fotos" }));
    expect(thumb("IMG_2.jpg, elegida")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ráfaga revisada" })).toBeDisabled();
  });

  it("confirms with Enter from a thumbnail", async () => {
    const user = userEvent.setup();
    renderReview();
    thumb("IMG_1.jpg, no elegida").focus();
    await user.keyboard("{Enter}");
    expect(mocked.confirmBurst).toHaveBeenCalledWith("b1");
  });

  it("filters the bursts that are still to review", async () => {
    const user = userEvent.setup();
    renderReview();
    await user.click(screen.getByRole("button", { name: "Confirmar ráfaga" }));
    await user.click(screen.getByRole("radio", { name: /Sin revisar/ }));
    expect(screen.queryByRole("button", { name: "Ráfaga 1 · 3 fotos" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ráfaga 2 · 2 fotos" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirmar ráfaga" }));
    expect(await screen.findByText("Ya revisaste todas las ráfagas.")).toBeInTheDocument();
  });

  it("counts a burst as reviewed once the person changed a pick in it", () => {
    const touched = {
      bursts: [
        { ...RESULT.bursts[0], photos: [photo("IMG_1", true, 1, "jpg", "user")] },
        ...RESULT.bursts.slice(1),
      ].map((b) => ({ ...b, id: b.id, position: b.position, photos: b.photos })),
    };
    renderReview({ initial: touched as typeof RESULT });
    expect(screen.getByText("Revisadas 1 de 2")).toBeInTheDocument();
  });

  it("says when confirming fails", async () => {
    const user = userEvent.setup();
    mocked.confirmBurst.mockRejectedValue(new Error("engine down"));
    renderReview();
    await user.click(screen.getByRole("button", { name: "Confirmar ráfaga" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo confirmar la ráfaga.");
    expect(screen.getByText("Revisadas 0 de 2")).toBeInTheDocument();
  });
});

describe("zoom and compare", () => {
  it("compares two photos and lets you pin the one on the right", async () => {
    const user = userEvent.setup();
    renderReview();
    await user.keyboard("c");
    expect(screen.getByText("Referencia")).toBeInTheDocument();
    expect(screen.getByText("Esta foto")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Comparar" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await user.click(thumb("IMG_3.jpg, no elegida"));
    await user.click(screen.getByRole("button", { name: "Fijar como referencia" }));
    expect(screen.getAllByRole("img", { name: "Foto IMG_3.jpg" })).toHaveLength(2);
    await user.keyboard("{Escape}");
    expect(screen.queryByText("Referencia")).not.toBeInTheDocument();
  });

  it("loads the full-size photo once you zoom to 100 %", async () => {
    const user = userEvent.setup();
    renderReview();
    await user.click(screen.getByRole("button", { name: "Alternar entre ajustar y 100 %" }));
    await waitFor(() =>
      expect(mocked.preview).toHaveBeenCalledWith("IMG_1", { maxPx: 8192, develop: false }),
    );
    expect(
      screen.getByRole("button", { name: "Alternar entre ajustar y 100 %" }),
    ).not.toHaveTextContent(/^\d{1,2} %$/);
  });

  it("offers the high-resolution view only for RAW photos", async () => {
    const user = userEvent.setup();
    renderReview();
    expect(screen.queryByRole("button", { name: "Alta resolución" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Ráfaga 2 · 2 fotos" }));
    await user.click(screen.getByRole("button", { name: "Alta resolución" }));
    expect(screen.getByRole("button", { name: "Alta resolución" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await waitFor(() =>
      expect(mocked.preview).toHaveBeenCalledWith("IMG_4", { maxPx: 8192, develop: true }),
    );
  });
});

describe("the side panel and full screen", () => {
  it("saves the per-burst count and selects again", async () => {
    const user = userEvent.setup();
    renderReview();
    await waitFor(() => expect(mocked.getSettings).toHaveBeenCalled());
    const count = screen.getByRole("spinbutton", { name: "Fotos por ráfaga" });
    await user.clear(count);
    await user.type(count, "2");
    await user.click(screen.getByRole("button", { name: "Aplicar" }));
    await waitFor(() => expect(mocked.select).toHaveBeenCalledWith("s1"));
    expect(mocked.setSetting).toHaveBeenCalledWith("per_burst", 2);
    for (const name of ["Peso de nitidez", "Peso de exposición", "Peso de ojos abiertos"]) {
      expect(screen.getByRole("slider", { name })).toBeInTheDocument();
    }
  });

  it("refuses a count outside 1 to 20", async () => {
    const user = userEvent.setup();
    renderReview();
    await waitFor(() => expect(mocked.getSettings).toHaveBeenCalled());
    const count = screen.getByRole("spinbutton", { name: "Fotos por ráfaga" });
    await user.clear(count);
    await user.type(count, "40");
    await user.click(screen.getByRole("button", { name: "Aplicar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("del 1 al 20");
    expect(mocked.select).not.toHaveBeenCalled();
  });

  it("hides and shows the panel", async () => {
    const user = userEvent.setup();
    renderReview();
    expect(screen.getByRole("button", { name: "Exportar elegidas" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Panel lateral" }));
    expect(screen.queryByRole("button", { name: "Exportar elegidas" })).not.toBeInTheDocument();
  });

  it("asks for full screen with F and leaves it with Escape", async () => {
    const user = userEvent.setup();
    const { onImmersiveChange } = renderReview();
    await user.keyboard("f");
    expect(onImmersiveChange).toHaveBeenLastCalledWith(true);
  });

  it("shows only the photo while immersive, and gives the screen back on Escape", async () => {
    const user = userEvent.setup();
    const { onImmersiveChange } = renderReview({ immersive: true });
    expect(screen.queryByRole("navigation", { name: "Ráfagas" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Exportar elegidas" })).not.toBeInTheDocument();
    expect(vi.mocked(setFullscreen)).toHaveBeenCalledWith(true);
    await user.keyboard("{Escape}");
    expect(onImmersiveChange).toHaveBeenLastCalledWith(false);
  });
});
