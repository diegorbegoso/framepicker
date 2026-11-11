import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as engine from "../lib/engine.ts";
import { EngineError, type EngineEvent } from "../lib/engine.ts";
import { RESULT } from "./fixtures.ts";
import { HomeScreen } from "./HomeScreen.tsx";

vi.mock("../lib/engine.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/engine.ts")>();
  return {
    ...actual,
    scan: vi.fn(),
    analyze: vi.fn(),
    cancel: vi.fn(),
    select: vi.fn(),
    setPick: vi.fn(),
    preview: vi.fn(),
    getSettings: vi.fn(),
    setSetting: vi.fn(),
    pickFolder: vi.fn(),
    pickFiles: vi.fn(),
    onEngineEvent: vi.fn(),
    exportSelection: vi.fn(),
  };
});

const mocked = vi.mocked(engine);

let emit: (event: EngineEvent) => void = () => undefined;

beforeEach(() => {
  vi.clearAllMocks();
  mocked.onEngineEvent.mockImplementation(async (callback) => {
    emit = callback;
    return () => undefined;
  });
  mocked.getSettings.mockResolvedValue({
    theme: "light",
    weights: { sharpness: 0.6, exposure: 0.2, eyes: 0.2 },
    per_burst: 1,
    min_quality: { sharpness: 90, exposure: 0.55, eyes: 0.4 },
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
  mocked.select.mockResolvedValue(RESULT);
});

describe("HomeScreen", () => {
  it("shows progress and hands the selection over when the job is done", async () => {
    const user = userEvent.setup();
    const onResult = vi.fn();
    mocked.pickFolder.mockResolvedValue("C:\\fotos");
    mocked.scan.mockResolvedValue({
      session_id: "s1",
      photos: ["a", "b", "c"].map((id) => ({
        id,
        path: `C:\\fotos\\${id}.jpg`,
        format: "jpg" as const,
        size_bytes: 1,
      })),
      skipped: 0,
    });
    mocked.analyze.mockResolvedValue({ job_id: "j1" });
    render(<HomeScreen onResult={onResult} />);
    await waitFor(() => expect(mocked.onEngineEvent).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: "Elegir carpeta" }));
    expect(mocked.scan).toHaveBeenCalledWith(["C:\\fotos"]);
    await waitFor(() => expect(mocked.analyze).toHaveBeenCalledWith("s1"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Cancelar" })).toBeEnabled());

    act(() =>
      emit({ method: "progress", params: { job_id: "j1", kind: "analyze", done: 1, total: 3 } }),
    );
    const bar = screen.getByRole("progressbar", { name: "Analizando 1 de 3 fotos" });
    expect(bar).toHaveAttribute("aria-valuenow", "1");
    expect(bar).toHaveAttribute("aria-valuemax", "3");
    expect(screen.getByText("Analizando 1 de 3 fotos")).toBeVisible();

    act(() =>
      emit({
        method: "job_done",
        params: { job_id: "j1", kind: "analyze", state: "done", computed: 3, cached: 0, failed: 0 },
      }),
    );
    await waitFor(() => expect(onResult).toHaveBeenCalledWith("s1", RESULT));
  });

  it("shows that it is preparing and blocks a second click while the engine answers", async () => {
    const user = userEvent.setup();
    let answer: (path: string | null) => void = () => undefined;
    mocked.pickFolder.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    render(<HomeScreen onResult={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Elegir carpeta" }));
    expect(screen.getByRole("status")).toHaveTextContent("Preparando tu selección…");
    expect(screen.getByRole("button", { name: "Elegir carpeta" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Elegir archivos" })).toBeDisabled();
    act(() => answer(null));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Elegir carpeta" })).toBeEnabled(),
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(mocked.scan).not.toHaveBeenCalled();
  });

  it("explains a folder that is not allowed", async () => {
    const user = userEvent.setup();
    mocked.pickFolder.mockResolvedValue("C:\\otra");
    mocked.scan.mockRejectedValue(new EngineError(-32010, "path not allowed"));
    render(<HomeScreen onResult={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Elegir carpeta" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Esa carpeta no está permitida. Elígela de nuevo con el botón.",
    );
  });

  it("says when nothing compatible was found and shows no bursts", async () => {
    const user = userEvent.setup();
    const onResult = vi.fn();
    mocked.pickFiles.mockResolvedValue(["C:\\fotos\\notas.txt"]);
    mocked.scan.mockResolvedValue({ session_id: "s2", photos: [], skipped: 1 });
    render(<HomeScreen onResult={onResult} />);
    await user.click(screen.getByRole("button", { name: "Elegir archivos" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No encontré fotos compatibles en esa selección.",
    );
    expect(mocked.analyze).not.toHaveBeenCalled();
    expect(onResult).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /^Ráfaga/ })).not.toBeInTheDocument();
  });
});
