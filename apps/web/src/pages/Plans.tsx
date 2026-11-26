import { sound } from "@labscape/audio";
import { celebrate } from "@labscape/motion";
import { Blob, Button, Callout, Card, Chip, cx, Modal, Segmented, Skeleton, useShell } from "@labscape/ui";
import { CardTitle } from "../components/PageHeader";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { Check, CreditCard, Crown, Receipt, ShieldCheck, Sparkles } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError, post, rupees } from "../lib/api";
import { loadRazorpay, type RazorpayOptions, type RazorpaySuccess } from "../lib/razorpay";
import { useSession } from "../lib/session";
import type { EntitlementsView, Invoice, Plan } from "../lib/types";

type Checkout = {
  subscriptionId: string;
  mode: string;
  plan: string;
  amountPaise: number;
  currency?: string;
  description?: string;
  razorpayKeyId?: string;
  prefill?: { name?: string; email?: string };
};

const planName = (id: string) => (id === "premium_annual" ? "Premium Annual" : "Premium Monthly");

export default function Plans() {
  const { me, refresh } = useSession();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { toast } = useShell();
  const [interval, setInterval] = useState<"month" | "year">("year");
  const [checkout, setCheckout] = useState<Checkout | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const plans = useQuery({ queryKey: ["plans"], queryFn: () => api<{ plans: Plan[]; mode: string; currentPlan: string }>("/v1/billing/plans") });
  const ent = useQuery({ queryKey: ["entitlements"], queryFn: () => api<EntitlementsView>("/v1/entitlements"), enabled: !!me });
  const invoices = useQuery({ queryKey: ["invoices"], queryFn: () => api<Invoice[]>("/v1/billing/invoices"), enabled: !!me && !me.guest });

  const free = plans.data?.plans.find((p) => p.id === "free");
  const paid = plans.data?.plans.find((p) => p.id === (interval === "year" ? "premium_annual" : "premium_monthly"));
  const monthly = plans.data?.plans.find((p) => p.id === "premium_monthly");
  const current = ent.data?.plan ?? "free";
  const live = plans.data?.mode === "razorpay";

  const refreshAll = () => {
    void qc.invalidateQueries({ queryKey: ["entitlements"] });
    void qc.invalidateQueries({ queryKey: ["me"] });
    void qc.invalidateQueries({ queryKey: ["invoices"] });
    void qc.invalidateQueries({ queryKey: ["plans"] });
    void qc.invalidateQueries({ queryKey: ["library"] });
  };

  const welcome = (planId: string) => {
    refreshAll();
    void refresh();
    sound.play("levelUp");
    celebrate({ preset: "confetti", count: 140, colors: ["#ffe07a", "#ffc23d", "#ff8a3d", "#fff", "#8b5cf6"] });
    toast({ kind: "reward", title: "Welcome to Premium", body: "Everything is unlocked. Enjoy the full lab." });
    setSuccess(planId);
  };

  /** Checkout succeeded in the Razorpay window: confirm the signature server side, then refresh. */
  const confirmPayment = async (co: Checkout, response: RazorpaySuccess) => {
    setBusy(co.plan);
    try {
      await post<EntitlementsView>("/v1/billing/verify", response);
      welcome(co.plan);
    } catch (e) {
      if (e instanceof ApiError && e.code === "PAYMENT_SIGNATURE_INVALID") {
        toast({ kind: "danger", title: "We couldn't confirm that payment", body: "If you were charged, it will be refunded or applied automatically. Contact support if Premium doesn't switch on." });
      } else {
        // The payment went through at Razorpay; its webhook will switch Premium on even if this call failed.
        toast({ kind: "info", title: "Payment received", body: "We're confirming it with Razorpay. Premium switches on within a minute." });
        window.setTimeout(refreshAll, 5_000);
        window.setTimeout(refreshAll, 20_000);
      }
    } finally {
      setBusy(null);
    }
  };

  const openRazorpay = async (co: Checkout) => {
    if (!co.razorpayKeyId) {
      toast({ kind: "danger", title: "Payments aren't set up", body: "Please try again later." });
      return;
    }
    let Razorpay;
    try {
      Razorpay = await loadRazorpay();
    } catch {
      toast({ kind: "danger", title: "Payment window didn't load", body: "Check your connection or disable blockers for checkout.razorpay.com, then try again." });
      return;
    }
    const name = co.prefill?.name ?? me?.displayName;
    const email = co.prefill?.email ?? me?.email ?? undefined;
    let settled = false;
    const options: RazorpayOptions = {
      key: co.razorpayKeyId,
      subscription_id: co.subscriptionId,
      name: "LABscape",
      description: co.description ?? planName(co.plan),
      prefill: { ...(name ? { name } : {}), ...(email ? { email } : {}) },
      notes: { plan: co.plan },
      theme: { color: "#2f80ff" },
      handler: (response) => {
        settled = true;
        void confirmPayment(co, response);
      },
      modal: {
        ondismiss: () => {
          if (!settled) toast({ kind: "info", title: "Checkout closed", body: "Nothing was charged. You can subscribe any time." });
        },
      },
    };
    const rzp = new Razorpay(options);
    rzp.on("payment.failed", (r) => {
      toast({ kind: "warning", title: "Payment failed", body: r.error.description ?? "Your bank declined the payment. Try another method." });
    });
    rzp.open();
  };

  const start = async (planId: string) => {
    if (!me) return navigate("/onboarding");
    if (me.guest) return navigate("/signup");
    setBusy(planId);
    let co: Checkout;
    try {
      co = await post<Checkout>("/v1/billing/checkout", { plan: planId });
    } catch (e) {
      toast({ kind: "danger", title: "Checkout didn't start", body: e instanceof ApiError ? e.message : "Try again in a moment." });
      setBusy(null);
      return;
    }
    if (co.mode === "razorpay") {
      await openRazorpay(co);
      setBusy(null);
    } else {
      setBusy(null);
      setCheckout(co);
    }
  };

  const toggleCancel = async () => {
    setBusy("cancel");
    try {
      await post(`/v1/billing/subscription/${ent.data?.cancelAtPeriodEnd ? "resume" : "cancel"}`);
      if (!ent.data?.cancelAtPeriodEnd) toast({ kind: "info", title: "Subscription cancelled", body: "Premium stays on until the end of this billing period." });
    } catch (e) {
      toast({ kind: "danger", title: "That didn't work", body: e instanceof ApiError ? e.message : "Try again in a moment." });
    } finally {
      setBusy(null);
      refreshAll();
    }
  };

  return (
    <div className="mx-auto max-w-[1040px]">
      <div className="relative text-center">
        <Chip tone="gold"><Crown className="h-3 w-3" />LABscape Premium</Chip>
        <h1 className="mt-5 font-heading text-[44px] font-normal leading-[1.04] tracking-[-0.03em] text-ink-strong sm:text-[64px]">Go Premium</h1>
        <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-ink-muted">Every experiment is free. Premium adds no ads, 200 AI messages a day, detailed analytics and report export. Cancel any time.</p>
        <div className="mt-7 inline-flex items-center gap-3">
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
          <Callout tone="success" title={`You're on ${planName(current)}`}>
            {ent.data.cancelAtPeriodEnd ? "Cancelled — Premium stays on until " : ent.data.status === "grace" ? "Payment failed — Premium stays on during the grace period until " : "Renews "}
            {ent.data.currentPeriodEnd ? new Date(ent.data.currentPeriodEnd).toLocaleDateString() : ""}.
            {!(live && ent.data.cancelAtPeriodEnd) && (
              <div className="mt-2">
                <Button size="sm" variant="secondary" loading={busy === "cancel"} onClick={() => void toggleCancel()}>
                  {ent.data.cancelAtPeriodEnd ? "Resume subscription" : "Cancel at period end"}
                </Button>
              </div>
            )}
          </Callout>
        </div>
      )}

      <div className="mt-10 grid gap-5 md:grid-cols-2">
        {plans.isLoading ? (
          <><Skeleton className="h-[460px] rounded-panel" /><Skeleton className="h-[460px] rounded-panel" /></>
        ) : (
          <>
            {free && (
              <Card className="flex flex-col rounded-panel p-8">
                <div className="font-heading text-xl font-medium text-ink-strong">Free</div>
                <div className="mt-4 font-heading text-[52px] font-normal leading-none tracking-[-0.03em] text-ink-strong">₹0</div>
                <div className="mt-1 text-sm text-ink-muted">forever</div>
                <ul className="mt-7 flex-1 space-y-3">{free.features.map((f) => <Feature key={f} text={f} />)}</ul>
                <Button variant="secondary" className="mt-7" disabled>{current === "free" ? "Your current plan" : "Included"}</Button>
              </Card>
            )}
            {paid && (
              /* Premium: a flat yellow colour block with charcoal text and a charcoal button. */
              <div className="relative flex h-full flex-col overflow-hidden rounded-panel bg-tint-yellow p-8 text-[#1a1a1a]">
                <Blob shape="cloud" color="#FFBDF9" size={220} className="absolute -right-16 -top-20" />
                <div className="relative flex items-center justify-between">
                  <div className="flex items-center gap-2 font-heading text-xl font-medium"><Crown className="h-5 w-5" />Premium</div>
                  <span className="inline-flex items-center gap-1 rounded-full bg-[#1a1a1a] px-3 py-1 text-xs font-medium text-white"><Sparkles className="h-3 w-3" />Most popular</span>
                </div>
                <div className="relative mt-4 flex items-baseline gap-2">
                  <RollingPrice value={paid.pricePaise} />
                  <span className="text-sm text-[#1a1a1a]/70">/ {paid.interval}</span>
                </div>
                <div className="relative mt-1 text-sm text-[#1a1a1a]/70">
                  {interval === "year" && monthly ? `${rupees(Math.round(paid.pricePaise / 12))} a month, billed yearly` : "billed monthly, incl. GST"}
                </div>
                <ul className="relative mt-7 flex-1 space-y-3">
                  {(interval === "year" ? [...(monthly?.features ?? []), ...paid.features.slice(1)] : paid.features).map((f) => <Feature key={f} text={f} gold />)}
                </ul>
                <Button
                    variant="primary"
                    size="lg"
                    className="relative mt-7"
                    loading={busy === paid.id}
                    disabled={current === paid.id || (live && current !== "free")}
                    icon={<Crown className="h-5 w-5" />}
                    onClick={() => void start(paid.id)}
                  >
                    {current === paid.id ? "Your current plan" : current !== "free" ? (live ? "Premium is active" : "Switch plan") : `Go Premium ${interval === "year" ? "Annual" : "Monthly"}`}
                  </Button>
                <p className="relative mt-3 flex items-center justify-center gap-1.5 text-xs text-[#1a1a1a]/70"><ShieldCheck className="h-3.5 w-3.5" />Secure payments · GST invoice · cancel any time</p>
              </div>
            )}
          </>
        )}
      </div>

      {invoices.data && invoices.data.length > 0 && (
        <Card className="mt-10 p-6 sm:p-7">
          <CardTitle icon={<Receipt className="h-4 w-4 text-ink-muted" />}>Billing history</CardTitle>
          <table className="mt-4 w-full text-sm text-ink-strong">
            <thead className="text-left text-xs text-ink-muted">
              <tr><th className="pb-2 font-medium">Invoice</th><th className="pb-2 font-medium">Date</th><th className="pb-2 font-medium">Plan</th><th className="pb-2 text-right font-medium">Amount (incl. GST)</th></tr>
            </thead>
            <tbody>
              {invoices.data.map((i) => (
                <tr key={i.id} className="border-t border-line">
                  <td className="tabular py-3">{i.invoiceNumber}</td>
                  <td className="py-3 text-ink-muted">{new Date(i.createdAt).toLocaleDateString()}</td>
                  <td className="py-3 text-ink-muted">{i.plan === "premium_annual" ? "Annual" : "Monthly"}</td>
                  <td className="tabular py-3 text-right">{rupees(i.amountPaise)} <span className="text-xs text-ink-muted">(GST {rupees(i.gstPaise)})</span></td>
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
          const plan = checkout?.plan ?? "premium_monthly";
          setCheckout(null);
          welcome(plan);
        }}
      />

      <Modal open={!!success} onClose={() => setSuccess(null)} title="Payment successful" width={420}>
        {success && (
          <div className="p-6 text-center">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-tint-yellow text-[#3d2a00]"><Crown className="h-7 w-7" /></div>
            <div className="mt-4 font-heading text-xl font-medium text-ink-strong">{`You're on ${planName(success)}`}</div>
            <p className="mt-2 text-sm text-ink-muted">Every experiment, scenario and theme is unlocked. Your GST invoice will appear in Billing history.</p>
            <Button variant="premium" className="mt-5 w-full" onClick={() => { setSuccess(null); navigate("/"); }}>Start exploring</Button>
          </div>
        )}
      </Modal>
    </div>
  );
}

function Feature({ text, gold }: { text: string; gold?: boolean }) {
  return (
    <li className={cx("flex items-start gap-2.5 text-sm", gold ? "text-[#1a1a1a]" : "text-ink")}>
      <span className={cx("mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full", gold ? "bg-[#1a1a1a] text-tint-yellow" : "bg-line text-ink-strong")}>
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
    <span className="flex font-heading text-[52px] font-normal leading-none tracking-[-0.03em]" aria-label={text}>
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
          <div className="mt-5 flex items-center justify-between rounded-[20px] bg-surface p-4">
            <div>
              <div className="font-medium text-ink-strong">{checkout.plan === "premium_annual" ? "Premium Annual" : "Premium Monthly"}</div>
              <div className="text-xs text-ink-muted">incl. 18% GST</div>
            </div>
            <div className="tabular font-heading text-2xl font-medium text-ink-strong">{rupees(checkout.amountPaise)}</div>
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
