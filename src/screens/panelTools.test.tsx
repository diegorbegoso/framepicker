import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { addPoint, movePoint, removePoint, tidy } from "../lib/curvePoints.ts";
import * as engine from "../lib/engine.ts";
import { type Adjustments, neutralCurves, neutralHsl } from "../lib/engine.ts";
import { previews } from "../lib/previews.ts";
import { RESULT } from "./fixtures.ts";
import { ReviewScreen } from "./ReviewScreen.tsx";
import { CurvesEditor } from "./review/CurvesEditor.tsx";
import { CropEditor } from "./review/crop/CropEditor.tsx";
import { HslMixer } from "./review/HslMixer.tsx";

vi.mock("../lib/engine.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/engine.ts")>();
  return {
    ...actual,
    preview: vi.fn(),
    getSettings: vi.fn(),
    setSetting: vi.fn(),
    onEngineEvent: vi.fn(),
    getEdits: vi.fn(),
    setEdits: vi.fn(),
    putEdits: vi.fn(),
    resetEdits: vi.fn(),
    listLuts: vi.fn(),
    straightenSuggest: vi.fn(),
  };
});
vi.mock("../lib/window.ts", () => ({ setFullscreen: vi.fn() }));

const mocked = vi.mocked(engine);
const NEUTRAL = engine.NEUTRAL;

beforeEach(() => {
  vi.clearAllMocks();
  previews.clear();
  Object.defineProperty(window, "innerWidth", { value: 1280, configurable: true, writable: true });
  mocked.onEngineEvent.mockResolvedValue(() => undefined);
  mocked.getSettings.mockRejectedValue(new Error("not needed"));
  mocked.getEdits.mockResolvedValue({});
  mocked.listLuts.mockResolvedValue([]);
  mocked.setEdits.mockResolvedValue({ photo_ids: [], adjustments: NEUTRAL } as never);
  mocked.putEdits.mockResolvedValue({ photo_ids: [] } as never);
  mocked.preview.mockResolvedValue({
    url: "data:image/jpeg;base64,AAAA",
    width: 1600,
    height: 1067,
    sourceWidth: 6000,
    sourceHeight: 4000,
  });
});

describe("curve points", () => {
  it("starts from the diagonal and keeps the corners", () => {
    expect(addPoint([], 0.5, 0.7)).toEqual([
      [0, 0],
      [0.5, 0.7],
      [1, 1],
    ]);
  });

  it("moves a point between its neighbours and the ends only up and down", () => {
    const base = addPoint([], 0.5, 0.5);
    expect(movePoint(base, 1, 5, 0.2)[1]).toEqual([0.99, 0.2]);
    expect(movePoint(base, 0, 0.3, 0.4)[0]).toEqual([0, 0.4]);
  });

  it("removes inner points only, and a curve left on the diagonal is stored as empty", () => {
    const base = addPoint([], 0.5, 0.5);
    expect(removePoint(base, 1)).toHaveLength(2);
    expect(removePoint(base, 0)).toEqual(base);
    expect(tidy(base)).toEqual([]);
  });

  it("refuses a point on top of another", () => {
    const base = addPoint([], 0.5, 0.7);
    expect(addPoint(base, 0.505, 0.2)).toEqual(base);
  });
});

describe("the curves editor", () => {
  function setup(curves = neutralCurves()) {
    const onChange = vi.fn();
    render(<CurvesEditor curves={curves} disabled={false} onChange={onChange} />);
    return { onChange };
  }

  it("moves a point with the arrow keys and removes it with Supr", async () => {
    const user = userEvent.setup();
    const { onChange } = setup({
      ...neutralCurves(),
      master: [
        [0, 0],
        [0.5, 0.7],
        [1, 1],
      ],
    });
    const point = screen.getByRole("button", { name: /Punto 2 de la curva Maestra/ });
    point.focus();
    await user.keyboard("{ArrowUp}");
    expect(onChange).toHaveBeenLastCalledWith({
      ...neutralCurves(),
      master: [
        [0, 0],
        [0.5, 0.71],
        [1, 1],
      ],
    });
    await user.keyboard("{Delete}");
    expect(onChange).toHaveBeenLastCalledWith(neutralCurves());
  });

  it("edits one channel at a time", async () => {
    const user = userEvent.setup();
    setup({
      ...neutralCurves(),
      r: [
        [0, 0],
        [0.5, 0.8],
        [1, 1],
      ],
    });
    await user.click(screen.getByRole("button", { name: "Rojo" }));
    expect(screen.getByRole("button", { name: /Punto 2 de la curva Rojo/ })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Curva Rojo" })).toBeInTheDocument();
  });

  it("resets every curve", async () => {
    const user = userEvent.setup();
    const { onChange } = setup({
      ...neutralCurves(),
      g: [
        [0, 0],
        [0.4, 0.5],
        [1, 1],
      ],
    });
    await user.click(screen.getByRole("button", { name: "Restablecer curvas" }));
    expect(onChange).toHaveBeenCalledWith(neutralCurves());
  });
});

describe("the colour mixer", () => {
  it("moves the chosen colour's sliders as fractions", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<HslMixer hsl={neutralHsl()} disabled={false} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Azul" }));
    const field = screen.getByRole("spinbutton", { name: "Saturación de Azul (valor)" });
    await user.click(field);
    await user.keyboard("{Control>}a{/Control}40");
    expect(onChange).toHaveBeenLastCalledWith({ ...neutralHsl(), blue: [0, 0.4, 0] });
  });

  it("marks the colours that were changed and can reset them all", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <HslMixer
        hsl={{ ...neutralHsl(), green: [0, 0, 0.3] }}
        disabled={false}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Restablecer colores" }));
    expect(onChange).toHaveBeenCalledWith(neutralHsl());
  });
});

describe("the crop and straighten editor", () => {
  const current: Adjustments = { ...NEUTRAL, exposure: 0.4 };

  function setup(overrides: Partial<Adjustments> = {}) {
    const onApply = vi.fn();
    const onClose = vi.fn();
    render(
      <CropEditor
        photoId="IMG_2"
        current={{ ...current, ...overrides }}
        onApply={onApply}
        onClose={onClose}
      />,
    );
    return { onApply, onClose };
  }

  it("shows the picture without its cut but with its colour corrections", async () => {
    setup({ rotate: 1, angle: 3, crop: [0.1, 0.1, 0.9, 0.9] });
    await screen.findByRole("img", { name: "Foto que se recorta" });
    expect(mocked.preview).toHaveBeenCalledWith("IMG_2", {
      maxPx: 1600,
      adjustments: { ...current, rotate: 0, flip: false, angle: 0, crop: null, aspect: null },
    });
  });

  it("applies the angle, a quarter turn and the mirror", async () => {
    const user = userEvent.setup();
    const { onApply } = setup();
    await screen.findByRole("img", { name: "Foto que se recorta" });
    fireEvent.change(screen.getByRole("slider", { name: "Ángulo" }), { target: { value: "-2.5" } });
    await user.click(screen.getByRole("button", { name: "Girar 90° a la derecha" }));
    await user.click(screen.getByRole("button", { name: "Voltear en espejo" }));
    await user.click(screen.getByRole("button", { name: "Aplicar" }));
    expect(onApply).toHaveBeenCalledWith({
      rotate: 1,
      flip: true,
      angle: -2.5,
      crop: null,
      aspect: null,
    });
  });

  it("cuts to a chosen proportion and remembers it", async () => {
    const user = userEvent.setup();
    const { onApply } = setup();
    await screen.findByRole("img", { name: "Foto que se recorta" });
    await user.click(screen.getByRole("button", { name: "1:1" }));
    await user.click(screen.getByRole("button", { name: "Aplicar" }));
    const geometry = onApply.mock.calls[0]?.[0];
    expect(geometry.aspect).toBe("1:1");
    const [x0, y0, x1, y1] = geometry.crop;
    // A square on a 3:2 picture: as tall as the picture, two thirds as wide.
    expect(((x1 - x0) * 1600) / ((y1 - y0) * 1067)).toBeCloseTo(1, 2);
    expect(y1 - y0).toBeCloseTo(1, 2);
  });

  it("turns the orientation of the proportion", async () => {
    const user = userEvent.setup();
    const { onApply } = setup();
    await screen.findByRole("img", { name: "Foto que se recorta" });
    await user.click(screen.getByRole("button", { name: "3:2" }));
    await user.click(screen.getByRole("button", { name: "Girar la orientación de la proporción" }));
    await user.click(screen.getByRole("button", { name: "Aplicar" }));
    expect(onApply.mock.calls[0]?.[0].aspect).toBe("2:3");
  });

  it("levels the horizon on request, or says there is none", async () => {
    const user = userEvent.setup();
    mocked.straightenSuggest.mockResolvedValueOnce({ found: true, angle: -1.8 });
    setup();
    await screen.findByRole("img", { name: "Foto que se recorta" });
    await user.click(screen.getByRole("button", { name: "Enderezar automático" }));
    await waitFor(() => expect(screen.getByRole("slider", { name: "Ángulo" })).toHaveValue("-1.8"));
    mocked.straightenSuggest.mockResolvedValueOnce({ found: false, angle: 0 });
    await user.click(screen.getByRole("button", { name: "Enderezar automático" }));
    expect(await screen.findByText(/No encuentro un horizonte claro/)).toBeVisible();
  });

  it("moves the frame with the keyboard, resets, and cancels", async () => {
    const user = userEvent.setup();
    const { onApply, onClose } = setup({ crop: [0.1, 0.1, 0.5, 0.5] });
    await screen.findByRole("img", { name: "Foto que se recorta" });
    const frame = screen.getByRole("group", { name: "Recuadro de recorte" });
    frame.focus();
    await user.keyboard("{ArrowRight}");
    await user.click(screen.getByRole("button", { name: "Aplicar" }));
    expect(onApply.mock.calls[0]?.[0].crop[0]).toBeCloseTo(0.11, 5);
    await user.click(screen.getByRole("button", { name: "Restablecer" }));
    await user.click(screen.getByRole("button", { name: "Aplicar" }));
    expect(onApply.mock.calls[1]?.[0].crop).toBeNull();
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("says so when the picture cannot be loaded", async () => {
    mocked.preview.mockRejectedValue(new Error("no"));
    setup();
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo cargar la foto.");
    expect(screen.getByRole("button", { name: "Aplicar" })).toBeDisabled();
  });
});

describe("copying settings to several photos", () => {
  function open() {
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
  const side = () => screen.getByRole("region", { name: "Correcciones" });

  it("keeps each photo's own crop unless 'Incluir recorte y giro' is ticked", async () => {
    mocked.getEdits.mockResolvedValue({
      IMG_1: { ...NEUTRAL, crop: [0, 0, 0.5, 0.5] },
      IMG_2: { ...NEUTRAL, exposure: 1, rotate: 1 },
    });
    const user = open();
    await within(side()).findByRole("spinbutton", { name: "Exposición (valor)" });
    await user.click(within(side()).getByRole("radio", { name: /^Varias fotos/ }));
    await user.click(within(side()).getByRole("button", { name: "Aplicar a 3 fotos" }));
    await waitFor(() => expect(mocked.putEdits).toHaveBeenCalled());
    const entries = mocked.putEdits.mock.calls[0]?.[1] as Record<string, Adjustments>;
    expect(entries.IMG_1).toMatchObject({ exposure: 1, crop: [0, 0, 0.5, 0.5], rotate: 0 });
    expect(entries.IMG_2).toMatchObject({ exposure: 1, rotate: 1, crop: null });
    expect(entries.IMG_3).toMatchObject({ exposure: 1, rotate: 0, crop: null });
  });

  it("brings the crop and turn along when asked", async () => {
    mocked.getEdits.mockResolvedValue({ IMG_2: { ...NEUTRAL, exposure: 1, rotate: 1 } });
    const user = open();
    await within(side()).findByRole("spinbutton", { name: "Exposición (valor)" });
    await user.click(within(side()).getByRole("radio", { name: /^Varias fotos/ }));
    await user.click(within(side()).getByRole("checkbox", { name: "Incluir recorte y giro" }));
    await user.click(within(side()).getByRole("button", { name: "Aplicar a 3 fotos" }));
    await waitFor(() => expect(mocked.setEdits).toHaveBeenCalled());
    const [, ids, adjustments] = mocked.setEdits.mock.calls[0] ?? [];
    expect(ids).toEqual(["IMG_1", "IMG_2", "IMG_3"]);
    expect(adjustments).toMatchObject({ exposure: 1, rotate: 1 });
  });
});

describe("the panel's sections", () => {
  it("folds away and shows a mark when something inside is changed", async () => {
    mocked.getEdits.mockResolvedValue({ IMG_2: { ...NEUTRAL, vibrance: 0.4, vignette: -0.2 } });
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
    const panel = screen.getByRole("region", { name: "Correcciones" });
    await waitFor(() =>
      expect(within(panel).getAllByRole("img", { name: "con cambios" })).toHaveLength(2),
    );
    const color = await within(panel).findByRole("button", { name: /^Color/u });
    expect(color).toHaveAttribute("aria-expanded", "false");
    await user.click(color);
    expect(within(panel).getByRole("slider", { name: "Vibración" })).toHaveValue("0.4");
    await user.click(within(panel).getByRole("button", { name: /^Detalle/u }));
    expect(within(panel).getByRole("slider", { name: "Viñeta" })).toHaveValue("-0.2");
    await user.click(within(panel).getByRole("button", { name: "Luz" }));
    expect(within(panel).queryByRole("slider", { name: "Exposición" })).toBeNull();
  });
});
