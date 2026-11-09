import { useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent } from "react";
import { ToolIcon } from "./ToolIcon";
import type { Hotspot, Tool } from "./types";

/**
 * The hands-on layer of the emergency simulator: a tool tray and room hotspots. Three ways in:
 * - drag a tool from the tray and drop it on a hotspot (mouse, pen or touch);
 * - tap a tool, then tap a hotspot;
 * - keyboard: Tab to a tool, Enter (focus jumps into the room), Tab to a hotspot, Enter.
 */
export type Drag = { tool: string; x: number; y: number; over: string | null };

function hotspotAt(x: number, y: number): string | null {
  const el = document.elementFromPoint(x, y);
  return el?.closest("[data-hotspot]")?.getAttribute("data-hotspot") ?? null;
}

export function ToolTray({
  tools,
  selected,
  disabled,
  onSelect,
  onDrop,
  onDrag,
  drag,
  focusRoom,
  glow = null,
}: {
  tools: Tool[];
  selected: string | null;
  disabled: boolean;
  onSelect: (tool: string | null) => void;
  onDrop: (tool: string, target: string) => void;
  onDrag: (d: Drag | null) => void;
  drag: Drag | null;
  /** Move keyboard focus into the room (after picking a tool with the keyboard). */
  focusRoom: () => void;
  /** A tool to point out (the last rung of a hint). */
  glow?: string | null;
}) {
  const start = useRef<{ x: number; y: number; tool: string } | null>(null);
  const dragged = useRef(false);
  const suppressClickUntil = useRef(0);

  const down = (e: ReactPointerEvent<HTMLButtonElement>, tool: string) => {
    if (disabled || e.button > 0) return;
    start.current = { x: e.clientX, y: e.clientY, tool };
    dragged.current = false;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* capture is a nicety */
    }
  };
  const move = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const s = start.current;
    if (!s) return;
    if (!dragged.current && Math.hypot(e.clientX - s.x, e.clientY - s.y) < 8) return;
    dragged.current = true;
    onDrag({ tool: s.tool, x: e.clientX, y: e.clientY, over: hotspotAt(e.clientX, e.clientY) });
  };
  const up = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const s = start.current;
    start.current = null;
    if (!s || !dragged.current) return;
    dragged.current = false;
    suppressClickUntil.current = Date.now() + 400;
    onDrag(null);
    const target = hotspotAt(e.clientX, e.clientY);
    if (target) onDrop(s.tool, target);
  };
  const cancel = () => {
    start.current = null;
    dragged.current = false;
    onDrag(null);
  };
  const click = (e: ReactMouseEvent<HTMLButtonElement>, tool: string) => {
    if (Date.now() < suppressClickUntil.current || disabled) return;
    const next = selected === tool ? null : tool;
    onSelect(next);
    // detail 0 = activated from the keyboard: take the learner straight to the room
    if (next && e.detail === 0) focusRoom();
  };

  const ghost = drag ? tools.find((t) => t.id === drag.tool) : null;
  return (
    <>
      <div className="grid grid-cols-4 gap-1.5" role="toolbar" aria-label="Tools: pick one, then choose where to use it">
        {tools.map((t) => {
          const on = selected === t.id;
          const lit = glow === t.id && !on;
          return (
            <button
              key={t.id}
              type="button"
              aria-pressed={on}
              aria-label={`${t.label}${t.hint ? `: ${t.hint}` : ""}`}
              disabled={disabled}
              onPointerDown={(e) => down(e, t.id)}
              onPointerMove={move}
              onPointerUp={up}
              onPointerCancel={cancel}
              onClick={(e) => click(e, t.id)}
              style={{ touchAction: "none" }}
              className={`group flex min-h-[64px] flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1.5 text-center outline-none ring-1 ring-inset transition focus-visible:ring-2 focus-visible:ring-sky-300 disabled:opacity-40 ${
                on ? "bg-amber-300/20 ring-2 ring-amber-300" : lit ? "motion-safe:animate-pulse bg-amber-300/10 ring-2 ring-amber-300/90" : "bg-white/[0.05] ring-white/12 hover:bg-white/[0.1]"
              } ${drag?.tool === t.id ? "opacity-40" : ""}`}
              data-hint-glow={lit || undefined}
            >
              <span className="pointer-events-none select-none">
                <ToolIcon id={t.id} size={34} />
              </span>
              <span className="pointer-events-none select-none text-[11px] font-semibold leading-tight text-white/85">{t.label}</span>
            </button>
          );
        })}
      </div>
      {ghost && drag && (
        // position: fixed works here: the fullscreen lab has no transformed ancestors
        <div className="pointer-events-none fixed z-[200] flex flex-col items-center" style={{ left: drag.x - 30, top: drag.y - 34 }} aria-hidden>
            <div className={`grid h-[60px] w-[60px] place-items-center rounded-2xl shadow-2xl ring-2 ${drag.over ? "bg-amber-300/30 ring-amber-300" : "bg-slate-900/80 ring-white/30"}`}>
              <ToolIcon id={ghost.id} size={48} />
            </div>
            <span className="mt-1 whitespace-nowrap rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-semibold text-white">{ghost.label}</span>
          </div>
      )}
    </>
  );
}

/** Hotspot targets, drawn inside the scene SVG (room coordinates). */
export function Hotspots({
  hotspots,
  tool,
  toolLabel,
  drag,
  disabled,
  onHit,
  textScale = 1,
  glow = null,
  reduced = false,
}: {
  hotspots: Hotspot[];
  /** Enlarges hotspot labels when the room is drawn small. */
  textScale?: number;
  tool: string | null;
  toolLabel: string | null;
  drag: Drag | null;
  disabled: boolean;
  onHit: (target: string) => void;
  /** A spot to point out (a hint, or the assistant's "Show me where"): pulses, with its label showing. */
  glow?: string | null;
  reduced?: boolean;
}) {
  const [focus, setFocus] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const armed = !!tool || !!drag;
  const key = (e: KeyboardEvent<SVGGElement>, id: string) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onHit(id);
    }
  };
  return (
    <g>
      {hotspots.map((h) => {
        const lit = drag?.over === h.id || focus === h.id || (hover === h.id && !disabled);
        const label = h.label;
        const k = textScale;
        const lw = Math.min(600, (label.length * 6.4 + 18) * k);
        const lh = 20 * k;
        const lx = Math.max(4, Math.min(640 - lw - 4, h.x + h.w / 2 - lw / 2));
        const ly = Math.max(2, Math.min(360 - lh - 2, h.y > lh + 6 ? h.y - lh - 4 : h.y + h.h + 4));
        return (
          <g
            key={h.id}
            data-hotspot={h.id}
            role="button"
            tabIndex={disabled ? -1 : 0}
            aria-disabled={disabled}
            aria-label={toolLabel ? `Use ${toolLabel} on ${label}` : `${label}. Pick a tool first.`}
            onClick={() => !disabled && onHit(h.id)}
            onKeyDown={(e) => !disabled && key(e, h.id)}
            onFocus={() => setFocus(h.id)}
            onBlur={() => setFocus((f) => (f === h.id ? null : f))}
            onPointerEnter={() => setHover(h.id)}
            onPointerLeave={() => setHover((v) => (v === h.id ? null : v))}
            style={{ cursor: disabled ? "default" : "pointer", outline: "none" }}
          >
            <rect
              x={h.x}
              y={h.y}
              width={h.w}
              height={h.h}
              rx={10}
              fill={lit ? "rgba(255,212,59,0.14)" : "rgba(255,255,255,0.001)"}
              stroke={lit ? "#ffd43b" : armed ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0)"}
              strokeWidth={lit ? 3 : 1.5}
              strokeDasharray={lit ? undefined : "6 5"}
            />
            {!armed && !disabled && <circle className="ls-pulse" cx={h.x + h.w / 2} cy={h.y + h.h / 2} r={4} fill="#fff" opacity={0.6} pointerEvents="none" />}
            {glow === h.id && (
              <rect data-hint-spot={h.id} x={h.x - 4} y={h.y - 4} width={h.w + 8} height={h.h + 8} rx={13} fill="rgba(255,212,59,0.12)" stroke="#ffd43b" strokeWidth={4} pointerEvents="none">
                {!reduced && <animate attributeName="opacity" values="1;0.35;1" dur="1.1s" repeatCount="indefinite" />}
              </rect>
            )}
            {(lit || glow === h.id) && (
              <g pointerEvents="none">
                <rect x={lx} y={ly} width={lw} height={lh} rx={6} fill="#0b0f1a" opacity={0.85} />
                <text x={lx + lw / 2} y={ly + 14 * k} textAnchor="middle" fontSize={11.5 * k} fontWeight={700} fill="#fff">
                  {label}
                </text>
              </g>
            )}
          </g>
        );
      })}
    </g>
  );
}
