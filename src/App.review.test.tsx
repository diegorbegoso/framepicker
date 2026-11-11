import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App.tsx";
import { engineRequest } from "./lib/ipc.ts";

vi.mock("./lib/ipc.ts", () => ({ engineRequest: vi.fn() }));

vi.mock("./screens/HomeScreen.tsx", () => ({
  HomeScreen: ({ onResult }: { onResult: (id: string, result: { bursts: [] }) => void }) => (
    <button type="button" onClick={() => onResult("s1", { bursts: [] })}>
      Elegir demo
    </button>
  ),
}));

// A stand-in review with a bit of state, to see whether visiting Ajustes resets it.
vi.mock("./screens/ReviewScreen.tsx", async () => {
  const { useState } = await import("react");
  return {
    ReviewScreen: ({ active }: { active?: boolean }) => {
      const [picks, setPicks] = useState(0);
      return (
        <section aria-label="Revisión de prueba">
          <button type="button" onClick={() => setPicks(picks + 1)}>
            Elegir una foto
          </button>
          <output aria-label="Elegidas">{picks}</output>
          <span>{active ? "activa" : "oculta"}</span>
        </section>
      );
    },
  };
});

describe("App with a review open", () => {
  beforeEach(() => {
    vi.mocked(engineRequest).mockRejectedValue(new Error("engine down"));
  });

  it("keeps the review as it was when you visit Ajustes and come back", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Elegir demo" }));
    await user.click(screen.getByRole("button", { name: "Elegir una foto" }));
    expect(screen.getByLabelText("Elegidas")).toHaveTextContent("1");
    expect(screen.getByText("activa")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Ajustes" }));
    expect(screen.getByRole("group", { name: "Tema" })).toBeInTheDocument();
    // Still mounted, but hidden and told to stand down: the keyboard belongs to Ajustes now.
    expect(screen.getByText("oculta")).not.toBeVisible();

    await user.click(screen.getByRole("button", { name: "Inicio" }));
    expect(screen.getByText("activa")).toBeVisible();
    expect(screen.getByLabelText("Elegidas")).toHaveTextContent("1");
  });
});
