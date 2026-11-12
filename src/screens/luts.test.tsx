import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as engine from "../lib/engine.ts";
import { summarizeLuts } from "../lib/lutSummary.ts";
import { previews } from "../lib/previews.ts";
import { RESULT } from "./fixtures.ts";
import { ReviewScreen } from "./ReviewScreen.tsx";

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
    addLuts: vi.fn(),
    addLutFolder: vi.fn(),
    pickFolder: vi.fn(),
    removeLut: vi.fn(),
    updateLut: vi.fn(),
    renameLutGroup: vi.fn(),
    removeLutGroup: vi.fn(),
    pickLuts: vi.fn(),
  };
});
vi.mock("../lib/window.ts", () => ({ setFullscreen: vi.fn() }));

const mocked = vi.mocked(engine);
const WARM = { id: "l1", name: "Cálido", size: 33, group: null, favorite: false };

beforeEach(() => {
  vi.clearAllMocks();
  previews.clear();
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
});

async function openLuts() {
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
  await user.click(screen.getByRole("button", { name: "LUT…" }));
  return { user, dialog: await screen.findByRole("dialog", { name: "Biblioteca de LUT" }) };
}

describe("the LUT library", () => {
  it("lists the LUTs kept in the program", async () => {
    const { dialog } = await openLuts();
    expect(await within(dialog).findByText("Cálido")).toBeInTheDocument();
    expect(within(dialog).getByText("33×33×33")).toBeInTheDocument();
  });

  const NEW = [
    { id: "l2", name: "Frío", size: 17, group: null, favorite: false },
    { id: "l3", name: "Cine", size: 33, group: null, favorite: false },
  ];

  it("loads several files picked at once and says they stay in the program", async () => {
    mocked.pickLuts.mockResolvedValue(["C:\\looks\\Frio.cube", "C:\\looks\\Cine.cube"]);
    mocked.addLuts.mockResolvedValue({ added: NEW, duplicates: [], failed: [] });
    const { user, dialog } = await openLuts();
    mocked.listLuts.mockResolvedValue([WARM, ...NEW]);
    await user.click(within(dialog).getByRole("button", { name: "Cargar LUT…" }));
    expect(mocked.addLuts).toHaveBeenCalledWith(["C:\\looks\\Frio.cube", "C:\\looks\\Cine.cube"]);
    expect(await within(dialog).findByText(/Se cargaron 2 LUT\. Quedan guardados/)).toBeVisible();
    expect(await within(dialog).findByText("Frío")).toBeInTheDocument();
    expect(await within(dialog).findByText("Cine")).toBeInTheDocument();
  });

  it("says what went in, what was repeated and what was not valid", async () => {
    mocked.pickLuts.mockResolvedValue(["a", "b", "c", "d"]);
    mocked.addLuts.mockResolvedValue({
      added: [NEW[0] as engine.LutInfo],
      duplicates: [{ path: "C:\\looks\\b.cube", name: "Cálido", renamed: false }],
      failed: [{ path: "C:\\looks\\roto.cube", message: "invalid .cube file" }],
    });
    const { user, dialog } = await openLuts();
    await user.click(within(dialog).getByRole("button", { name: "Cargar LUT…" }));
    expect(await within(dialog).findByRole("status")).toHaveTextContent(
      "Se cargó Frío. 1 ya estaba. 1 no era válido: roto.cube. Quedan guardados en el programa.",
    );
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows an error when none of the files could be loaded", async () => {
    mocked.pickLuts.mockResolvedValue(["a", "b"]);
    mocked.addLuts.mockResolvedValue({
      added: [],
      duplicates: [],
      failed: [
        { path: "C:\\looks\\uno.cube", message: "bad" },
        { path: "C:\\looks\\dos.cube", message: "bad" },
      ],
    });
    const { user, dialog } = await openLuts();
    await user.click(within(dialog).getByRole("button", { name: "Cargar LUT…" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "2 no eran válidos: uno.cube, dos.cube.",
    );
  });

  it("loads a whole folder", async () => {
    mocked.pickFolder.mockResolvedValue("C:\\looks");
    mocked.addLutFolder.mockResolvedValue({ added: NEW, duplicates: [], failed: [] });
    const { user, dialog } = await openLuts();
    await user.click(within(dialog).getByRole("button", { name: "Cargar carpeta…" }));
    expect(mocked.addLutFolder).toHaveBeenCalledWith("C:\\looks");
    expect(await within(dialog).findByText(/Se cargaron 2 LUT/)).toBeVisible();
  });

  it("does nothing when the file or folder dialog is cancelled", async () => {
    mocked.pickLuts.mockResolvedValue(null);
    mocked.pickFolder.mockResolvedValue(null);
    const { user, dialog } = await openLuts();
    await user.click(within(dialog).getByRole("button", { name: "Cargar LUT…" }));
    await user.click(within(dialog).getByRole("button", { name: "Cargar carpeta…" }));
    expect(mocked.addLuts).not.toHaveBeenCalled();
    expect(mocked.addLutFolder).not.toHaveBeenCalled();
  });

  it("keeps the list in name order", async () => {
    mocked.listLuts.mockResolvedValue([
      { id: "z", name: "Zeta", size: 3, group: null, favorite: false },
      { id: "a", name: "alfa", size: 3, group: null, favorite: false },
      { id: "m", name: "Medio", size: 3, group: null, favorite: false },
    ]);
    const { dialog } = await openLuts();
    await within(dialog).findByText("Zeta");
    const names = within(within(dialog).getByRole("list", { name: "LUT guardados" }))
      .getAllByRole("listitem")
      .map((item) => item.textContent?.replace(/3×3×3.*/, ""));
    expect(names).toEqual(["alfa", "Medio", "Zeta"]);
  });

  it("lists each LUT with a button to remove it", async () => {
    mocked.removeLut.mockResolvedValue({ lut_id: "l1" });
    const { user, dialog } = await openLuts();
    await within(dialog).findByText("Cálido");
    mocked.listLuts.mockResolvedValue([]);
    await user.click(within(dialog).getByRole("button", { name: "Quitar Cálido" }));
    expect(mocked.removeLut).toHaveBeenCalledWith("l1");
    expect(await within(dialog).findByText("Aún no has cargado ningún LUT.")).toBeInTheDocument();
  });

  it("closes with Escape and leaves the review keys working again", async () => {
    const { user } = await openLuts();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("the LUT library, ordered", () => {
  const A = { id: "a", name: "Aurora", size: 3, group: "Boda", favorite: false };
  const B = { id: "b", name: "Brisa", size: 3, group: "Boda", favorite: false };
  const C = { id: "c", name: "Cine", size: 3, group: null, favorite: false };

  it("keeps a loaded folder as a sub-list with its count", async () => {
    mocked.listLuts.mockResolvedValue([A, B, C]);
    const { dialog } = await openLuts();
    expect(await within(dialog).findByText("Aurora")).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Cambiar el nombre del grupo Boda" }),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("2")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Plegar Boda" }));
    expect(within(dialog).queryByText("Aurora")).not.toBeInTheDocument();
    expect(within(dialog).getByText("Cine")).toBeInTheDocument();
  });

  it("marks a favourite, renames and moves a LUT", async () => {
    mocked.listLuts.mockResolvedValue([A, C]);
    mocked.updateLut.mockImplementation(async (id, changes) => ({
      ...(id === "a" ? A : C),
      ...changes,
    }));
    const { user, dialog } = await openLuts();
    await user.click(
      await within(dialog).findByRole("button", { name: "Marcar como favorito Cine" }),
    );
    expect(mocked.updateLut).toHaveBeenCalledWith("c", { favorite: true });
    expect(
      await within(dialog).findByRole("button", { name: "Quitar de favoritos Cine" }),
    ).toHaveAttribute("aria-pressed", "true");

    await user.selectOptions(
      within(dialog).getByRole("combobox", { name: "Grupo de Cine" }),
      "Boda",
    );
    expect(mocked.updateLut).toHaveBeenCalledWith("c", { group: "Boda" });

    await user.click(within(dialog).getByRole("button", { name: "Cambiar el nombre de Aurora" }));
    await user.keyboard("{Control>}a{/Control}Alba{Enter}");
    expect(mocked.updateLut).toHaveBeenCalledWith("a", { name: "Alba" });
    expect(await within(dialog).findByText("Alba")).toBeInTheDocument();
  });

  it("asks before removing a whole group", async () => {
    mocked.listLuts.mockResolvedValue([A, B]);
    mocked.removeLutGroup.mockResolvedValue({ removed: 2 });
    const { user, dialog } = await openLuts();
    await user.click(await within(dialog).findByRole("button", { name: "Quitar el grupo Boda" }));
    expect(mocked.removeLutGroup).not.toHaveBeenCalled();
    mocked.listLuts.mockResolvedValue([]);
    await user.click(within(dialog).getByRole("button", { name: "Quitar grupo" }));
    expect(mocked.removeLutGroup).toHaveBeenCalledWith("Boda");
    expect(await within(dialog).findByText("Se quitó el grupo Boda (2 LUT).")).toBeInTheDocument();
  });
});

describe("summarizeLuts", () => {
  it("counts the ones that were renamed", () => {
    const duplicates = [{ path: "x", name: "A", renamed: true }];
    expect(summarizeLuts({ added: [], duplicates, failed: [] })).toBe(
      "1 ya estaba. 1 se renombró.",
    );
  });

  const lut = (name: string) => ({ id: name, name, size: 3, group: null, favorite: false });

  it("handles every mix", () => {
    expect(summarizeLuts({ added: [lut("A")], duplicates: [], failed: [] })).toBe(
      "Se cargó A. Quedan guardados en el programa.",
    );
    expect(
      summarizeLuts({
        added: [],
        duplicates: [{ path: "x", name: "A", renamed: false }],
        failed: [],
      }),
    ).toBe("1 ya estaba.");
    expect(
      summarizeLuts({
        added: [],
        duplicates: [
          { path: "x", name: "A", renamed: false },
          { path: "y", name: "B", renamed: false },
        ],
        failed: [],
      }),
    ).toBe("2 ya estaban.");
    expect(summarizeLuts({ added: [], duplicates: [], failed: [] })).toBe("No había LUT nuevos.");
  });

  it("names up to three broken files and counts the rest", () => {
    const failed = ["a", "b", "c", "d", "e"].map((n) => ({
      path: `C:\\x\\${n}.cube`,
      message: "",
    }));
    expect(summarizeLuts({ added: [], duplicates: [], failed })).toBe(
      "5 no eran válidos: a.cube, b.cube, c.cube y 2 más.",
    );
  });
});
