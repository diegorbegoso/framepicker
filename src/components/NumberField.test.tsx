import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { NumberField, parseNumber } from "./NumberField.tsx";

/** A field that keeps its own value, the way a panel does, and reports every change. */
function Harness({ start = 0, step = 0.1, min = -2, max = 2, onChange = vi.fn() }) {
  const [value, setValue] = useState(start);
  return (
    <NumberField
      label="Exposición (valor)"
      value={value}
      min={min}
      max={max}
      step={step}
      unit="EV"
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

const field = () => screen.getByRole("spinbutton", { name: "Exposición (valor)" });

describe("parseNumber", () => {
  it("reads numbers with a comma or a point, and signs", () => {
    expect(parseNumber("1,5")).toBe(1.5);
    expect(parseNumber("1.5")).toBe(1.5);
    expect(parseNumber("+2")).toBe(2);
    expect(parseNumber("-0.25")).toBe(-0.25);
    expect(parseNumber(" .5 ")).toBe(0.5);
  });

  it("does not read what is not a number yet", () => {
    for (const text of ["", "-", ".", "1,", "1.2.3", "abc", "1e3", "--1"]) {
      expect(parseNumber(text) ?? "none").toBe(text === "1," ? 1 : "none");
    }
  });
});

describe("NumberField", () => {
  it("shows the value with its unit", () => {
    render(<Harness start={1.5} />);
    expect(field()).toHaveDisplayValue("1.5");
    expect(screen.getByText("EV")).toBeInTheDocument();
    expect(field()).toHaveAttribute("aria-valuenow", "1.5");
  });

  it("follows what you type as soon as it is a number", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness onChange={onChange} />);
    await user.click(field());
    await user.keyboard("{Control>}a{/Control}1,5");
    expect(onChange).toHaveBeenLastCalledWith(1.5);
    expect(field()).toHaveDisplayValue("1,5"); // what you typed stays while you type
  });

  it("lets you pass through a half-written number without changing anything", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness start={1} onChange={onChange} />);
    await user.click(field());
    await user.keyboard("{Control>}a{/Control}-");
    expect(onChange).not.toHaveBeenCalled();
    await user.keyboard("0.5");
    expect(onChange).toHaveBeenLastCalledWith(-0.5);
  });

  it("keeps the number inside the range", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness onChange={onChange} />);
    await user.click(field());
    await user.keyboard("{Control>}a{/Control}9");
    expect(onChange).toHaveBeenLastCalledWith(2);
    await user.keyboard("{Control>}a{/Control}-9");
    expect(onChange).toHaveBeenLastCalledWith(-2);
    await user.tab();
    expect(field()).toHaveDisplayValue("-2");
  });

  it("goes up and down with the arrow keys, by one step", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness start={1} onChange={onChange} />);
    await user.click(field());
    await user.keyboard("{ArrowUp}");
    expect(onChange).toHaveBeenLastCalledWith(1.1);
    await user.keyboard("{ArrowUp}{ArrowUp}");
    expect(onChange).toHaveBeenLastCalledWith(1.3);
    await user.keyboard("{ArrowDown}");
    expect(onChange).toHaveBeenLastCalledWith(1.2);
    expect(field()).toHaveDisplayValue("1.2");
  });

  it("moves ten steps at a time with Shift and stops at the ends", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness start={0.5} onChange={onChange} />);
    await user.click(field());
    await user.keyboard("{Shift>}{ArrowUp}{/Shift}");
    expect(onChange).toHaveBeenLastCalledWith(1.5);
    await user.keyboard("{Shift>}{ArrowUp}{/Shift}");
    expect(onChange).toHaveBeenLastCalledWith(2);
    await user.keyboard("{Shift>}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{/Shift}");
    expect(onChange).toHaveBeenLastCalledWith(-2);
  });

  it("nudges from what is typed, and from the value when the text is not a number", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness start={1} onChange={onChange} />);
    await user.click(field());
    await user.keyboard("{Control>}a{/Control}0,5{ArrowUp}");
    expect(onChange).toHaveBeenLastCalledWith(0.6);
    await user.keyboard("{Control>}a{/Control}{Backspace}{ArrowDown}");
    expect(onChange).toHaveBeenLastCalledWith(0.5);
  });

  it("writes the neat value back when you leave it, and on Enter", async () => {
    const user = userEvent.setup();
    render(<Harness start={1} />);
    await user.click(field());
    await user.keyboard("{Control>}a{/Control}1,50");
    await user.keyboard("{Enter}");
    expect(field()).not.toHaveFocus();
    expect(field()).toHaveDisplayValue("1.5");
    await user.click(field());
    await user.keyboard("{Control>}a{/Control}x");
    await user.tab();
    expect(field()).toHaveDisplayValue("1.5"); // junk is dropped
  });

  it("cannot be used while disabled", () => {
    render(
      <NumberField
        label="Exposición (valor)"
        value={0}
        min={-2}
        max={2}
        step={0.1}
        disabled
        onChange={vi.fn()}
      />,
    );
    expect(field()).toBeDisabled();
  });
});
