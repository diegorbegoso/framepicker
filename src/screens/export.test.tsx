import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as engine from "../lib/engine.ts";
import { EngineError, type EngineEvent } from "../lib/engine.ts";
import { ExportDialog } from "./dialogs/ExportDialog.tsx";
import type { Scope, ScopeIds } from "./review/scopes.ts";

vi.mock("../lib/engine.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/engine.ts")>();
  return {
    ...actual,
    getSettings: vi.fn(),
    setSetting: vi.fn(),
    listLuts: vi.fn(),
    pickFolder: vi.fn(),
    onEngineEvent: vi.fn(),
    exportSelection: vi.fn(),
  };
});

const mocked = vi.mocked(engine);
let emit: (event: EngineEvent) => void = () => undefined;

const COPY = {
  format: "original" as const,
  long_edge: 0,
  quality: 92,
  apply_edits: true,
  name_pattern: "{name}",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocked.onEngineEvent.mockImplementation(async (callback) => {
    emit = callback;
    return () => undefined;
  });
  mocked.getSettings.mockRejectedValue(new Error("no stored options"));
  mocked.setSetting.mockImplementation(async (key, value) => ({ key, value }));
  mocked.listLuts.mockResolvedValue([{ id: "l1", name: "Cálido", size: 33 }]);
});

const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`);

function open(picked = 4, initialScope: Scope = "picked") {
  const user = userEvent.setup();
  const scopes: ScopeIds = {
    current: ["p0"],
    burst: ids(3),
    picked: ids(picked),
    marked: ids(2),
    all: ids(10),
  };
  render(
    <ExportDialog sessionId="s1" scopes={scopes} initialScope={initialScope} onClose={vi.fn()} />,
  );
  return user;
}

const exportEvent = (method: "progress" | "job_done", a: number, b = 0): EngineEvent =>
  method === "progress"
    ? { method, params: { job_id: "e1", kind: "export", done: a, total: b } }
    : { method, params: { job_id: "e1", kind: "export", state: "done", failed: 0, copied: a } };

describe("ExportDialog", () => {
  it("copies the originals by default and reports progress and success", async () => {
    const user = open();
    mocked.pickFolder.mockResolvedValue("D:Elegidas");
    mocked.exportSelection.mockResolvedValue({ job_id: "e1" });
    await waitFor(() => expect(mocked.onEngineEvent).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: "Elegir carpeta y exportar" }));
    await waitFor(() =>
      expect(mocked.exportSelection).toHaveBeenCalledWith("s1", "D:Elegidas", COPY, undefined),
    );
    act(() => emit(exportEvent("progress", 2, 4)));
    expect(screen.getByText("Copiando 2 de 4")).toBeInTheDocument();
    act(() => emit(exportEvent("job_done", 4)));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Se copiaron 4 fotos a D:Elegidas. Tus originales no se tocaron.",
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("sends the format, size, quality and LUT it was given, and remembers them", async () => {
    const user = open();
    mocked.pickFolder.mockResolvedValue("D:Web");
    mocked.exportSelection.mockResolvedValue({ job_id: "e1" });
    const dialog = screen.getByRole("dialog", { name: "Exportar fotos" });
    await user.selectOptions(within(dialog).getByLabelText("Qué exportar"), "Esta ráfaga (3)");
    await user.click(within(dialog).getByRole("radio", { name: "JPG" }));
    await user.selectOptions(within(dialog).getByLabelText("Lado mayor"), "2048");
    await user.click(within(dialog).getByRole("checkbox", { name: /Aplicar las correcciones/ }));
    fireRange(within(dialog).getByRole("slider", { name: "Calidad" }), 80);
    await user.click(within(dialog).getByRole("button", { name: "Elegir carpeta y exportar" }));
    const expected = {
      format: "jpg",
      long_edge: 2048,
      quality: 80,
      apply_edits: false,
      name_pattern: "{name}",
    };
    await waitFor(() =>
      expect(mocked.exportSelection).toHaveBeenCalledWith("s1", "D:Web", expected, [
        "p0",
        "p1",
        "p2",
      ]),
    );
    expect(mocked.setSetting).toHaveBeenCalledWith("export_options", expected);
    act(() => emit(exportEvent("job_done", 4)));
    expect(await screen.findByText(/Se exportaron 4 fotos a D:Web\./)).toBeInTheDocument();
  });

  it("starts from the options remembered last time", async () => {
    mocked.getSettings.mockResolvedValue({
      theme: "light",
      weights: { sharpness: 0.6, exposure: 0.2, eyes: 0.2 },
      per_burst: 1,
      min_quality: { sharpness: 90, exposure: 0.55, eyes: 0.4 },
      time_gap_s: 2,
      hamming_max: 22,
      export_options: { ...COPY, format: "webp", long_edge: 3000, quality: 70 },
    });
    open();
    expect(await screen.findByRole("radio", { name: "WebP" })).toBeChecked();
    expect(screen.getByLabelText("Lado mayor")).toHaveValue("3000");
  });

  it("only offers a quality for formats that have one, and a file name when it re-encodes", async () => {
    const user = open();
    expect(screen.queryByRole("slider", { name: "Calidad" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Nombre del archivo")).not.toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "PNG" }));
    expect(screen.queryByRole("slider", { name: "Calidad" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Nombre del archivo")).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "JPG" }));
    expect(screen.getByRole("slider", { name: "Calidad" })).toBeInTheDocument();
  });

  it("explains a destination inside the source folder", async () => {
    const user = open(2);
    mocked.pickFolder.mockResolvedValue("C:\\fotos\\sub");
    mocked.exportSelection.mockRejectedValue(new EngineError(-32014, "dest inside source"));
    await user.click(screen.getByRole("button", { name: "Elegir carpeta y exportar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Esa carpeta está dentro de la carpeta de origen. Elige otra.",
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("is disabled with a hint when nothing is chosen", () => {
    open(0);
    expect(screen.getByRole("button", { name: "Elegir carpeta y exportar" })).toBeDisabled();
    expect(screen.getByText("No hay fotos para exportar con esta opción.")).toBeInTheDocument();
  });

  it("does nothing when the folder dialog is cancelled", async () => {
    const user = open(3);
    mocked.pickFolder.mockResolvedValue(null);
    await user.click(screen.getByRole("button", { name: "Elegir carpeta y exportar" }));
    await waitFor(() => expect(mocked.pickFolder).toHaveBeenCalled());
    expect(mocked.exportSelection).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Elegir carpeta y exportar" })).toBeEnabled();
  });
});

function fireRange(slider: HTMLElement, value: number) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(slider, String(value));
    slider.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
