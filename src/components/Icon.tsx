import type { SVGProps } from "react";

/** Stroke icons on a 24x24 grid, in the style of the Lucide set (ISC). No dependency, no emoji. */
const PATHS = {
  alert: [
    "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3",
    "M12 9v4M12 17h.01",
  ],
  camera: [
    "M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z",
    "M12 9a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z",
  ],
  check: ["M20 6 9 17l-5-5"],
  "chevron-down": ["m6 9 6 6 6-6"],
  "chevron-left": ["m15 18-6-6 6-6"],
  "chevron-right": ["m9 18 6-6-6-6"],
  "chevron-up": ["m18 15-6-6-6 6"],
  circle: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z"],
  "circle-check": ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z", "m9 12 2 2 4-4"],
  columns: ["M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z", "M12 3v18"],
  download: ["M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", "m7 10 5 5 5-5", "M12 15V3"],
  eye: [
    "M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0Z",
    "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z",
  ],
  folder: [
    "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z",
  ],
  images: [
    "M18 22H4a2 2 0 0 1-2-2V6",
    "m22 13-1.296-1.296a2.41 2.41 0 0 0-3.408 0L11 18",
    "M12 8m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0",
    "M10 2h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z",
  ],
  keyboard: [
    "M4 6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2Z",
    "M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8",
  ],
  maximize: [
    "M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3",
  ],
  minimize: [
    "M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3",
  ],
  moon: ["M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"],
  "panel-right": [
    "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z",
    "M15 3v18",
  ],
  sliders: ["M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M2 14h4M10 8h4M18 16h4"],
  sparkle: ["M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9Z"],
  sun: [
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z",
    "M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41",
  ],
  x: ["M18 6 6 18M6 6l12 12"],
  "zoom-in": ["M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16Z", "m21 21-4.3-4.3", "M11 8v6M8 11h6"],
  "zoom-out": ["M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16Z", "m21 21-4.3-4.3", "M8 11h6"],
} as const;

export type IconName = keyof typeof PATHS;

type Props = { name: IconName; size?: number; label?: string } & Omit<
  SVGProps<SVGSVGElement>,
  "name" | "children"
>;

const SHARED = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  focusable: "false",
} as const;

/** Decorative unless `label` is given; buttons that hold an icon carry their own accessible name. */
export function Icon({ name, size = 18, label, ...rest }: Props) {
  const shapes = PATHS[name].map((d) => <path key={d} d={d} />);
  if (label) {
    return (
      <svg {...SHARED} width={size} height={size} role="img" {...rest}>
        <title>{label}</title>
        {shapes}
      </svg>
    );
  }
  return (
    <svg {...SHARED} width={size} height={size} role="presentation" aria-hidden="true" {...rest}>
      {shapes}
    </svg>
  );
}
