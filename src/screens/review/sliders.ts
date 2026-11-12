import type { SliderKey } from "../../lib/engine.ts";

export type SliderSpec = {
  key: SliderKey;
  label: string;
  /** Lowest and highest value the engine takes. */
  min: number;
  max: number;
};

const bipolar = (key: SliderKey, label: string): SliderSpec => ({ key, label, min: -1, max: 1 });

export const SLIDER_SPECS: Record<SliderKey, SliderSpec> = {
  exposure: { key: "exposure", label: "Exposición", min: -2, max: 2 },
  contrast: bipolar("contrast", "Contraste"),
  highlights: bipolar("highlights", "Luces"),
  shadows: bipolar("shadows", "Sombras"),
  whites: bipolar("whites", "Blancos"),
  blacks: bipolar("blacks", "Negros"),
  temperature: bipolar("temperature", "Temperatura"),
  tint: bipolar("tint", "Tinte"),
  vibrance: bipolar("vibrance", "Vibración"),
  saturation: bipolar("saturation", "Saturación"),
  clarity: bipolar("clarity", "Claridad"),
  sharpen: { key: "sharpen", label: "Nitidez", min: 0, max: 1 },
  vignette: bipolar("vignette", "Viñeta"),
};

/** The groups of sliders, in the order the person meets them. */
export const SLIDER_GROUPS: { id: string; title: string; keys: SliderKey[] }[] = [
  {
    id: "light",
    title: "Luz",
    keys: ["exposure", "contrast", "highlights", "shadows", "whites", "blacks"],
  },
  { id: "color", title: "Color", keys: ["temperature", "tint", "vibrance", "saturation"] },
  { id: "detail", title: "Detalle", keys: ["clarity", "sharpen", "vignette"] },
];
