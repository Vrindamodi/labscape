# Part 3 build plan: Physics and Maths Labs

Scope: build plan §3.1–3.14. Branch: `part-3-physics-maths` (from `part-2-lab-engine`).

## Decisions

1. **One sim-protocol runtime for both subjects.** Each experiment is:
   - a JSON content file (`content/experiments/<slug>.json`) holding the text, parameters, hints, observations and demo, which is what a teacher reviews;
   - a pure TypeScript *model* keyed by slug: `init`, `apply(state, LabEvent)`, step checks and deviation rules.

   A shared evaluator in `@labscape/physics/protocol` turns the event log into the same `Report` shape the chemistry evaluator produces. The Results stage, the attempts API, XP and the admin recorder then work unchanged.
2. **Same server replay as chemistry.** The physics and maths cores are pure, with no React, and are bundled into the existing GraalJS `lab-engine.js`. `scoreJson`/`contentJson` dispatch by slug, so `/v1/attempts/*` scores physics and maths runs with no new Java. `/v1/physics/check` and `/v1/maths/check` score an event log without an attempt (§3.13).
3. **Events, not frames.** Parameter changes, wiring, launches and readings are `LabEvent`s. Results the student measures (periods, ranges, meter readings) are re-derived analytically on the server and compared with what the student read off. Animation integrators (RK4 at 1/240 s) only drive the picture, so scoring never depends on frame rate.
4. **Stages register from the web app.** `apps/web` calls `registerStage("physics" | "maths", …)`. `@labscape/physics` and `@labscape/mathlab` therefore never import `lab-engine`, and `lab-engine`'s server entry can import their cores without a cycle.
5. **Maths input.** A lightweight expression parser/compiler, plus an on-screen keypad, stands in for MathLive (§3.8). It keeps the bundle small, and the server needs the same parser to re-check answers. MathLive can be dropped in later behind `<MathInput>`.

## Milestones

| # | Milestone | Done when |
|---|-----------|-----------|
| M1 | Physics core: seeded RNG, RK4/fixed-step runtime, MNA circuit solver (open/short/floating detection, meters with real resistance, LED, fuse, resistor heating), projectile (drag on/off), ray optics (Snell, TIR, slab lateral shift, Cauchy dispersion), pendulum (exact large-angle period), buoyancy. | 20 reference circuits within 0.1 %; projectile within 0.5 %; TIR at 41.8° for n = 1.5. |
| M2 | Maths core: expression parser/compiler, symbolic derivative, roots, adaptive sampling with discontinuity detection, Riemann sums, seeded probability. | tan(x) and 1/x have no false vertical lines; 10,000 coin flips in under 1 s, same seed gives the same results. |
| M3 | Sim-protocol runtime and evaluator; 12 MVP experiments as content plus models, each with a demo (golden run) that scores 3 stars and deviations that are caught. | All golden runs score 3 stars; key mistakes are flagged. |
| M4 | Shared components (`LiveGraph`, `Vector`, `FBD`, `EnergyBars`, `Plot`, `ParamSlider`, `MathInput`, controls bar) and the 12 Try workspaces; player branches by subject; keyboard operable. | Every experiment playable end to end. |
| M5 | Formula library: content, `/v1/formulas`, `/formulas` page with KaTeX, symbol hover, solver for any variable, and "Open in lab" links. | Page live; V = IR opens Ohm's law. |
| M6 | Server: bundle, `/v1/physics/check`, `/v1/maths/check`; GraalJS reports match V8. | API tests green. |

MVP experiments (§3.11):
- Physics: Ohm's law; series and parallel circuits; projectile motion; refraction through a glass slab (pin method); simple pendulum; Archimedes' principle.
- Maths: quadratic explorer; linear equations on a balance; unit circle and trig graphs; tangent and derivative; Riemann sums; coins and dice.

All content is `reviewStatus: "draft"` until a subject teacher signs it off.

## Status

| # | State | Notes |
|---|-------|-------|
| M1 | Done | 22 reference circuits within 0.1 %; projectile within 0.5 % (RK4 vs analytic); TIR at 41.8°; exact pendulum period; buoyancy. |
| M2 | Done | Parser/compiler, symbolic derivative, LaTeX, solver; tan(x) and 1/x without false vertical lines; 10,000 seeded flips well under 1 s. |
| M3 | Done | 12 experiments (content + models); every demo scores 3 stars; key mistakes caught (ammeter in parallel, voltmeter in series, dead short, current left on, misaligned pins, big swing, one-swing timing, length to the top of the bob, dripping can, sinker on the bottom, one-sided balance, sign errors, secant read as tangent). |
| M4 | Done | 12 workspaces in the player through `registerStage`; keyboard wiring, sliders, handles and the unit circle are keyboard operable. A full Ohm's law run through the UI scored 3 stars on the server. |
| M5 | Done | 58 formulas, `/v1/formulas`, `/formulas` page: symbol hover, solve for any variable, copy LaTeX, favourites, "Open in lab". |
| M6 | Done | Server replay for physics and maths (V8 and GraalJS agree on all 19 demos); `/v1/physics/check`, `/v1/maths/check`. |

Still open:
- Opening a formula from inside a lab with its symbols tracking the live values (§3.10, last bullet).
- Compare view, ghost runs and snapshots of the controls bar (§3.1) beyond the projectile's earlier-launch ghosts.
- Sandbox mode for Part 4's playground (the models already run without an evaluator).
- Teacher review of all 12 experiments and the formula library (`reviewStatus: "draft"`).
