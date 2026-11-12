import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as engine from "../lib/engine.ts";
import { type Adjustments, type LutInfo, NEUTRAL } from "../lib/engine.ts";
import { clearThumbs } from "../lib/lutThumbs.ts";
import { LutGallery } from "./review/lut/LutGallery.tsx";

vi.mock("../lib/engine.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/engine.ts")>();
  return { ...actual, preview: vi.fn(), updateLut: vi.fn() };
});

const mocked = vi.mocked(engine);
const lut = (id: string, name: string, group: string | null = null, favorite = false): LutInfo => ({
  id,
  name,
  size: 33,
  group,
  favorite,
});
const LUTS = [
  lut("a", "Aurora", "Boda"),
  lut("b", "Brisa", "Boda", true),
  lut("c", "Cine"),
  lut("d", "Álamo", "Retrato"),
];

beforeEach(() => {
  vi.clearAllMocks();
  clearThumbs();
  mocked.preview.mockImplementation(async (_photoId, options) => ({
    url: `data:image/jpeg;base64,${options?.adjustments?.lut_id ?? "none"}`,
    width: 140,
    height: 93,
    sourceWidth: 6000,
    sourceHeight: 4000,
  }));
});

function setup(current: Adjustments = NEUTRAL, luts = LUTS) {
  const handlers = {
    onChange: vi.fn(),
    onHover: vi.fn(),
    onFavorite: vi.fn(),
    onClose: vi.fn(),
  };
  const user = userEvent.setup();
  render(<LutGallery photoId="IMG_2" current={current} luts={luts} {...handlers} />);
  return { user, ...handlers };
}

describe("the LUT gallery", () => {
  it("shows every LUT on the photo itself, small, with no LUT first", async () => {
    setup();
    const dialog = screen.getByRole("dialog", { name: "Elegir LUT" });
    await waitFor(() => expect(mocked.preview).toHaveBeenCalledTimes(5));
    expect(mocked.preview).toHaveBeenCalledWith("IMG_2", {
      maxPx: 140,
      adjustments: { ...NEUTRAL, lut_id: "a", lut_strength: 1 },
    });
    const names = within(dialog)
      .getAllByRole("button")
      .filter((button) => button.hasAttribute("data-lut-tile"))
      .map((button) => button.getAttribute("aria-label"));
    expect(names[0]).toBe("Ninguno");
    expect(names).toContain("Aurora");
  });

  it("puts favourites first and keeps folders as groups", () => {
    setup();
    const dialog = screen.getByRole("dialog", { name: "Elegir LUT" });
    expect(within(dialog).getByRole("button", { name: "Favoritos" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Boda (2)" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Retrato (1)" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /Sueltos \(1\)/ })).toBeInTheDocument();
  });

  it("searches by name or group, ignoring accents", async () => {
    const { user } = setup();
    const dialog = screen.getByRole("dialog", { name: "Elegir LUT" });
    await user.type(screen.getByRole("searchbox", { name: "Buscar LUT" }), "alamo");
    expect(within(dialog).getByRole("button", { name: "Álamo" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Aurora" })).toBeNull();
    await user.clear(screen.getByRole("searchbox", { name: "Buscar LUT" }));
    await user.type(screen.getByRole("searchbox", { name: "Buscar LUT" }), "boda");
    expect(within(dialog).getByRole("button", { name: "Aurora" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Cine" })).toBeNull();
    await user.clear(screen.getByRole("searchbox", { name: "Buscar LUT" }));
    await user.type(screen.getByRole("searchbox", { name: "Buscar LUT" }), "zzz");
    expect(await screen.findByText("Ningún LUT coincide con la búsqueda.")).toBeVisible();
  });

  it("applies a LUT with one click and marks the one in use", async () => {
    const { user, onChange } = setup({ ...NEUTRAL, lut_id: "c" });
    const dialog = screen.getByRole("dialog", { name: "Elegir LUT" });
    expect(within(dialog).getByRole("button", { name: "Cine" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await user.click(within(dialog).getAllByRole("button", { name: "Aurora" })[0] as HTMLElement);
    expect(onChange).toHaveBeenCalledWith({ lut_id: "a" });
    await user.click(within(dialog).getByRole("button", { name: "Ninguno" }));
    expect(onChange).toHaveBeenLastCalledWith({ lut_id: null });
  });

  it("shows a LUT on the photo while the cursor is on it, and stops afterwards", async () => {
    const { user, onHover } = setup();
    const tile = screen.getAllByRole("button", { name: "Aurora" })[0] as HTMLElement;
    await user.hover(tile);
    expect(onHover).toHaveBeenCalledWith("a");
    await user.unhover(tile);
    await waitFor(() => expect(onHover).toHaveBeenLastCalledWith(undefined));
  });

  it("moves between tiles with the arrow keys, marks a favourite with F and closes with Esc", async () => {
    const { user, onFavorite, onClose } = setup();
    const none = screen.getByRole("button", { name: "Ninguno" });
    none.focus();
    await user.keyboard("{ArrowRight}");
    const second = document.activeElement as HTMLElement;
    expect(second).not.toBe(none);
    expect(second).toHaveAttribute("data-lut-tile");
    await user.keyboard("f");
    expect(onFavorite).toHaveBeenCalledTimes(1);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("jumps to the search box with /", async () => {
    const { user } = setup();
    (screen.getByRole("button", { name: "Ninguno" }) as HTMLElement).focus();
    await user.keyboard("/");
    expect(screen.getByRole("searchbox", { name: "Buscar LUT" })).toHaveFocus();
  });

  it("sets the strength of the LUT in use", async () => {
    const { user, onChange } = setup({ ...NEUTRAL, lut_id: "a", lut_strength: 1 });
    const field = screen.getByRole("spinbutton", { name: "Intensidad del LUT (valor)" });
    await user.click(field);
    await user.keyboard("{Control>}a{/Control}40");
    expect(onChange).toHaveBeenLastCalledWith({ lut_strength: 0.4 });
  });

  it("says so when there are no LUTs yet", () => {
    setup(NEUTRAL, []);
    expect(screen.getByText(/Aún no has cargado ningún LUT/)).toBeVisible();
  });

  it("does not ask the engine again for thumbnails it already drew", async () => {
    const first = setup();
    await waitFor(() => expect(mocked.preview).toHaveBeenCalledTimes(5));
    first.onClose();
    act(() => undefined);
    document.body.innerHTML = "";
    mocked.preview.mockClear();
    setup();
    await waitFor(() => expect(document.querySelectorAll("img").length).toBeGreaterThan(0));
    expect(mocked.preview).not.toHaveBeenCalled();
  });
});
