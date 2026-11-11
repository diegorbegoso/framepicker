import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as engine from "../lib/engine.ts";
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
    addLut: vi.fn(),
    removeLut: vi.fn(),
    pickLut: vi.fn(),
  };
});
vi.mock("../lib/window.ts", () => ({ setFullscreen: vi.fn() }));

const mocked = vi.mocked(engine);
const WARM = { id: "l1", name: "Cálido", size: 33 };

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

  it("loads a .cube file once and says it stays in the program", async () => {
    mocked.pickLut.mockResolvedValue("C:\\looks\\Frio.cube");
    mocked.addLut.mockResolvedValue({ id: "l2", name: "Frío", size: 17 });
    const { user, dialog } = await openLuts();
    mocked.listLuts.mockResolvedValue([WARM, { id: "l2", name: "Frío", size: 17 }]);
    await user.click(within(dialog).getByRole("button", { name: "Cargar LUT (.cube)…" }));
    expect(mocked.addLut).toHaveBeenCalledWith("C:\\looks\\Frio.cube");
    expect(await within(dialog).findByText(/Queda guardado en el programa/)).toBeInTheDocument();
    expect(await within(dialog).findByText("Frío")).toBeInTheDocument();
  });

  it("explains when the file is not a valid LUT", async () => {
    mocked.pickLut.mockResolvedValue("C:\\looks\\roto.cube");
    mocked.addLut.mockRejectedValue(new engine.EngineError(-32602, "invalid .cube file"));
    const { user, dialog } = await openLuts();
    await user.click(within(dialog).getByRole("button", { name: "Cargar LUT (.cube)…" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Ese archivo no es un LUT 3D .cube válido.",
    );
  });

  it("does nothing when the file dialog is cancelled", async () => {
    mocked.pickLut.mockResolvedValue(null);
    const { user, dialog } = await openLuts();
    await user.click(within(dialog).getByRole("button", { name: "Cargar LUT (.cube)…" }));
    expect(mocked.addLut).not.toHaveBeenCalled();
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
