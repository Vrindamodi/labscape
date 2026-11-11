import { sound } from "@labscape/audio";
import { useMotion } from "@labscape/motion";
import { Blob, Button } from "@labscape/ui";
import { motion } from "framer-motion";
import { ArrowRight, FlaskConical, Orbit, ShieldCheck, Sigma, Sparkles } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { MoleculeField, SubjectArt } from "../components/visuals";
import { LogoMark, Wordmark } from "../shell/brand";

const WORDS: [string, string][] = [
  ["Explore.", "#48F08B"],
  ["Experiment.", "#5E9BFF"],
  ["Discover.", "#FCC934"],
];

/** Dark "media card" backdrop for the subject art (drawn for dark), lit in the subject colour. */
const mediaBg = (c: string) => `radial-gradient(120% 100% at 100% 0%, ${c}55, transparent 55%), linear-gradient(160deg, #222222, #121212)`;

export default function Welcome() {
  const navigate = useNavigate();
  const { d, reduced } = useMotion();
  return (
    <div className="relative min-h-full overflow-hidden bg-surface">
      {/* flat colour blobs at the edges, and the molecule field kept clear of the headline */}
      <Blob shape="cloud" color="#48F08B" size={520} className="absolute -right-48 -top-56 hidden md:block" />
      <Blob shape="hex" color="#FFBDF9" size={300} rotate={14} className="absolute -left-28 top-[38%] hidden md:block" />
      <Blob shape="pebble" color="#FCC934" size={260} className="absolute -bottom-24 right-[12%] hidden lg:block" />
      <div className="absolute inset-0 opacity-50 sm:opacity-100 [mask-image:radial-gradient(ellipse_44%_34%_at_50%_30%,transparent_40%,black_100%)]">
        <MoleculeField tone="light" count={70} />
      </div>

      <header className="relative z-10 flex items-center justify-between px-6 py-5 sm:px-10">
        <div className="flex items-center gap-2">
          <LogoMark size={30} />
          <Wordmark size={20} />
        </div>
        <Link to="/login" className="rounded-full bg-card px-4 py-2 text-sm font-medium text-ink-strong ring-1 ring-inset ring-line transition hover:bg-ink-strong hover:text-on-ink">
          Sign in
        </Link>
      </header>

      <main className="relative z-10 mx-auto flex max-w-5xl flex-col items-center px-6 pb-20 pt-8 text-center sm:pt-14">
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: d(400) }}>
          <LogoMark size={96} draw />
        </motion.div>
        <motion.h1
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: reduced ? 0 : d(1200), duration: d(400) }}
          className="mt-6 font-heading text-[64px] font-normal leading-none tracking-[-0.04em] text-ink-strong sm:text-[112px]"
        >
          LAB<span className="bg-gradient-to-r from-accent to-ai-violet bg-clip-text text-transparent">scape</span>
        </motion.h1>
        <div className="mt-6 flex flex-wrap justify-center gap-x-3 font-heading text-2xl font-normal tracking-[-0.01em] text-ink-strong sm:text-[32px]" aria-label="Explore. Experiment. Discover.">
          {WORDS.map(([w, c], i) => (
            <motion.span
              key={w}
              aria-hidden
              className="relative"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: reduced ? 0 : d(1500) + i * 0.09 * 3, duration: d(240) }}
            >
              {w}
              {!reduced && (
                <motion.span
                  className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full"
                  style={{ background: c }}
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: [0, 1.6, 1], opacity: [0, 1, 1] }}
                  transition={{ delay: d(1500) + i * 0.27 + 0.1, duration: 0.6 }}
                />
              )}
            </motion.span>
          ))}
        </div>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: reduced ? 0 : d(2300) }}
          className="mt-5 max-w-xl text-base text-ink-muted sm:text-lg"
        >
          A virtual science lab where you pour, mix, measure and launch, safely. Chemistry, physics and maths, hands on.
        </motion.p>
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: reduced ? 0 : d(2500) }}
          className="mt-9 flex flex-col items-center gap-3 sm:flex-row"
        >
          <Button
            size="lg"
            className="min-w-[220px]"
            iconRight={<ArrowRight className="h-5 w-5" />}
            onClick={() => {
              sound.play("whoosh");
              navigate("/onboarding");
            }}
          >
            Get started
          </Button>
          <Link to="/login">
            <Button size="lg" variant="secondary">I have an account</Button>
          </Link>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: reduced ? 0 : d(2800), duration: d(400) }}
          className="mt-20 grid w-full gap-4 sm:grid-cols-3"
        >
          {(
            [
              ["chemistry", "Chemistry lab", "Titrate, precipitate, electrolyse. Every colour change comes from a real engine.", FlaskConical, "#2DD4BF"],
              ["physics", "Physics lab", "Swing pendulums, launch projectiles, wire circuits and read live graphs.", Orbit, "#38BDF8"],
              ["maths", "Maths lab", "Drag a slider and watch functions, waves and integrals move.", Sigma, "#FB923C"],
            ] as const
          ).map(([s, title, body, Icon, c]) => (
            <div key={s} data-surface="dark" className="group relative overflow-hidden rounded-card p-6 text-left text-white" style={{ background: mediaBg(c) }}>
              <div className="absolute -right-3 -top-3 transition-transform duration-slow group-hover:scale-110">
                <SubjectArt subject={s} size={110} />
              </div>
              <Icon className="h-5 w-5" style={{ color: c }} />
              <div className="mt-12 font-heading text-[22px] font-normal tracking-[-0.01em]">{title}</div>
              <p className="mt-1 text-sm text-white/70">{body}</p>
            </div>
          ))}
        </motion.div>
        <div className="mt-8 flex flex-wrap justify-center gap-3 text-sm text-ink">
          <span className="flex items-center gap-2 rounded-full bg-card px-4 py-2 ring-1 ring-inset ring-line"><ShieldCheck className="h-4 w-4 text-[#1E8E3E]" /> Unsafe mixes are blocked</span>
          <span className="flex items-center gap-2 rounded-full bg-card px-4 py-2 ring-1 ring-inset ring-line"><Sparkles className="h-4 w-4 text-[#6D28D9]" /> AI lab assistant</span>
          <span className="flex items-center gap-2 rounded-full bg-card px-4 py-2 ring-1 ring-inset ring-line"><FlaskConical className="h-4 w-4 text-link" /> 118 elements to play with</span>
        </div>
      </main>
    </div>
  );
}
