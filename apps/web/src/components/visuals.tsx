import { useMotion } from "@labscape/motion";
import { Component, lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Welcome background: molecules, atoms and equation glyphs in 3 depth layers drifting on 12-30 s
 * loops, with pointer parallax up to 12 px per layer, capped at 30 fps. Static under reduced motion.
 */
export function MoleculeField({ count = 100, tone = "dark" }: { count?: number; tone?: "dark" | "light" }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { reduced } = useMotion();

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let w = 0;
    let h = 0;
    const resize = () => {
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    };
    resize();
    window.addEventListener("resize", resize);

    const GLYPHS = ["H₂O", "CO₂", "NaCl", "F=ma", "E=mc²", "π", "∫", "pH", "λ", "Δ", "sin θ", "O₂", "CH₄", "∑", "√x"];
    const light = tone === "light";
    // Light: the flat accent tints (no glow), so the field reads as soft confetti on cream.
    const COLORS = light ? ["#5E9BFF", "#48F08B", "#FFBDF9", "#FCC934", "#F9B896", "#C9B8FF"] : ["#2F80FF", "#22D3EE", "#8B5CF6", "#2DD4BF", "#FB923C", "#E879F9"];
    type Item = { layer: 0 | 1 | 2; x: number; y: number; r: number; kind: "atom" | "molecule" | "glyph"; text: string; color: string; period: number; phase: number; ax: number; ay: number; rot: number };
    const items: Item[] = Array.from({ length: count }, (_, i) => {
      const layer = (i % 3) as 0 | 1 | 2;
      const roll = Math.random();
      return {
        layer,
        x: Math.random(),
        y: Math.random(),
        r: (layer + 1) * (2.5 + Math.random() * 3),
        kind: roll < 0.45 ? "atom" : roll < 0.8 ? "molecule" : "glyph",
        text: GLYPHS[i % GLYPHS.length] ?? "π",
        color: COLORS[i % COLORS.length] ?? "#2F80FF",
        period: 12 + Math.random() * 18,
        phase: Math.random() * Math.PI * 2,
        ax: 10 + Math.random() * 30,
        ay: 8 + Math.random() * 24,
        rot: Math.random() * Math.PI,
      };
    });

    let px = 0;
    let py = 0;
    const onMove = (e: PointerEvent) => {
      px = (e.clientX / window.innerWidth - 0.5) * 2;
      py = (e.clientY / window.innerHeight - 0.5) * 2;
    };
    window.addEventListener("pointermove", onMove);

    const draw = (t: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      for (const it of items) {
        const k = (t / 1000) * ((Math.PI * 2) / it.period) + it.phase;
        const par = (it.layer + 1) * 4; // up to 12 px
        const x = it.x * w + Math.sin(k) * it.ax - px * par;
        const y = it.y * h + Math.cos(k * 0.8) * it.ay - py * par;
        const alpha = (light ? [0.35, 0.55, 0.85] : [0.18, 0.32, 0.55])[it.layer] ?? 0.3;
        ctx.globalAlpha = alpha;
        if (it.kind === "glyph") {
          // On cream the tints are too pale for text, so glyphs are drawn in ink.
          ctx.fillStyle = light ? "#64615C" : it.color;
          ctx.font = `600 ${10 + it.layer * 5}px "JetBrains Mono", monospace`;
          ctx.fillText(it.text, x, y);
          continue;
        }
        let glow: CanvasGradient | string;
        if (light) {
          glow = it.color;
        } else {
          const g = ctx.createRadialGradient(x - it.r * 0.3, y - it.r * 0.3, 0, x, y, it.r);
          g.addColorStop(0, "#ffffff");
          g.addColorStop(0.35, it.color);
          g.addColorStop(1, `${it.color}00`);
          glow = g;
        }
        if (it.kind === "molecule") {
          const ang = it.rot + k * 0.2;
          const d = it.r * 1.9;
          ctx.strokeStyle = it.color;
          ctx.lineWidth = 1 + it.layer * 0.5;
          for (const s of [-1, 1]) {
            const bx = x + Math.cos(ang + s * 0.95) * d;
            const by = y + Math.sin(ang + s * 0.95) * d;
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(bx, by);
            ctx.stroke();
            ctx.fillStyle = light ? it.color : "#e6f0ff";
            ctx.beginPath();
            ctx.arc(bx, by, it.r * 0.55, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(x, y, it.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };

    let raf = 0;
    let last = 0;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (t - last < 33) return; // 30 fps cap
      last = t;
      draw(t);
    };
    if (reduced) draw(0);
    else raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
    };
  }, [count, reduced, tone]);

  return <canvas ref={ref} aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" />;
}

type Subject = "chemistry" | "physics" | "maths";

/**
 * The Rive build of the subject art, when one has been published into `assets/rive` (see
 * `graphics/subject-art`). Absent, the app simply keeps the SVG art below.
 */
const SUBJECT_RIV = Object.values(
  import.meta.glob<string>("../assets/rive/subject-art.riv", { query: "?url", import: "default", eager: true }),
)[0];
const SubjectArtRive = SUBJECT_RIV ? lazy(() => import("./SubjectArtRive")) : null;

/** A crash inside the Rive canvas (no WebGL, a bad file) falls back to the SVG instead of the page's error card. */
class ArtBoundary extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: Error) {
    console.warn("[subject art] Rive failed, keeping the SVG", error);
    this.props.onError();
  }

  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * Subject card loops: bubbling flask, swinging pendulum, tracing sine wave. Drawn by Rive when its file
 * is there and motion is allowed; the SVG shows first, and stays if Rive cannot load or draw.
 */
export function SubjectArt({ subject, size = 120 }: { subject: Subject; size?: number }) {
  const { reduced } = useMotion();
  const [ready, setReady] = useState(false);
  const [settled, setSettled] = useState(false);
  const [failed, setFailed] = useState(false);

  if (!SubjectArtRive || !SUBJECT_RIV || reduced || failed) return <SubjectArtSvg subject={subject} size={size} />;

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} aria-hidden>
      {!settled && (
        <div
          className="absolute inset-0 transition-opacity duration-300"
          style={{ opacity: ready ? 0 : 1 }}
          onTransitionEnd={() => ready && setSettled(true)}
        >
          <SubjectArtSvg subject={subject} size={size} />
        </div>
      )}
      <div className="absolute inset-0 transition-opacity duration-300" style={{ opacity: ready ? 1 : 0 }}>
        <ArtBoundary onError={() => setFailed(true)}>
          <Suspense fallback={null}>
            <SubjectArtRive
              src={SUBJECT_RIV}
              artboard={subject}
              onReady={() => setReady(true)}
              onError={() => setFailed(true)}
            />
          </Suspense>
        </ArtBoundary>
      </div>
    </div>
  );
}

function SubjectArtSvg({ subject, size }: { subject: Subject; size: number }) {
  if (subject === "chemistry") {
    return (
      <svg width={size} height={size} viewBox="0 0 120 120" aria-hidden>
        <defs>
          <linearGradient id="sa-c" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#5eead4" />
            <stop offset="1" stopColor="#0d9488" />
          </linearGradient>
          <linearGradient id="sa-glass" x1="0" x2="1">
            <stop offset="0" stopColor="#fff" stopOpacity=".5" />
            <stop offset=".25" stopColor="#fff" stopOpacity=".05" />
            <stop offset="1" stopColor="#fff" stopOpacity=".25" />
          </linearGradient>
        </defs>
        <ellipse cx="60" cy="108" rx="34" ry="5" fill="#2dd4bf" opacity=".25" />
        <path d="M70 72 L88 98 a6 6 0 0 1-5 9H37a6 6 0 0 1-5-9L50 72Z" fill="url(#sa-c)" />
        {[0, 1, 2, 3, 4].map((i) => (
          <circle
            key={i}
            className="ls-anim"
            cx={48 + i * 6}
            cy={96}
            r={2 + (i % 3)}
            fill="#ccfbf1"
            style={{ animation: `ls-bubble ${1.6 + i * 0.3}s ${i * 0.35}s ease-in infinite`, transformBox: "fill-box" }}
          />
        ))}
        <path d="M50 18h20M52 18v28L28 92a8 8 0 0 0 7 12h50a8 8 0 0 0 7-12L68 46V18" fill="url(#sa-glass)" stroke="#e6fffb" strokeOpacity=".8" strokeWidth="2.5" strokeLinejoin="round" />
        <path d="M40 80 L52 58" stroke="#fff" strokeOpacity=".7" strokeWidth="3" strokeLinecap="round" />
      </svg>
    );
  }
  if (subject === "physics") {
    return (
      <svg width={size} height={size} viewBox="0 0 120 120" aria-hidden>
        <defs>
          <radialGradient id="sa-bob" cx=".35" cy=".3">
            <stop offset="0" stopColor="#e0f2fe" />
            <stop offset=".5" stopColor="#38bdf8" />
            <stop offset="1" stopColor="#075985" />
          </radialGradient>
        </defs>
        <rect x="20" y="14" width="80" height="6" rx="3" fill="#7dd3fc" opacity=".5" />
        <path d="M30 110 A50 50 0 0 1 90 110" fill="none" stroke="#38bdf8" strokeOpacity=".25" strokeDasharray="3 5" />
        <g className="ls-anim" style={{ transformOrigin: "60px 18px", animation: "ls-swing 2.2s ease-in-out infinite" }}>
          <line x1="60" y1="18" x2="60" y2="86" stroke="#e0f2fe" strokeWidth="2" />
          <circle cx="60" cy="92" r="12" fill="url(#sa-bob)" style={{ filter: "drop-shadow(0 0 10px #38bdf8)" }} />
          <circle cx="56" cy="88" r="3.5" fill="#fff" opacity=".8" />
        </g>
        <circle cx="60" cy="18" r="4" fill="#e0f2fe" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" aria-hidden>
      <path d="M10 60h100M60 14v92" stroke="#fdba74" strokeOpacity=".25" strokeWidth="1.5" />
      <path
        className="ls-anim"
        d="M10 60 C 20 20, 30 20, 40 60 S 60 100, 70 60 S 90 20, 100 60 S 110 80, 112 72"
        fill="none"
        stroke="#fb923c"
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray="220"
        strokeDashoffset="220"
        style={{ animation: "ls-dash 2.6s ease-in-out infinite alternate", filter: "drop-shadow(0 0 8px #fb923c)" }}
      />
      <text x="16" y="30" fill="#fed7aa" fontFamily="JetBrains Mono" fontSize="13" fontWeight="600">sin x</text>
    </svg>
  );
}
