import { sound } from "@labscape/audio";
import { Button, Callout, cx, Field, inputClass } from "@labscape/ui";
import { motion } from "framer-motion";
import { ArrowLeft, LogIn, Mail, UserPlus } from "lucide-react";
import { useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { ApiError, post } from "../lib/api";
import { useSession } from "../lib/session";
import type { Me } from "../lib/types";
import { MoleculeField } from "../components/visuals";
import { LogoMark, Wordmark } from "../shell/brand";

type Mode = "login" | "signup" | "forgot" | "reset";

export default function Auth({ mode }: { mode: Mode }) {
  const { me, login, register, setMe } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const [form, setForm] = useState({ email: "", password: "", displayName: me?.guest ? "" : "", ageBand: "", consent: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const from = (location.state as { from?: string } | null)?.from ?? "/";
  const minor = form.ageBand === "under_13" || form.ageBand === "13_17";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "login") {
        const u = await login(form.email, form.password);
        sound.play("success");
        navigate(u.profile.onboarded ? from : "/onboarding", { replace: true });
      } else if (mode === "signup") {
        const u = await register({ email: form.email, password: form.password, displayName: form.displayName, ageBand: form.ageBand, parentalConsent: form.consent });
        sound.play("success");
        navigate(u.profile.onboarded ? "/" : "/onboarding", { replace: true });
      } else if (mode === "forgot") {
        await post("/v1/auth/forgot", { email: form.email });
        setSent(true);
      } else {
        const u = await post<Me>("/v1/auth/reset", { token: params.get("token"), password: form.password });
        setMe(u);
        navigate("/", { replace: true });
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
      sound.play("error");
    } finally {
      setBusy(false);
    }
  };

  const title = { login: "Welcome back, scientist", signup: me?.guest ? "Save your progress" : "Create your account", forgot: "Reset your password", reset: "Choose a new password" }[mode];
  const sub = {
    login: "Sign in to pick up where you left off.",
    signup: me?.guest ? `Your ${me.totalXp.toLocaleString()} XP, badges and streak come with you.` : "Free forever. Upgrade any time.",
    forgot: "We'll email you a link to set a new one.",
    reset: "Use at least 8 characters.",
  }[mode];

  return (
    <div className="relative grid min-h-full place-items-center overflow-hidden bg-[radial-gradient(900px_600px_at_50%_-10%,rgba(47,128,255,.25),transparent_60%),#070b18] px-4 py-10">
      <div className="opacity-60">
        <MoleculeField count={60} />
      </div>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.05, 0.7, 0.1, 1] }}
        className="relative z-10 w-full max-w-md"
      >
        <Link to={me ? "/" : "/welcome"} className="mb-6 flex items-center justify-center gap-2.5">
          <LogoMark size={34} />
          <Wordmark size={22} />
        </Link>
        <div className="rounded-2xl border border-white/10 bg-[#121a2e]/85 p-6 shadow-[0_40px_120px_-40px_rgba(0,0,0,.9)] backdrop-blur-xl sm:p-8">
          <h1 className="font-heading text-2xl font-bold tracking-tight">{title}</h1>
          <p className="mt-1 text-sm text-white/55">{sub}</p>
          {sent ? (
            <div className="mt-6">
              <Callout tone="success" title="Check your inbox">
                If an account exists for {form.email}, a reset link is on its way. It expires in an hour.
              </Callout>
            </div>
          ) : (
            <form onSubmit={submit} className="mt-6 space-y-4">
              {mode === "signup" && (
                <>
                  <Field label="Your name">
                    <input className={inputClass} value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} autoComplete="name" required minLength={2} />
                  </Field>
                  <div>
                    <span className="mb-1.5 block text-sm font-medium text-white/80">Age</span>
                    <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Age range">
                      {[
                        ["under_13", "Under 13"],
                        ["13_17", "13 – 17"],
                        ["18_plus", "18 +"],
                      ].map(([v, l]) => (
                        <button
                          type="button"
                          key={v}
                          role="radio"
                          aria-checked={form.ageBand === v}
                          onClick={() => setForm({ ...form, ageBand: v ?? "" })}
                          className={cx("h-10 rounded-md text-sm font-semibold transition", form.ageBand === v ? "bg-accent text-white" : "bg-white/[0.05] text-white/70 ring-1 ring-inset ring-white/10")}
                        >
                          {l}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
              {mode !== "reset" && (
                <Field label="Email">
                  <input className={inputClass} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="email" required autoFocus />
                </Field>
              )}
              {mode !== "forgot" && (
                <Field label={mode === "reset" ? "New password" : "Password"} hint={mode === "login" ? undefined : "At least 8 characters"}>
                  <input
                    className={inputClass}
                    type="password"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    autoComplete={mode === "login" ? "current-password" : "new-password"}
                    required
                    minLength={mode === "login" ? 1 : 8}
                  />
                </Field>
              )}
              {mode === "signup" && minor && (
                <label className="flex items-start gap-2.5 rounded-md bg-white/[0.04] p-3 text-sm text-white/70">
                  <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[#2f80ff]" checked={form.consent} onChange={(e) => setForm({ ...form, consent: e.target.checked })} />
                  A parent or guardian is here and agrees to me creating an account.
                </label>
              )}
              {error && (
                <p role="alert" className="rounded-md bg-state-danger/10 px-3 py-2 text-sm text-[#ff9b9b] ring-1 ring-inset ring-state-danger/30">
                  {error}
                </p>
              )}
              <Button
                block
                size="lg"
                type="submit"
                loading={busy}
                disabled={mode === "signup" && !form.ageBand}
                icon={mode === "login" ? <LogIn className="h-5 w-5" /> : mode === "signup" ? <UserPlus className="h-5 w-5" /> : <Mail className="h-5 w-5" />}
              >
                {{ login: "Sign in", signup: "Create account", forgot: "Send reset link", reset: "Save password" }[mode]}
              </Button>
              {mode === "login" && me?.guest && (
                <p className="text-center text-xs text-white/45">Your guest progress will be merged into this account.</p>
              )}
            </form>
          )}
          <div className="mt-6 flex items-center justify-between text-sm">
            {mode === "login" ? (
              <>
                <Link to="/forgot-password" className="text-white/55 hover:text-white">Forgot password?</Link>
                <Link to="/onboarding" className="font-semibold text-accent-cyan hover:underline">New here? Get started</Link>
              </>
            ) : (
              <Link to="/login" className="flex items-center gap-1.5 text-white/55 hover:text-white">
                <ArrowLeft className="h-4 w-4" /> {mode === "signup" ? "I already have an account" : "Back to sign in"}
              </Link>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
