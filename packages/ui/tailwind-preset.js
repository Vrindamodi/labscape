/** Tailwind preset exposing the LABscape tokens. Used by apps/web/tailwind.config.js. */

/** A colour backed by a "R G B" CSS variable from tokens.css, so `/10`-style opacity modifiers work. */
const v = (name) => `rgb(var(--ls-${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
export default {
  // `dark:` means "on a dark surface": anything inside [data-surface="dark"] (lab stages, simulators,
  // overlays). The app itself is light; there is no OS-driven dark mode.
  darkMode: ["variant", '&:is([data-surface="dark"], [data-surface="dark"] *)'],
  theme: {
    extend: {
      colors: {
        // Surface-aware semantic colours (flip inside [data-surface="dark"])
        surface: { DEFAULT: v("surface"), sunken: v("surface-sunken") },
        card: v("card"),
        ink: { DEFAULT: v("ink"), strong: v("ink-strong"), muted: v("ink-muted"), faint: v("ink-faint") },
        "on-ink": v("on-ink"),
        line: { DEFAULT: v("line"), strong: v("line-strong") },
        link: v("link"),
        // Flat accent tints for blobs, tiles and category pills
        tint: { green: "#48F08B", pink: "#FFBDF9", blue: "#5E9BFF", yellow: "#FCC934", peach: "#F9B896", lilac: "#C9B8FF" },

        bg: { base: "#0B1020", surface: "#121829", elevated: "#1A2236" },
        accent: { DEFAULT: "#2F80FF", primary: "#2F80FF", cyan: "#22D3EE" },
        ai: { violet: "#8B5CF6", magenta: "#E879F9" },
        state: { success: "#22C55E", warning: "#F59E0B", danger: "#EF4444" },
        subject: { chemistry: "#2DD4BF", physics: "#38BDF8", maths: "#FB923C" },
        glass: { fill: "rgb(255 255 255 / 0.06)", border: "rgb(255 255 255 / 0.10)" },
      },
      fontFamily: {
        heading: ['"DM Sans"', "system-ui", "sans-serif"],
        sans: ['"DM Sans"', "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
      },
      fontSize: {
        display: ["64px", { lineHeight: "1.04", letterSpacing: "-0.03em" }],
        h1: ["48px", { lineHeight: "1.1", letterSpacing: "-0.02em" }],
        h2: ["40px", { lineHeight: "1.15", letterSpacing: "-0.02em" }],
        h3: ["32px", { lineHeight: "1.2", letterSpacing: "-0.015em" }],
        h4: ["24px", { lineHeight: "1.25", letterSpacing: "-0.01em" }],
      },
      borderRadius: { sm: "8px", md: "12px", lg: "16px", xl: "24px", card: "24px", panel: "32px" },
      boxShadow: {
        // Cards are flat; only things that float (menus, dialogs, toasts) cast a soft shadow.
        pop: "0 1px 2px rgb(26 26 26 / 0.06), 0 24px 56px -20px rgb(26 26 26 / 0.28)",
        lift: "0 18px 40px -24px rgb(26 26 26 / 0.35)",
      },
      spacing: { sidebar: "264px", rail: "72px", panel: "360px" },
      backdropBlur: { glass: "16px" },
      transitionTimingFunction: {
        standard: "cubic-bezier(0.2, 0, 0, 1)",
        enter: "cubic-bezier(0.05, 0.7, 0.1, 1)",
        exit: "cubic-bezier(0.3, 0, 0.8, 0.15)",
      },
      transitionDuration: {
        instant: "80ms",
        fast: "150ms",
        base: "240ms",
        slow: "400ms",
        deliberate: "700ms",
      },
    },
  },
};
