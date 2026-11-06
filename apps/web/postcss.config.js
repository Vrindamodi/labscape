import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

// Explicit config path so Tailwind works no matter which directory Vite is started from.
export default {
  plugins: { tailwindcss: { config: join(here, "tailwind.config.js") }, autoprefixer: {} },
};
