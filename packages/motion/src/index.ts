// @labscape/motion - owned by Part 1.
// Rules every part follows:
//  1. UI animates only transform and opacity; simulations draw on canvas.
//  2. Every animated component ships a reduced-motion variant.
//  3. Animation speed (0.5x-2x) scales UI durations; simulation speed is separate.
//  4. Quality tiers: ultra, high, lite, 2d-fallback.
//  5. Celebrations are skippable and never block input > 600 ms.
export * from "./tokens";
export * from "./react";
