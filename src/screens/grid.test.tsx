import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as engine from "../lib/engine.ts";
import { previews } from "../lib/previews.ts";
import { photo, RESULT } from "./fixtures.ts";
import { between, flatten, visibleItems } from "./grid/items.ts";
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
  };
});
vi.mock("../lib/window.ts", () => ({ setFullscreen: vi.fn() }));

const mocked = vi.mocked(engine);

beforeEach(() => {
  vi.clearAllMocks();
  previews.clear();
  mocked.onEngineEvent.mockResolvedValue(() => undefined);
  mocked.preview.mockImplementation(async () => ({
    url: "data:image/jpeg;base64,AAAA",
    width: 1600,
    height: 1067,
    sourceWidth: 6000,
    sourceHeight: 4000,
  }));
  mocked.getSettings.mockRejectedValue(new Error("not needed"));
  mocked.setPick.mockImplementation(async (burstId, photoId, selected) => ({
    burst_id: burstId,
    photo_id: photoId,
    selected,
    source: "user" as const,
  }));
});

async function openGrid() {
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
  await user.click(screen.getByRole("radio", { name: "Cuadrícula" }));
  return user;
}

describe("grid helpers", () => {
  it("flattens bursts in order and marks where each burst starts", () => {
    const items = flatten(RESULT.bursts);
    expect(items.map((i) => i.photo.id)).toEqual(["IMG_1", "IMG_2", "IMG_3", "IMG_4", "IMG_5"]);
    expect(items.filter((i) => i.first).map((i) => i.burstNumber)).toEqual([1, 2]);
  });

  it("filters, and re-marks the first photo of each burst that is left", () => {
    const shown = visibleItems(flatten(RESULT.bursts), "picked");
    expect(shown.map((i) => i.photo.id)).toEqual(["IMG_2", "IMG_4"]);
    expect(shown.every((i) => i.first)).toBe(true);
  });

  it("filters the photos below the minimums", () => {
    const low = { ...photo("IMG_9", false), fails: ["sharpness" as const] };
    const bursts = [{ id: "b9", position: 0, no_pick: true, photos: [low, photo("IMG_8", true)] }];
    expect(visibleItems(flatten(bursts), "low").map((i) => i.photo.id)).toEqual(["IMG_9"]);
  });

  it("takes a range in either direction, both ends included", () => {
    expect(between([0, 1, 2, 3, 4], 3, 1)).toEqual([1, 2, 3]);
  });
});

describe("the grid", () => {
  it("shows every photo of every burst and says which are picked", async () => {
    await openGrid();
    expect(screen.getByRole("button", { name: "IMG_1.jpg, no elegida" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "IMG_2.jpg, elegida" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "IMG_5.ARW, no elegida" })).toBeInTheDocument();
  });

  it("picks and drops a photo with its round button, saving each change", async () => {
    const user = await openGrid();
    await user.click(screen.getByRole("button", { name: "Elegir IMG_1.jpg" }));
    expect(mocked.setPick).toHaveBeenCalledWith("b1", "IMG_1", true);
    expect(await screen.findByRole("button", { name: "IMG_1.jpg, elegida" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Quitar IMG_2.jpg" }));
    expect(mocked.setPick).toHaveBeenLastCalledWith("b1", "IMG_2", false);
  });

  it("picks a whole range with Shift", async () => {
    const user = await openGrid();
    await user.click(screen.getByRole("button", { name: "Elegir IMG_1.jpg" }));
    await user.keyboard("{Shift>}");
    await user.click(screen.getByRole("button", { name: "Elegir IMG_5.ARW" }));
    await user.keyboard("{/Shift}");
    // IMG_1 and IMG_5 were not picked; IMG_2 and IMG_4 already were, so only 3 and 5 change here.
    const calls = mocked.setPick.mock.calls.map(([, photoId]) => photoId);
    expect(calls).toEqual(expect.arrayContaining(["IMG_1", "IMG_3", "IMG_5"]));
    expect(calls).not.toContain("IMG_2");
  });

  it("filters by picked photos", async () => {
    const user = await openGrid();
    await user.click(screen.getByRole("radio", { name: /^Elegidas/ }));
    expect(screen.queryByRole("button", { name: "IMG_1.jpg, no elegida" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "IMG_4.ARW, elegida" })).toBeInTheDocument();
  });

  it("shows the focused photo in the sidebar and moves with the arrow keys", async () => {
    const user = await openGrid();
    const side = screen.getByRole("complementary", { name: "Foto enfocada" });
    expect(side).toHaveTextContent("IMG_1.jpg");
    await user.click(screen.getByRole("button", { name: "IMG_3.jpg, no elegida" }));
    expect(side).toHaveTextContent("IMG_3.jpg");
    await user.keyboard("{ArrowLeft}");
    expect(side).toHaveTextContent("IMG_2.jpg");
  });

  it("toggles the focused photo with Space", async () => {
    const user = await openGrid();
    await user.click(screen.getByRole("button", { name: "IMG_3.jpg, no elegida" }));
    await user.keyboard(" ");
    expect(mocked.setPick).toHaveBeenCalledWith("b1", "IMG_3", true);
  });
});

describe("the enlarged viewer", () => {
  it("opens as a dialog from the sidebar, steps along the grid, and closes with Escape", async () => {
    const user = await openGrid();
    await user.click(screen.getByRole("button", { name: "Ampliar" }));
    const dialog = screen.getByRole("dialog", { name: "Ampliar IMG_1.jpg" });
    expect(dialog).toBeInTheDocument();
    expect(await screen.findByText("1 de 5")).toBeInTheDocument();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("dialog", { name: "Ampliar IMG_2.jpg" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("picks from inside the viewer", async () => {
    const user = await openGrid();
    await user.dblClick(screen.getByRole("button", { name: "IMG_1.jpg, no elegida" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Elegir esta foto" }));
    expect(mocked.setPick).toHaveBeenCalledWith("b1", "IMG_1", true);
  });

  it("offers high resolution only for RAW photos", async () => {
    const user = await openGrid();
    await user.dblClick(screen.getByRole("button", { name: "IMG_1.jpg, no elegida" }));
    expect(screen.queryByRole("button", { name: "Alta resolución" })).not.toBeInTheDocument();
    await user.keyboard("{Escape}");
    await user.dblClick(screen.getByRole("button", { name: "IMG_4.ARW, elegida" }));
    expect(screen.getByRole("button", { name: "Alta resolución" })).toBeInTheDocument();
  });
});

describe("going back to the bursts", () => {
  it("opens the burst on the photo you were looking at", async () => {
    const user = await openGrid();
    await user.click(screen.getByRole("button", { name: "IMG_5.ARW, no elegida" }));
    await user.click(screen.getByRole("button", { name: "Ver en su ráfaga" }));
    await waitFor(() => expect(screen.getByText("2 de 2")).toBeVisible());
  });
});
