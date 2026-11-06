import type { ProblemDetails } from "@labscape/contracts";

/**
 * Minimal fetch wrapper for the Spring Boot API under /v1.
 * Once Part 1 lands auth, a typed client is generated from /v1/openapi.json
 * (springdoc) so nobody hand-writes fetch calls.
 */
const BASE = import.meta.env.VITE_API_BASE_URL ?? "";

export class ApiError extends Error {
  constructor(readonly problem: ProblemDetails) {
    super(problem.title);
  }
}

export async function api<T>(path: `/v1/${string}`, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const res = await fetch(`${BASE}${path}`, { credentials: "include", ...init, headers });
  if (!res.ok) {
    const problem = (await res.json().catch(() => ({
      type: "about:blank",
      title: res.statusText,
      status: res.status,
    }))) as ProblemDetails;
    throw new ApiError(problem);
  }
  return (await res.json()) as T;
}
