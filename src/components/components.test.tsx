import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Badge } from "./Badge.tsx";
import { Button } from "./Button.tsx";
import { Icon } from "./Icon.tsx";
import { IconButton } from "./IconButton.tsx";
import { Kbd } from "./Kbd.tsx";
import { Panel } from "./Panel.tsx";
import { SegmentedControl } from "./SegmentedControl.tsx";
import { Skeleton } from "./Skeleton.tsx";

describe("Icon", () => {
  it("is hidden from screen readers unless it has a label", () => {
    const { container, rerender } = render(<Icon name="check" />);
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    rerender(<Icon name="check" label="Elegida" />);
    expect(screen.getByRole("img", { name: "Elegida" })).toBeInTheDocument();
  });
});

describe("Button", () => {
  it("is a button that does nothing when disabled", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { rerender } = render(
      <Button variant="primary" icon="folder" onClick={onClick}>
        Elegir carpeta
      </Button>,
    );
    await user.click(screen.getByRole("button", { name: "Elegir carpeta" }));
    expect(onClick).toHaveBeenCalledTimes(1);
    rerender(
      <Button disabled onClick={onClick}>
        Elegir carpeta
      </Button>,
    );
    await user.click(screen.getByRole("button", { name: "Elegir carpeta" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("never submits a form by accident", () => {
    render(<Button>Aplicar</Button>);
    expect(screen.getByRole("button", { name: "Aplicar" })).toHaveAttribute("type", "button");
  });
});

describe("IconButton", () => {
  it("takes its accessible name from the label and announces a toggle", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<IconButton icon="columns" label="Comparar" pressed shortcut="C" onClick={onClick} />);
    const button = screen.getByRole("button", { name: "Comparar" });
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(button).toHaveAttribute("aria-keyshortcuts", "C");
    expect(button).toHaveAttribute("title", "Comparar (C)");
    await user.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not claim to be a toggle when it is not one", () => {
    render(<IconButton icon="x" label="Cerrar" />);
    expect(screen.getByRole("button", { name: "Cerrar" })).not.toHaveAttribute("aria-pressed");
  });
});

describe("SegmentedControl", () => {
  const options = [
    { value: "all", label: "Todas", count: 12 },
    { value: "todo", label: "Sin revisar", count: 5 },
  ] as const;

  it("is a named group of radios with the current option checked", () => {
    render(
      <SegmentedControl label="Mostrar" value="all" options={[...options]} onChange={vi.fn()} />,
    );
    expect(screen.getByRole("group", { name: "Mostrar" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Todas/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /Sin revisar/ })).not.toBeChecked();
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("reports the choice with the mouse and with the arrow keys", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SegmentedControl label="Mostrar" value="all" options={[...options]} onChange={onChange} />,
    );
    await user.click(screen.getByRole("radio", { name: /Sin revisar/ }));
    expect(onChange).toHaveBeenLastCalledWith("todo");
    screen.getByRole("radio", { name: /Todas/ }).focus();
    await user.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith("todo");
  });
});

describe("Panel, Badge, Kbd and Skeleton", () => {
  it("labels a panel region with its title", () => {
    render(
      <Panel title="Ajustes de selección" icon="sliders">
        contenido
      </Panel>,
    );
    expect(screen.getByRole("region", { name: "Ajustes de selección" })).toHaveTextContent(
      "contenido",
    );
  });

  it("renders text, a key and a hidden placeholder", () => {
    const { container } = render(
      <>
        <Badge tone="success" icon="check">
          Elegida
        </Badge>
        <Kbd>Espacio</Kbd>
        <Skeleton ratio="3 / 2" />
      </>,
    );
    expect(screen.getByText("Elegida")).toBeInTheDocument();
    expect(screen.getByText("Espacio").tagName).toBe("KBD");
    expect(container.querySelector('[aria-hidden="true"][style*="aspect-ratio"]')).not.toBeNull();
  });
});
