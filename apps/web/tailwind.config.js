import preset from "@labscape/ui/tailwind-preset";

/** @type {import('tailwindcss').Config} */
export default {
  presets: [preset],
  content: {
    relative: true,
    files: ["./index.html", "./src/**/*.{ts,tsx}", "../../packages/*/src/**/*.{ts,tsx}"],
  },
};
