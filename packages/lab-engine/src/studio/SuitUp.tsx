import { useMotion } from "@labscape/motion";
import { cx } from "@labscape/ui";
import { motion } from "framer-motion";
import { Check, ShieldCheck } from "lucide-react";
import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Glass, Kicker, PrimaryButton } from "./Glass";

export type PpeId = "coat" | "goggles" | "gloves";
export type PpeNeed = { id: PpeId; required: boolean; why: string };

const META: Record<PpeId, { name: string; slot: string }> = {
  coat: { name: "Lab coat", slot: "Body" },
  goggles: { name: "Safety goggles", slot: "Eyes" },
  gloves: { name: "Nitrile gloves", slot: "Hands" },
};

/**
 * "Suit up" before the bench (build plan: safety first). The learner puts each piece of protective
 * equipment on the avatar, by tapping it or dragging it across; the bench opens once everything
 * required is on. Goggles count as the experiment's own "goggles on" step.
 */
export function SuitUp({ needs, title, onDone }: { needs: PpeNeed[]; title: string; onDone: (worn: PpeId[]) => void }) {
  const { reduced } = useMotion();
  const [worn, setWorn] = useState<PpeId[]>([]);
  const [dragging, setDragging] = useState<PpeId | null>(null);
  const avatar = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: PpeId; x: number; y: number; el: HTMLElement } | null>(null);
  const ready = needs.filter((n) => n.required).every((n) => worn.includes(n.id));
  const wear = (id: PpeId) => setWorn((w) => (w.includes(id) ? w : [...w, id]));
  const toggle = (id: PpeId) => setWorn((w) => (w.includes(id) ? w.filter((x) => x !== id) : [...w, id]));

  const onDown = (e: ReactPointerEvent<HTMLButtonElement>, id: PpeId) => {
    drag.current = { id, x: e.clientX, y: e.clientY, el: e.currentTarget };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (Math.hypot(dx, dy) > 8) setDragging(d.id);
    d.el.style.transform = `translate(${dx}px, ${dy}px) scale(1.04)`;
  };
  const onUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    d.el.style.transform = "";
    const moved = dragging === d.id;
    setDragging(null);
    if (!moved) return toggle(d.id);
    const r = avatar.current?.getBoundingClientRect();
    if (r && e.clientX > r.left && e.clientX < r.right && e.clientY > r.top && e.clientY < r.bottom) wear(d.id);
  };

  const has = (id: PpeId) => worn.includes(id);
  return (
    <div className="absolute inset-0 z-30 grid place-items-center overflow-y-auto bg-[radial-gradient(900px_500px_at_50%_30%,rgba(61,139,255,.18),transparent_60%),rgba(3,7,18,.86)] p-4 backdrop-blur-sm">
      <Glass radius="xl" className="w-[min(860px,100%)] p-5 sm:p-6" role="dialog" aria-label="Suit up before entering the lab">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Kicker>Safety first</Kicker>
            <h2 className="mt-1 font-heading text-[24px] font-bold tracking-tight">Suit up for {title}</h2>
            <p className="mt-1 max-w-xl text-[13.5px] text-[#c8d6f3]">Tap each item, or drag it onto yourself. Real labs do not let you near the bench without it.</p>
          </div>
          <span className={cx("flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-bold", ready ? "bg-[rgba(61,232,168,.16)] text-[#3de8a8]" : "bg-white/[0.06] text-[#8fa6d1]")}>
            <ShieldCheck className="h-4 w-4" /> {worn.length}/{needs.length} on
          </span>
        </div>

        <div className="mt-5 grid items-center gap-5 md:grid-cols-[1fr_260px]">
          <div className="grid gap-3 sm:grid-cols-3">
            {needs.map((n) => (
              <button
                key={n.id}
                type="button"
                onPointerDown={(e) => onDown(e, n.id)}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), toggle(n.id))}
                aria-pressed={has(n.id)}
                aria-label={`${META[n.id].name}${n.required ? ", required" : ", recommended"}. ${has(n.id) ? "On" : "Not on yet"}`}
                className={cx(
                  "relative touch-none select-none rounded-[16px] border p-3 text-left transition-[background,border-color,box-shadow]",
                  has(n.id) ? "border-[rgba(61,232,168,.5)] bg-[rgba(61,232,168,.08)]" : "border-[rgba(140,180,255,.14)] bg-[rgba(4,10,28,.5)] hover:border-[#6aa8ff]",
                  dragging === n.id && "z-10 cursor-grabbing shadow-[0_20px_50px_-10px_rgba(0,0,0,.9)]",
                )}
              >
                <div className="grid h-24 place-items-center">
                  <PpeArt id={n.id} />
                </div>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <b className="font-heading text-[14px]">{META[n.id].name}</b>
                  {has(n.id) ? <Check className="h-4 w-4 text-[#3de8a8]" /> : <span className={cx("text-[10.5px] font-bold uppercase tracking-wide", n.required ? "text-[#ffc23d]" : "text-[#8fa6d1]")}>{n.required ? "Required" : "Advised"}</span>}
                </div>
                <p className="mt-0.5 text-[12px] leading-snug text-[#8fa6d1]">{n.why}</p>
              </button>
            ))}
          </div>

          <div ref={avatar} className={cx("relative mx-auto h-[280px] w-[220px] rounded-[20px] transition", dragging ? "bg-[rgba(61,139,255,.12)] ring-2 ring-dashed ring-[#6aa8ff]" : "")} aria-label="You">
            <Avatar coat={has("coat")} goggles={has("goggles")} gloves={has("gloves")} reduced={reduced} />
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[12.5px] text-[#8fa6d1]">{ready ? "You are ready. Remember: never taste, sniff carefully by wafting, and tell someone if anything spills." : "Put on everything marked Required to enter."}</p>
          <PrimaryButton disabled={!ready} onClick={() => onDone(worn)}>
            Enter the lab
          </PrimaryButton>
        </div>
      </Glass>
    </div>
  );
}

function PpeArt({ id }: { id: PpeId }) {
  if (id === "goggles")
    return (
      <svg viewBox="0 0 120 60" className="h-16 w-28" aria-hidden>
        <path d="M8 26 Q8 12 30 12 H90 Q112 12 112 26 V36 Q112 50 92 50 H74 Q66 50 60 40 Q54 50 46 50 H28 Q8 50 8 36 Z" fill="#9fd8ff" fillOpacity=".35" stroke="#7cc4ff" strokeWidth="3" />
        <path d="M2 28 H8 M112 28 H118" stroke="#3d8bff" strokeWidth="5" strokeLinecap="round" />
        <path d="M22 22 L36 20" stroke="#fff" strokeOpacity=".7" strokeWidth="3" strokeLinecap="round" />
      </svg>
    );
  if (id === "gloves")
    return (
      <svg viewBox="0 0 120 90" className="h-20 w-28" aria-hidden>
        {[0, 1].map((i) => (
          <g key={i} transform={`translate(${i * 52 + 6} ${i * 6}) rotate(${i ? 10 : -10} 26 45)`}>
            <path d="M12 84 V48 Q8 40 10 30 V14 Q10 8 15 8 Q20 8 20 14 V30 M20 26 V8 Q20 2 25 2 Q30 2 30 8 V28 M30 26 V8 Q30 3 35 3 Q40 3 40 8 V30 M40 28 V14 Q40 9 44 9 Q48 9 48 14 V50 Q48 62 42 70 V84 Z" fill="#7c6cff" fillOpacity=".45" stroke="#a99bff" strokeWidth="2.5" strokeLinejoin="round" />
          </g>
        ))}
      </svg>
    );
  return (
    <svg viewBox="0 0 110 100" className="h-24 w-24" aria-hidden>
      <path d="M38 6 L55 18 L72 6 L96 18 L104 64 L88 66 L86 96 H24 L22 66 L6 64 L14 18 Z" fill="#eef4ff" stroke="#b9cbef" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M55 18 V96" stroke="#b9cbef" strokeWidth="2" />
      <circle cx="61" cy="40" r="2.5" fill="#8aa0c8" />
      <circle cx="61" cy="58" r="2.5" fill="#8aa0c8" />
      <rect x="28" y="44" width="16" height="12" rx="2" fill="none" stroke="#b9cbef" strokeWidth="2" />
    </svg>
  );
}

function Avatar({ coat, goggles, gloves, reduced }: { coat: boolean; goggles: boolean; gloves: boolean; reduced: boolean }) {
  const pop = reduced ? {} : { initial: { scale: 0.6, opacity: 0 }, animate: { scale: 1, opacity: 1 }, transition: { type: "spring" as const, stiffness: 420, damping: 22 } };
  return (
    <svg viewBox="0 0 220 280" className="h-full w-full" role="img" aria-label={`Avatar wearing ${[coat && "a lab coat", goggles && "goggles", gloves && "gloves"].filter(Boolean).join(", ") || "nothing protective yet"}`}>
      <defs>
        <radialGradient id="su-floor" cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#3d8bff" stopOpacity=".45" />
          <stop offset="1" stopColor="#3d8bff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="110" cy="262" rx="80" ry="14" fill="url(#su-floor)" />
      {/* body */}
      <path d="M62 262 V170 Q62 128 110 128 Q158 128 158 170 V262 Z" fill={coat ? "#0000" : "#2b4a8a"} />
      <path d="M48 160 Q40 200 46 236 M172 160 Q180 200 174 236" stroke="#e7b48f" strokeWidth="16" strokeLinecap="round" fill="none" />
      {/* head */}
      <circle cx="110" cy="84" r="38" fill="#e7b48f" />
      <path d="M72 78 Q74 40 110 42 Q146 40 148 78 Q138 58 110 60 Q84 60 72 78 Z" fill="#2a1b12" />
      <circle cx="96" cy="88" r="4" fill="#1b1b2a" />
      <circle cx="124" cy="88" r="4" fill="#1b1b2a" />
      <path d="M100 106 Q110 113 120 106" stroke="#8a4b35" strokeWidth="3" fill="none" strokeLinecap="round" />
      {coat && (
        <motion.g {...pop} style={{ transformOrigin: "110px 190px" }}>
          <path d="M60 262 V168 Q60 130 92 126 L110 150 L128 126 Q160 130 160 168 V262 Z" fill="#eef4ff" stroke="#b9cbef" strokeWidth="2" />
          <path d="M110 150 V262" stroke="#b9cbef" strokeWidth="2" />
          <path d="M46 160 Q38 200 44 236 M174 160 Q182 200 176 236" stroke="#eef4ff" strokeWidth="20" strokeLinecap="round" fill="none" />
        </motion.g>
      )}
      {goggles && (
        <motion.g {...pop} style={{ transformOrigin: "110px 88px" }}>
          <path d="M76 82 Q76 72 90 72 H130 Q144 72 144 82 V92 Q144 102 132 102 H120 Q114 102 110 95 Q106 102 100 102 H88 Q76 102 76 92 Z" fill="#9fd8ff" fillOpacity=".45" stroke="#3d8bff" strokeWidth="3" />
          <path d="M72 84 H76 M144 84 H148" stroke="#3d8bff" strokeWidth="4" />
        </motion.g>
      )}
      {gloves && (
        <motion.g {...pop}>
          <circle cx="46" cy="242" r="11" fill="#7c6cff" />
          <circle cx="174" cy="242" r="11" fill="#7c6cff" />
        </motion.g>
      )}
      {!gloves && (
        <>
          <circle cx="46" cy="242" r="9" fill="#e7b48f" />
          <circle cx="174" cy="242" r="9" fill="#e7b48f" />
        </>
      )}
    </svg>
  );
}
