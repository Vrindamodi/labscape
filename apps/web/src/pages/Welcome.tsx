import { sound } from "@labscape/audio";
import { useMotion } from "@labscape/motion";
import { Button } from "@labscape/ui";
import { motion } from "framer-motion";
import { ArrowRight, FlaskConical, Orbit, ShieldCheck, Sigma, Sparkles } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { MoleculeField, SubjectArt } from "../components/visuals";
import { LogoMark, Wordmark } from "../shell/brand";

const WORDS: [string, string][] = [
  ["Explore.", "#2DD4BF"],
  ["Experiment.", "#38BDF8"],
  ["Discover.", "#FB923C"],
];

export default function Welcome() {
  const navigate = useNavigate();
  const { d, reduced } = useMotion();
  return (
    <div className="relative min-h-full overflow-hidden bg-[radial-gradient(1200px_700px_at_50%_-10%,rgba(47,128,255,.28),transparent_60%),radial-gradient(900px_600px_at_100%_100%,rgba(139,92,246,.18),transparent_60%),#070b18]">
      {/* keep the molecules clear of the headline so it stays readable */}
      <div className="absolute inset-0 [mask-image:radial-gradient(ellipse_44%_34%_at_50%_34%,transparent_35%,black_100%)]">
        <MoleculeField />
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-64 bg-gradient-to-t from-[#070b18] to-transparent" />

      <header className="relative z-10 flex items-center justify-between px-6 py-5 sm:px-10">
        <div className="flex items-center gap-2.5">
          <LogoMark size={30} />
          <Wordmark size={19} />
        </div>
        <Link to="/login" className="text-sm font-semibold text-white/70 hover:text-white">
          Sign in
        </Link>
      </header>

      <main className="relative z-10 mx-auto flex max-w-5xl flex-col items-center px-6 pb-20 pt-10 text-center sm:pt-16">
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: d(400) }} className="relative">
          <div className="absolute inset-0 -z-10 rounded-full bg-accent/30 blur-3xl" />
          <LogoMark size={104} draw />
        </motion.div>
        <motion.h1
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: reduced ? 0 : d(1200), duration: d(400) }}
          className="mt-6 font-heading text-5xl font-bold tracking-tight sm:text-7xl"
        >
          LAB<span className="bg-gradient-to-r from-[#7ef3ff] via-accent to-ai-violet bg-clip-text text-transparent">scape</span>
        </motion.h1>
        <div className="mt-5 flex flex-wrap justify-center gap-x-3 font-heading text-2xl font-semibold sm:text-3xl" aria-label="Explore. Experiment. Discover.">
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
                  className="absolute -right-1 -top-1 h-2 w-2 rounded-full"
                  style={{ background: c, boxShadow: `0 0 12px 3px ${c}` }}
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: [0, 1.6, 0], opacity: [0, 1, 0] }}
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
          className="mt-5 max-w-xl text-base text-white/60 sm:text-lg"
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
            className="ls-breathe min-w-[220px]"
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
              ["chemistry", "Chemistry lab", "Titrate, precipitate, electrolyse. Every colour change comes from a real engine.", FlaskConical],
              ["physics", "Physics lab", "Swing pendulums, launch projectiles, wire circuits and read live graphs.", Orbit],
              ["maths", "Maths lab", "Drag a slider and watch functions, waves and integrals move.", Sigma],
            ] as const
          ).map(([s, title, body, Icon]) => (
            <div key={s} className="group relative overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.03] p-5 text-left backdrop-blur">
              <div className="absolute -right-4 -top-4 opacity-80 transition-transform duration-slow group-hover:scale-110">
                <SubjectArt subject={s} size={110} />
              </div>
              <Icon className="h-5 w-5" style={{ color: s === "chemistry" ? "#2DD4BF" : s === "physics" ? "#38BDF8" : "#FB923C" }} />
              <div className="mt-10 font-heading text-lg font-semibold">{title}</div>
              <p className="mt-1 text-sm text-white/55">{body}</p>
            </div>
          ))}
        </motion.div>
        <div className="mt-8 flex flex-wrap justify-center gap-6 text-sm text-white/45">
          <span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-state-success" /> Unsafe mixes are blocked</span>
          <span className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-ai-violet" /> AI lab assistant</span>
          <span className="flex items-center gap-2"><FlaskConical className="h-4 w-4 text-accent-cyan" /> 118 elements to play with</span>
        </div>
      </main>
    </div>
  );
}
