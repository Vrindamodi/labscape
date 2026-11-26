/** Design tokens from the build plan ("Design tokens"). Single source for TS; mirrored in tokens.css. */

export const colors = {
  /** Light app surfaces (dark equivalents live in tokens.css under [data-surface="dark"]). */
  surface: {
    page: "#F3EFEA", // warm cream
    sunken: "#EAE4DC",
    card: "#FFFFFF",
    ink: "#323232",
    inkStrong: "#1A1A1A",
    inkMuted: "#64615C",
    line: "#E8DFD5",
    lineStrong: "#DDD3C7",
  },
  /** Flat accent tints for blobs, tiles and category pills. */
  tint: {
    green: "#48F08B",
    pink: "#FFBDF9",
    blue: "#5E9BFF",
    yellow: "#FCC934",
    peach: "#F9B896",
    lilac: "#C9B8FF",
  },
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
  /** Subject colours dark enough for text and icons on cream or white (AA). */
  subjectInk: {
    chemistry: "#0F766E",
    physics: "#0369A1",
    maths: "#C2410C",
  },
  /** Subject tiles on light surfaces use the flat tints. */
  subjectTint: {
    chemistry: "#48F08B",
    physics: "#5E9BFF",
    maths: "#FCC934",
  },
} as const;

export const typography = {
  fontFamily: {
    heading: '"DM Sans", system-ui, sans-serif',
    body: '"DM Sans", system-ui, sans-serif',
    /** Tabular figures for every instrument readout. */
    mono: '"JetBrains Mono", ui-monospace, monospace',
  },
  headingSizes: [48, 40, 32, 24],
  bodySizes: [16, 14, 12],
} as const;

export const radius = { sm: 8, md: 12, lg: 16, xl: 24, card: 24, panel: 32, pill: 9999 } as const;

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
