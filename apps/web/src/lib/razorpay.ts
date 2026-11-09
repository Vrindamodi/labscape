/**
 * Razorpay Checkout (https://razorpay.com/docs/payments/subscriptions/integration-guide/).
 * The script is injected once and the promise is cached; a failed load can be retried.
 */
const SRC = "https://checkout.razorpay.com/v1/checkout.js";

export type RazorpaySuccess = {
  razorpay_payment_id: string;
  razorpay_subscription_id: string;
  razorpay_signature: string;
};

export type RazorpayFailure = {
  error: { code?: string; description?: string; reason?: string; source?: string; step?: string };
};

export type RazorpayOptions = {
  key: string;
  subscription_id: string;
  name: string;
  description?: string;
  prefill?: { name?: string; email?: string; contact?: string };
  notes?: Record<string, string>;
  theme?: { color?: string };
  handler: (response: RazorpaySuccess) => void;
  modal?: { ondismiss?: () => void; escape?: boolean; confirm_close?: boolean };
};

export type RazorpayInstance = {
  open: () => void;
  close: () => void;
  on: (event: "payment.failed", cb: (response: RazorpayFailure) => void) => void;
};

type RazorpayCtor = new (options: RazorpayOptions) => RazorpayInstance;

declare global {
  interface Window {
    Razorpay?: RazorpayCtor;
  }
}

let loading: Promise<RazorpayCtor> | null = null;

export function loadRazorpay(): Promise<RazorpayCtor> {
  if (window.Razorpay) return Promise.resolve(window.Razorpay);
  loading ??= new Promise<RazorpayCtor>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SRC;
    script.async = true;
    script.onload = () => (window.Razorpay ? resolve(window.Razorpay) : reject(new Error("Razorpay Checkout did not initialise")));
    script.onerror = () => {
      script.remove();
      reject(new Error("Razorpay Checkout could not be loaded"));
    };
    document.head.appendChild(script);
  }).catch((e: unknown) => {
    loading = null; // allow a retry after a network blip
    throw e;
  });
  return loading;
}
