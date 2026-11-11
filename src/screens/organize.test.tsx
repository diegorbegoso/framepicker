import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as engine from "../lib/engine.ts";
import { EngineError } from "../lib/engine.ts";
import { OrganizeDialog } from "./dialogs/OrganizeDialog.tsx";

vi.mock("../lib/engine.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/engine.ts")>();
  return {
    ...actual,
    organizePreview: vi.fn(),
    organizeApply: vi.fn(),
    organizeUndo: vi.fn(),
  };
});

const mocked = vi.mocked(engine);

const PREVIEW = {
  to_move: 3,
  sidecars: 1,
  kept: 2,
  kept_paired: 0,
  already: 0,
  folders: ["C:\\boda\\No elegidas"],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocked.organizePreview.mockResolvedValue(PREVIEW);
});

function open(batchId: string | null = null) {
  const onBatch = vi.fn();
  const user = userEvent.setup();
  render(<OrganizeDialog sessionId="s1" batchId={batchId} onBatch={onBatch} onClose={vi.fn()} />);
  return { user, onBatch };
}

describe("OrganizeDialog", () => {
  it("says what will happen before anything moves, and that nothing is deleted", async () => {
    open();
    const summary = await screen.findByRole("list", { name: "Qué va a pasar" });
    expect(within(summary).getByText(/2 fotos elegidas se quedan/)).toBeInTheDocument();
    expect(within(summary).getByText(/3 fotos se mueven/)).toBeInTheDocument();
    expect(within(summary).getByText(/1 archivo \.xmp/)).toBeInTheDocument();
    expect(screen.getByText("No borra nada")).toBeInTheDocument();
    expect(mocked.organizeApply).not.toHaveBeenCalled();
    expect(mocked.organizePreview).toHaveBeenCalledWith("s1", "No elegidas");
  });

  it("moves only when asked, and offers to undo it", async () => {
    mocked.organizeApply.mockResolvedValue({ batch_id: "b1", moved: 4, failed: 0, errors: [] });
    const { user, onBatch } = open();
    await user.click(await screen.findByRole("button", { name: "Mover 3 fotos" }));
    expect(mocked.organizeApply).toHaveBeenCalledWith("s1", "No elegidas");
    expect(onBatch).toHaveBeenCalledWith("b1");
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Listo: se movieron 4 archivos a «No elegidas».",
    );
  });

  it("uses the folder name the person types", async () => {
    mocked.organizeApply.mockResolvedValue({ batch_id: "b1", moved: 1, failed: 0, errors: [] });
    const { user } = open();
    const field = await screen.findByLabelText("Nombre de la subcarpeta");
    await user.clear(field);
    await user.type(field, "Descartes");
    await waitFor(() => expect(mocked.organizePreview).toHaveBeenLastCalledWith("s1", "Descartes"));
    await user.click(await screen.findByRole("button", { name: "Mover 3 fotos" }));
    expect(mocked.organizeApply).toHaveBeenCalledWith("s1", "Descartes");
  });

  it("undoes the last organisation and says how many went back", async () => {
    mocked.organizeUndo.mockResolvedValue({ batch_id: "b1", restored: 4, skipped: 1 });
    const { user, onBatch } = open("b1");
    await user.click(await screen.findByRole("button", { name: "Deshacer" }));
    expect(mocked.organizeUndo).toHaveBeenCalledWith("b1");
    expect(onBatch).toHaveBeenCalledWith(null);
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Se devolvieron 4 archivos a su lugar. 1 archivo se dejó donde estaba.",
    );
  });

  it("offers no undo when there is nothing to undo", async () => {
    open();
    await screen.findByRole("list", { name: "Qué va a pasar" });
    expect(screen.queryByRole("button", { name: "Deshacer" })).not.toBeInTheDocument();
  });

  it("has nothing to move when every photo is chosen", async () => {
    mocked.organizePreview.mockResolvedValue({ ...PREVIEW, to_move: 0, sidecars: 0 });
    open();
    expect(await screen.findByRole("button", { name: "No hay nada que mover" })).toBeDisabled();
  });

  it("explains paired RAW and JPG files that stay", async () => {
    mocked.organizePreview.mockResolvedValue({ ...PREVIEW, kept_paired: 2 });
    open();
    expect(await screen.findByText(/2 fotos no elegidas se quedan/)).toBeInTheDocument();
  });

  it("explains a folder that is not allowed and a bad name", async () => {
    mocked.organizeApply.mockRejectedValue(new EngineError(engine.PATH_NOT_ALLOWED, "no"));
    const { user } = open();
    await user.click(await screen.findByRole("button", { name: "Mover 3 fotos" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Esa carpeta ya no está permitida. Vuelve a elegirla desde Inicio.",
    );
    mocked.organizePreview.mockRejectedValue(new EngineError(-32602, "bad name"));
    await user.type(screen.getByLabelText("Nombre de la subcarpeta"), "?");
    expect(await screen.findByText("Ese nombre de carpeta no es válido.")).toBeInTheDocument();
  });
});
