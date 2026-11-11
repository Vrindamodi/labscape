import { sound } from "@labscape/audio";
import { useMotion } from "@labscape/motion";
import { Blob, Button, Callout, cx, Field, inputClass } from "@labscape/ui";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  Compass,
  FlaskConical,
  GraduationCap,
  Lightbulb,
  Mail,
  Orbit,
  School,
  Sigma,
  Sparkles,
  Swords,
  Telescope,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError, post } from "../lib/api";
import { useSession } from "../lib/session";
import type { Me } from "../lib/types";
import { LabIntro } from "../components/LabIntro";
import { MoleculeField } from "../components/visuals";
import { LogoMark } from "../shell/brand";

type Answers = { learningLevel: string | null; interests: string[]; preference: string | null };
const STEPS = ["level", "interests", "preference", "account", "intro"] as const;
type Step = (typeof STEPS)[number];
const STORE = "labscape.onboarding.v1";

const LEVELS: [string, string, string, LucideIcon][] = [
  ["beginner", "Beginner", "Brand new to science labs", Lightbulb],
  ["school", "School level", "Middle school topics", School],
  ["high_school", "High school", "GCSE, CBSE, IB, A-level", BookOpen],
  ["undergraduate", "Undergraduate", "University courses", GraduationCap],
  ["advanced", "Advanced learner", "Deeper theory and rigour", Sparkles],
  ["exploring", "Just exploring", "Curious, no pressure", Compass],
];
const INTERESTS: [string, string, string, LucideIcon][] = [
  ["chemistry", "Chemistry", "Reactions, colours, crystals", FlaskConical],
  ["physics", "Physics", "Forces, light, circuits", Orbit],
  ["maths", "Mathematics", "Graphs, waves, calculus", Sigma],
];
const PREFS: [string, string, string, LucideIcon][] = [
  ["experiments", "Guided experiments", "Step-by-step labs with demos", FlaskConical],
  ["challenges", "Challenges", "Missions, scores and streaks", Swords],
  ["explanations", "Explanations", "Understand the why first", BookOpen],
  ["exploration", "Free exploration", "Open playground, mix anything", Telescope],
];

export default function Onboarding() {
  const { me, startGuest, register, setMe, award } = useSession();
  const navigate = useNavigate();
  const { d, reduced } = useMotion();
  const [answers, setAnswers] = useState<Answers>(() => {
    try {
      return { learningLevel: null, interests: [], preference: null, ...JSON.parse(sessionStorage.getItem(STORE) ?? "{}") };
    } catch {
      return { learningLevel: null, interests: [], preference: null };
    }
  });
  const [step, setStep] = useState<Step>("level");
  const [dir, setDir] = useState(1);

  useEffect(() => sessionStorage.setItem(STORE, JSON.stringify(answers)), [answers]);
  useEffect(() => {
    if (me?.profile.onboarded && step !== "intro") navigate("/", { replace: true });
  }, [me, step, navigate]);

  const steps = useMemo(() => STEPS.filter((s) => s !== "account" || !me || step === "account"), [me, step]);
  const index = steps.indexOf(step);

  const go = (next: Step) => {
    setDir(STEPS.indexOf(next) > STEPS.indexOf(step) ? 1 : -1);
    sound.play("whoosh");
    setStep(next);
  };

  const finishProfile = async (user: Me | null) => {
    const updated = await post<Me>("/v1/onboarding", { ...answers, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
    // Keep onboarded=false locally until the lab intro ends, so the gate doesn't bounce us away.
    setMe({ ...updated, profile: { ...updated.profile, onboarded: false } });
    void user;
    go("intro");
  };

  const next = async () => {
    if (step === "level") go("interests");
    else if (step === "interests") go("preference");
    else if (step === "preference") {
      if (me) await finishProfile(me);
      else go("account");
    }
  };

  const valid =
    (step === "level" && !!answers.learningLevel) ||
    (step === "interests" && answers.interests.length > 0) ||
    (step === "preference" && !!answers.preference);

  return (
    <div className="relative flex min-h-full flex-col overflow-hidden bg-surface">
      <Blob shape="cloud" color="#48F08B" size={420} className="absolute -right-44 -top-52 hidden md:block" />
      <Blob shape="pebble" color="#FCC934" size={240} className="absolute -bottom-24 -left-16 hidden md:block" />
      <div className="opacity-30 sm:opacity-60">
        <MoleculeField count={40} tone="light" />
      </div>
      <header className="relative z-10 flex items-center justify-between px-6 py-5 sm:px-10">
        <LogoMark size={30} />
        {/* progress dots morph into a pill for the current step */}
        <div className="flex items-center gap-1.5" aria-label={`Step ${index + 1} of ${steps.length}`}>
          {steps.map((s, i) => (
            <motion.span
              key={s}
              layout
              className={cx("h-2 rounded-full", i <= index ? "bg-ink-strong" : "bg-ink/15")}
              animate={{ width: i === index ? 28 : 8 }}
              transition={{ type: "spring", stiffness: 500, damping: 32 }}
            />
          ))}
        </div>
        <span className="w-[30px]" />
      </header>

      <div className="relative z-10 flex flex-1 items-start justify-center px-4 pb-16 pt-4 sm:items-center sm:pt-0">
        <AnimatePresence mode="wait" custom={dir}>
          <motion.div
            key={step}
            custom={dir}
            initial={{ opacity: 0, x: reduced ? 0 : 24 * dir }}
            animate={{ opacity: 1, x: 0, transition: { duration: d(400), ease: [0.05, 0.7, 0.1, 1] } }}
            exit={{ opacity: 0, x: reduced ? 0 : -24 * dir, transition: { duration: d(240), ease: [0.3, 0, 0.8, 0.15] } }}
            className={cx("w-full", step === "intro" ? "max-w-5xl" : "max-w-3xl")}
          >
            {step === "level" && (
              <Question title="Where are you in your science journey?" sub="We'll pitch explanations and hints at the right level.">
                <ChoiceGrid cols={3} items={LEVELS} selected={answers.learningLevel ? [answers.learningLevel] : []} onPick={(v) => setAnswers((a) => ({ ...a, learningLevel: v }))} />
              </Question>
            )}
            {step === "interests" && (
              <Question title="What do you want to explore?" sub="Pick one or more. You can switch any time.">
                <ChoiceGrid
                  cols={3}
                  multi
                  items={INTERESTS}
                  selected={answers.interests}
                  onPick={(v) =>
                    setAnswers((a) => ({ ...a, interests: a.interests.includes(v) ? a.interests.filter((x) => x !== v) : [...a.interests, v] }))
                  }
                />
                <button
                  className="mx-auto mt-5 block rounded-full bg-line px-4 py-2 text-sm font-medium text-ink transition hover:bg-ink-strong hover:text-on-ink"
                  onClick={() => setAnswers((a) => ({ ...a, interests: ["chemistry", "physics", "maths"] }))}
                >
                  All three, please
                </button>
              </Question>
            )}
            {step === "preference" && (
              <Question title="How do you like to learn?" sub="This sets your home tab and how often hints appear.">
                <ChoiceGrid cols={2} items={PREFS} selected={answers.preference ? [answers.preference] : []} onPick={(v) => setAnswers((a) => ({ ...a, preference: v }))} />
              </Question>
            )}
            {step === "account" && (
              <AccountStep
                onGuest={async () => {
                  const u = await startGuest();
                  await finishProfile(u);
                }}
                onRegister={async (r) => {
                  const u = await register(r);
                  await finishProfile(u);
                }}
              />
            )}
            {step === "intro" && (
              <LabIntro
                onFinish={async () => {
                  sessionStorage.removeItem(STORE);
                  await award({ kind: "onboarding.completed", refId: "onboarding", idempotencyKey: "onboarding" }, { label: "Welcome" }).catch(() => null);
                  const fresh = await api<Me>("/v1/me");
                  setMe(fresh);
                  navigate("/", { replace: true });
                }}
              />
            )}

            {step !== "account" && step !== "intro" && (
              <div className="mt-8 flex items-center justify-between">
                <Button variant="ghost" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => (index > 0 ? go(steps[index - 1] ?? "level") : navigate("/welcome"))}>
                  Back
                </Button>
                <Button size="lg" disabled={!valid} iconRight={<ArrowRight className="h-5 w-5" />} onClick={() => void next()}>
                  Continue
                </Button>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

function Question({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <div>
      <h1 className="text-center font-heading text-[34px] font-normal leading-tight tracking-[-0.02em] text-ink-strong sm:text-[48px]">{title}</h1>
      <p className="mt-3 text-center text-ink-muted">{sub}</p>
      <div className="mt-8">{children}</div>
    </div>
  );
}

function ChoiceGrid({
  items,
  selected,
  onPick,
  cols,
  multi,
}: {
  items: [string, string, string, LucideIcon][];
  selected: string[];
  onPick: (v: string) => void;
  cols: 2 | 3;
  multi?: boolean;
}) {
  const colors: Record<string, string> = { chemistry: "#48F08B", physics: "#5E9BFF", maths: "#FCC934" };
  return (
    <div role={multi ? "group" : "radiogroup"} className={cx("grid gap-3", cols === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
      {items.map(([v, label, sub, Icon]) => {
        const on = selected.includes(v);
        const c = colors[v] ?? "#C9D7F2";
        return (
          <motion.button
            key={v}
            role={multi ? "checkbox" : "radio"}
            aria-checked={on}
            whileTap={{ scale: 0.96 }}
            onClick={() => {
              sound.play(on ? "close" : "toggle");
              onPick(v);
            }}
            className={cx(
              "relative flex items-center gap-4 rounded-card bg-card p-5 text-left transition duration-fast sm:flex-col sm:items-start",
              on ? "ring-2 ring-inset ring-ink-strong" : "hover:shadow-lift",
            )}
          >
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full text-[#1a1a1a]" style={{ background: c }}>
              <Icon className="h-5 w-5" />
            </span>
            <span>
              <span className="block font-heading text-[17px] font-medium text-ink-strong">{label}</span>
              <span className="block text-sm text-ink-muted">{sub}</span>
            </span>
            <AnimatePresence>
              {on && (
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  exit={{ scale: 0 }}
                  className="absolute right-3 top-3 grid h-6 w-6 place-items-center rounded-full bg-ink-strong"
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
                    <motion.path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.25 }} />
                  </svg>
                </motion.span>
              )}
            </AnimatePresence>
          </motion.button>
        );
      })}
    </div>
  );
}

function AccountStep({
  onGuest,
  onRegister,
}: {
  onGuest: () => Promise<void>;
  onRegister: (r: { email: string; password: string; displayName: string; ageBand: string; parentalConsent: boolean }) => Promise<void>;
}) {
  const [age, setAge] = useState<string | null>(null);
  const [mode, setMode] = useState<"choose" | "email">("choose");
  const [form, setForm] = useState({ displayName: "", email: "", password: "", consent: false });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const providers = useQuery({ queryKey: ["providers"], queryFn: () => api<{ google: boolean }>("/v1/auth/providers") });
  const minor = age === "under_13" || age === "13_17";

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong. Try again.");
      sound.play("error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-center font-heading text-[34px] font-normal leading-tight tracking-[-0.02em] text-ink-strong sm:text-[48px]">Save your lab spot</h1>
      <p className="mt-3 text-center text-ink-muted">Create an account to keep your XP everywhere, or jump in as a guest.</p>

      <div className="mt-8 rounded-panel bg-card p-6 shadow-pop">
        <div className="text-sm font-medium text-ink">How old are you?</div>
        <div className="mt-2 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Age range">
          {[
            ["under_13", "Under 13"],
            ["13_17", "13 – 17"],
            ["18_plus", "18 +"],
          ].map(([v, l]) => (
            <button
              key={v}
              role="radio"
              aria-checked={age === v}
              onClick={() => setAge(v ?? null)}
              className={cx("h-11 rounded-full text-sm font-medium transition", age === v ? "bg-ink-strong text-on-ink" : "bg-surface text-ink ring-1 ring-inset ring-line hover:bg-line")}
            >
              {l}
            </button>
          ))}
        </div>
        {minor && (
          <div className="mt-3">
            <Callout tone="info" title="Under-18 accounts are extra private">
              Your profile stays private, leaderboards show only your username, and ads are never personalised.
            </Callout>
          </div>
        )}

        <AnimatePresence mode="wait">
          {age && mode === "choose" && (
            <motion.div key="choose" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-5 space-y-2.5">
              {providers.data?.google && (
                <Button block variant="secondary" size="lg" disabled title="Google sign-in">
                  Continue with Google
                </Button>
              )}
              <Button block size="lg" icon={<Mail className="h-5 w-5" />} onClick={() => setMode("email")}>
                Sign up with email
              </Button>
              <Button block size="lg" variant="ghost" loading={busy === "guest"} icon={<UserRound className="h-5 w-5" />} onClick={() => run("guest", onGuest)}>
                Continue as guest
              </Button>
              <p className="text-center text-xs text-ink-muted">Guest progress is kept and merges into an account later.</p>
            </motion.div>
          )}
          {age && mode === "email" && (
            <motion.form
              key="email"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="mt-5 space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                void run("email", () => onRegister({ ...form, ageBand: age, parentalConsent: form.consent }));
              }}
            >
              <Field label="Your name">
                <input className={inputClass} value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} autoComplete="name" required minLength={2} />
              </Field>
              <Field label="Email">
                <input className={inputClass} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="email" required />
              </Field>
              <Field label="Password" hint="At least 8 characters">
                <input className={inputClass} type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" required minLength={8} />
              </Field>
              {minor && (
                <label className="flex items-start gap-2.5 rounded-[16px] bg-surface p-3 text-sm text-ink">
                  <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[#2f80ff]" checked={form.consent} onChange={(e) => setForm({ ...form, consent: e.target.checked })} />
                  A parent or guardian is here and agrees to me creating a LABscape account.
                </label>
              )}
              {error && <p role="alert" className="text-sm text-[#B3261E]">{error}</p>}
              <Button block size="lg" type="submit" loading={busy === "email"} icon={<Check className="h-5 w-5" />}>
                Create account
              </Button>
              <button type="button" onClick={() => setMode("choose")} className="block w-full text-center text-sm text-ink-muted hover:text-ink-strong">
                Other options
              </button>
            </motion.form>
          )}
        </AnimatePresence>
        {error && mode === "choose" && <p role="alert" className="mt-3 text-sm text-[#B3261E]">{error}</p>}
      </div>
    </div>
  );
}
