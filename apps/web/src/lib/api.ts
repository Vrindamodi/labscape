import type { ProblemDetails } from "@labscape/contracts";

/**
 * Fetch wrapper for the Spring Boot API under /v1. The session lives in an httpOnly cookie, so every
 * call sends credentials and no token ever touches JavaScript.
 */
const BASE = import.meta.env.VITE_API_BASE_URL ?? "";

export class ApiError extends Error {
  constructor(readonly problem: ProblemDetails) {
    super(problem.detail ?? problem.title);
  }
  get code() {
    return this.problem.code;
  }
  get status() {
    return this.problem.status;
  }
}

export async function api<T>(path: `/v1/${string}`, init?: RequestInit & { json?: unknown }): Promise<T> {
  const headers = new Headers(init?.headers);
  let body = init?.body;
  if (init?.json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(init.json);
  }
  let res: Response;
  try {
    const { json: _json, ...rest } = init ?? {};
    void _json;
    res = await fetch(`${BASE}${path}`, { credentials: "include", ...rest, headers, ...(body !== undefined ? { body } : {}) });
  } catch {
    throw new ApiError({ type: "about:blank", title: "Offline", status: 0, code: "NETWORK", detail: "Can't reach LABscape. Check your connection." });
  }
  if (res.status === 204 || res.status === 202 && res.headers.get("content-length") === "0") return undefined as T;
  if (!res.ok) {
    const problem = (await res.json().catch(() => ({
      type: "about:blank",
      title: res.statusText,
      status: res.status,
    }))) as ProblemDetails;
    throw new ApiError(problem);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const post = <T>(path: `/v1/${string}`, json?: unknown) => api<T>(path, { method: "POST", json: json ?? {} });
export const patch = <T>(path: `/v1/${string}`, json: unknown) => api<T>(path, { method: "PATCH", json });

/** Monotonic, sortable, unique id for idempotency keys (ULID-like: time + randomness). */
export function ulid(prefix = "") {
  const t = Date.now().toString(36).padStart(9, "0");
  const r = Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => (b % 36).toString(36)).join("");
  return `${prefix}${t}${r}`;
}

export const rupees = (paise: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: paise % 100 ? 2 : 0 }).format(paise / 100);
