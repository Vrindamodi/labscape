/** Design tokens from the build plan ("Design tokens"). Single source for TS; mirrored in tokens.css. */

export const colors = {
  bg: {
    base: "#0B1020", // navy - app background
    surface: "#121829", // charcoal - cards, sidebar
    elevated: "#1A2236", // popovers, sheets
  },
  glass: {
    fill: "rgba(255, 255, 255, 0.06)",
    border: "rgba(255, 255, 255, 0.10)",
    blurPx: 16,
  },
  accent: {
    primary: "#2F80FF", // electric blue - primary actions, focus rings
    cyan: "#22D3EE", // highlights, snap targets, selection glow
  },
  ai: {
    violet: "#8B5CF6",
    magenta: "#E879F9",
  },
  state: {
    success: "#22C55E", // correct steps, completed experiments
    warning: "#F59E0B", // hints, procedural deviations
    danger: "#EF4444", // safety blocks, emergencies
  },
  subject: {
    chemistry: "#2DD4BF", // teal
    physics: "#38BDF8", // sky
    maths: "#FB923C", // orange
  },
} as const;

export const typography = {
  fontFamily: {
    heading: '"Space Grotesk", system-ui, sans-serif',
    body: '"Inter", system-ui, sans-serif',
    /** Tabular figures for every instrument readout. */
    mono: '"JetBrains Mono", ui-monospace, monospace',
  },
  headingSizes: [48, 40, 32, 24],
  bodySizes: [16, 14, 12],
} as const;

export const radius = { sm: 8, md: 12, lg: 16, xl: 24 } as const;

/** 4 px spacing grid. */
export const spacingUnit = 4;

export const layout = {
  sidebarWidth: 264,
  sidebarRailWidth: 72,
  contextPanelWidth: 360,
} as const;

/**
 * State colours never carry meaning alone: every warning, error and success also has an icon and
 * a label, so the three colour-blind palettes (deuteranopia, protanopia, tritanopia) can be swapped.
 */
export type ColourBlindPalette = "none" | "deuteranopia" | "protanopia" | "tritanopia";
