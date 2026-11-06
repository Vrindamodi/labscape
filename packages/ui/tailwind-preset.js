/** Tailwind preset exposing the LABscape tokens. Used by apps/web/tailwind.config.js. */
/** @type {import('tailwindcss').Config} */
export default {
  theme: {
    extend: {
      colors: {
        bg: { base: "#0B1020", surface: "#121829", elevated: "#1A2236" },
        accent: { DEFAULT: "#2F80FF", primary: "#2F80FF", cyan: "#22D3EE" },
        ai: { violet: "#8B5CF6", magenta: "#E879F9" },
        state: { success: "#22C55E", warning: "#F59E0B", danger: "#EF4444" },
        subject: { chemistry: "#2DD4BF", physics: "#38BDF8", maths: "#FB923C" },
        glass: { fill: "rgb(255 255 255 / 0.06)", border: "rgb(255 255 255 / 0.10)" },
      },
      fontFamily: {
        heading: ['"Space Grotesk"', "system-ui", "sans-serif"],
        sans: ['"Inter"', "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
      },
      fontSize: {
        h1: ["48px", { lineHeight: "1.1" }],
        h2: ["40px", { lineHeight: "1.15" }],
        h3: ["32px", { lineHeight: "1.2" }],
        h4: ["24px", { lineHeight: "1.25" }],
      },
      borderRadius: { sm: "8px", md: "12px", lg: "16px", xl: "24px" },
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
