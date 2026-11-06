import { sound } from "@labscape/audio";
import { celebrate } from "@labscape/motion";
import { Button, Callout, Card, Chip, cx, Modal, Segmented, Skeleton, useShell } from "@labscape/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { Check, CreditCard, Crown, Receipt, ShieldCheck, Sparkles } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError, post, rupees } from "../lib/api";
import { useSession } from "../lib/session";
import type { EntitlementsView, Invoice, Plan } from "../lib/types";

type Checkout = { subscriptionId: string; mode: string; plan: string; amountPaise: number };

export default function Plans() {
  const { me } = useSession();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { toast } = useShell();
  const [interval, setInterval] = useState<"month" | "year">("year");
  const [checkout, setCheckout] = useState<Checkout | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const plans = useQuery({ queryKey: ["plans"], queryFn: () => api<{ plans: Plan[]; mode: string; currentPlan: string }>("/v1/billing/plans") });
  const ent = useQuery({ queryKey: ["entitlements"], queryFn: () => api<EntitlementsView>("/v1/entitlements"), enabled: !!me });
  const invoices = useQuery({ queryKey: ["invoices"], queryFn: () => api<Invoice[]>("/v1/billing/invoices"), enabled: !!me && !me.guest });

  const free = plans.data?.plans.find((p) => p.id === "free");
  const paid = plans.data?.plans.find((p) => p.id === (interval === "year" ? "premium_annual" : "premium_monthly"));
  const monthly = plans.data?.plans.find((p) => p.id === "premium_monthly");
  const current = ent.data?.plan ?? "free";

  const start = async (planId: string) => {
    if (!me) return navigate("/onboarding");
    if (me.guest) return navigate("/signup");
    setBusy(planId);
    try {
      setCheckout(await post<Checkout>("/v1/billing/checkout", { plan: planId }));
    } catch (e) {
      toast({ kind: "danger", title: "Checkout didn't start", body: e instanceof ApiError ? e.message : "Try again in a moment." });
    } finally {
      setBusy(null);
    }
  };

  const refreshAll = () => {
    void qc.invalidateQueries({ queryKey: ["entitlements"] });
    void qc.invalidateQueries({ queryKey: ["me"] });
    void qc.invalidateQueries({ queryKey: ["invoices"] });
    void qc.invalidateQueries({ queryKey: ["plans"] });
    void qc.invalidateQueries({ queryKey: ["library"] });
  };

  return (
    <div className="mx-auto max-w-[1040px]">
      <div className="text-center">
        <Chip tone="gold"><Crown className="h-3 w-3" />LABscape Premium</Chip>
        <h1 className="mt-4 font-heading text-4xl font-bold tracking-tight sm:text-5xl">Unlock the whole lab</h1>
        <p className="mx-auto mt-3 max-w-xl text-white/60">Every experiment, every emergency scenario, unlimited playground time and no ads. Cancel any time.</p>
        <div className="mt-6 inline-flex items-center gap-3">
          <Segmented label="Billing interval" value={interval} onChange={(v) => { sound.play("toggle"); setInterval(v); }} options={[{ value: "month", label: "Monthly" }, { value: "year", label: "Annual" }]} />
          <AnimatePresence>
            {interval === "year" && paid?.savePaise && (
              <motion.span initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.4, opacity: 0 }} transition={{ type: "spring", stiffness: 320, damping: 14 }}>
                <Chip tone="success">Save {rupees(paid.savePaise)}</Chip>
              </motion.span>
            )}
          </AnimatePresence>
        </div>
      </div>

      {current !== "free" && ent.data && (
        <div className="mx-auto mt-8 max-w-xl">
          <Callout tone="success" title={`You're on ${current === "premium_annual" ? "Premium Annual" : "Premium Monthly"}`}>
            {ent.data.cancelAtPeriodEnd ? "Cancelled — " : ent.data.status === "grace" ? "Payment failed — Premium stays on during the grace period until " : "Renews "}
            {ent.data.currentPeriodEnd ? new Date(ent.data.currentPeriodEnd).toLocaleDateString() : ""}.
            <div className="mt-2">
              <Button
                size="sm"
                variant="secondary"
                loading={busy === "cancel"}
                onClick={async () => {
                  setBusy("cancel");
                  await post(`/v1/billing/subscription/${ent.data?.cancelAtPeriodEnd ? "resume" : "cancel"}`).catch(() => {});
                  setBusy(null);
                  refreshAll();
                }}
              >
                {ent.data.cancelAtPeriodEnd ? "Resume subscription" : "Cancel at period end"}
              </Button>
            </div>
          </Callout>
        </div>
      )}

      <div className="mt-10 grid gap-5 md:grid-cols-2">
        {plans.isLoading ? (
          <><Skeleton className="h-[460px] rounded-2xl" /><Skeleton className="h-[460px] rounded-2xl" /></>
        ) : (
          <>
            {free && (
              <Card className="flex flex-col p-7">
                <div className="font-heading text-xl font-semibold">Free</div>
                <div className="mt-3 font-heading text-4xl font-bold">₹0</div>
                <div className="text-sm text-white/45">forever</div>
                <ul className="mt-6 flex-1 space-y-2.5">{free.features.map((f) => <Feature key={f} text={f} />)}</ul>
                <Button variant="secondary" className="mt-6" disabled>{current === "free" ? "Your current plan" : "Included"}</Button>
              </Card>
            )}
            {paid && (
              <div className="relative rounded-2xl p-[1.5px]">
                <span className="ls-premium-border pointer-events-none absolute inset-0 rounded-2xl" style={{ padding: 1.5 }} aria-hidden />
                <Card className="relative flex h-full flex-col overflow-hidden rounded-2xl p-7" glow="#ffc23d">
                  <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(500px_260px_at_100%_0%,rgba(255,194,61,.18),transparent_60%)]" />
                  <div className="relative flex items-center justify-between">
                    <div className="flex items-center gap-2 font-heading text-xl font-semibold text-[#ffd77a]"><Crown className="h-5 w-5" />Premium</div>
                    <Chip tone="violet"><Sparkles className="h-3 w-3" />Most popular</Chip>
                  </div>
                  <div className="relative mt-3 flex items-baseline gap-2">
                    <RollingPrice value={paid.pricePaise} />
                    <span className="text-sm text-white/45">/ {paid.interval}</span>
                  </div>
                  <div className="relative text-sm text-white/45">
                    {interval === "year" && monthly ? `${rupees(Math.round(paid.pricePaise / 12))} a month, billed yearly` : "billed monthly, incl. GST"}
                  </div>
                  <ul className="relative mt-6 flex-1 space-y-2.5">
                    {(interval === "year" ? [...(monthly?.features ?? []), ...paid.features.slice(1)] : paid.features).map((f) => <Feature key={f} text={f} gold />)}
                  </ul>
                  <Button
                    variant="premium"
                    size="lg"
                    className="relative mt-6"
                    loading={busy === paid.id}
                    disabled={current === paid.id}
                    icon={<Crown className="h-5 w-5" />}
                    onClick={() => void start(paid.id)}
                  >
                    {current === paid.id ? "Your current plan" : current !== "free" ? "Switch plan" : `Go Premium ${interval === "year" ? "Annual" : "Monthly"}`}
                  </Button>
                  <p className="relative mt-3 flex items-center justify-center gap-1.5 text-xs text-white/40"><ShieldCheck className="h-3.5 w-3.5" />Secure payments · GST invoice · cancel any time</p>
                </Card>
              </div>
            )}
          </>
        )}
      </div>

      {invoices.data && invoices.data.length > 0 && (
        <Card className="mt-10 p-6">
          <h2 className="flex items-center gap-2 font-heading text-lg font-semibold"><Receipt className="h-5 w-5 text-white/60" />Billing history</h2>
          <table className="mt-4 w-full text-sm">
            <thead className="text-left text-xs text-white/45">
              <tr><th className="pb-2 font-medium">Invoice</th><th className="pb-2 font-medium">Date</th><th className="pb-2 font-medium">Plan</th><th className="pb-2 text-right font-medium">Amount (incl. GST)</th></tr>
            </thead>
            <tbody>
              {invoices.data.map((i) => (
                <tr key={i.id} className="border-t border-white/[0.05]">
                  <td className="tabular py-2.5">{i.invoiceNumber}</td>
                  <td className="py-2.5 text-white/65">{new Date(i.createdAt).toLocaleDateString()}</td>
                  <td className="py-2.5 text-white/65">{i.plan === "premium_annual" ? "Annual" : "Monthly"}</td>
                  <td className="tabular py-2.5 text-right">{rupees(i.amountPaise)} <span className="text-xs text-white/40">(GST {rupees(i.gstPaise)})</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <SandboxCheckout
        checkout={checkout}
        onClose={() => setCheckout(null)}
        onPaid={() => {
          setCheckout(null);
          refreshAll();
          sound.play("levelUp");
          celebrate({ preset: "confetti", count: 140, colors: ["#ffe07a", "#ffc23d", "#ff8a3d", "#fff", "#8b5cf6"] });
          toast({ kind: "reward", title: "Welcome to Premium ✨", body: "Everything is unlocked. Enjoy the full lab." });
        }}
      />
    </div>
  );
}

function Feature({ text, gold }: { text: string; gold?: boolean }) {
  return (
    <li className="flex items-start gap-2.5 text-sm text-white/75">
      <span className={cx("mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full", gold ? "bg-[#ffc23d]/20 text-[#ffd77a]" : "bg-white/10 text-white/60")}>
        <Check className="h-3 w-3" />
      </span>
      {text}
    </li>
  );
}

/** Prices roll digit by digit when the interval changes. */
function RollingPrice({ value }: { value: number }) {
  const text = rupees(value);
  return (
    <span className="flex font-heading text-5xl font-bold" aria-label={text}>
      {text.split("").map((ch, i) => (
        <span key={i} className="relative inline-block overflow-hidden" aria-hidden>
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={`${ch}-${i}-${text.length}`}
              className="inline-block"
              initial={{ y: "100%", opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: "-100%", opacity: 0 }}
              transition={{ type: "spring", stiffness: 500, damping: 32, delay: i * 0.03 }}
            >
              {ch}
            </motion.span>
          </AnimatePresence>
        </span>
      ))}
    </span>
  );
}

/** Sandbox mode: no money moves. "Pay" sends the same signed webhook Razorpay would. */
function SandboxCheckout({ checkout, onClose, onPaid }: { checkout: Checkout | null; onClose: () => void; onPaid: () => void }) {
  const [busy, setBusy] = useState<"ok" | "fail" | null>(null);
  const [failed, setFailed] = useState(false);
  const pay = async (succeed: boolean) => {
    if (!checkout) return;
    setBusy(succeed ? "ok" : "fail");
    try {
      await post("/v1/billing/sandbox/pay", { subscriptionId: checkout.subscriptionId, succeed });
      if (succeed) onPaid();
      else setFailed(true);
    } finally {
      setBusy(null);
    }
  };
  return (
    <Modal open={!!checkout} onClose={onClose} title="Checkout" width={440}>
      {checkout && (
        <div className="p-5">
          <Callout tone="info" title="Test mode">This is the sandbox: no card is charged. Live payments switch on with Razorpay keys.</Callout>
          <div className="mt-5 flex items-center justify-between rounded-lg bg-white/[0.04] p-4 ring-1 ring-inset ring-white/10">
            <div>
              <div className="font-semibold">{checkout.plan === "premium_annual" ? "Premium Annual" : "Premium Monthly"}</div>
              <div className="text-xs text-white/50">incl. 18% GST</div>
            </div>
            <div className="tabular font-heading text-2xl font-bold">{rupees(checkout.amountPaise)}</div>
          </div>
          {failed && <div className="mt-3"><Callout tone="warning" title="Payment declined">Nothing was charged. Try again or use another method.</Callout></div>}
          <div className="mt-5 grid gap-2">
            <Button variant="premium" size="lg" loading={busy === "ok"} icon={<CreditCard className="h-5 w-5" />} onClick={() => void pay(true)}>
              Pay {rupees(checkout.amountPaise)} (test)
            </Button>
            <Button variant="ghost" size="sm" loading={busy === "fail"} onClick={() => void pay(false)}>Simulate a declined card</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
