import type { ProblemDetails, SimulationRequest, SimulationResult } from "@labscape/contracts";
import type { CatalogueResponse, TrayItem, TryNextHint } from "./types";

export class ProblemError extends Error {
  constructor(
    readonly status: number,
    readonly problem: ProblemDetails,
  ) {
    super(problem.title);
  }
}

function sessionKey(): string {
  const k = "labscape.playground.session";
  try {
    const existing = sessionStorage.getItem(k);
    if (existing) return existing;
    const fresh = crypto.randomUUID();
    sessionStorage.setItem(k, fresh);
    return fresh;
  } catch {
    return "anonymous";
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "X-Lab-Session": sessionKey(),
        ...init?.headers,
      },
    });
  } catch {
    throw new ProblemError(0, {
      type: "about:blank",
      title: "Safety engine unreachable",
      status: 0,
      code: "NETWORK",
    });
  }
  if (!res.ok) {
    const fallback: ProblemDetails = {
      type: "about:blank",
      title: res.statusText,
      status: res.status,
    };
    const body = (await res.json().catch(() => fallback)) as ProblemDetails;
    throw new ProblemError(res.status, body);
  }
  return (await res.json()) as T;
}

export function fetchCatalogue(): Promise<CatalogueResponse> {
  return call<CatalogueResponse>("/v1/playground/catalogue");
}

function mixRequest(tray: TrayItem[], temperatureC: number, stirring: boolean, ignition: boolean): SimulationRequest {
  return {
    id: crypto.randomUUID(),
    subject: "chemistry",
    mode: "sandbox",
    attemptId: sessionKey(),
    inputs: tray.map((t) => ({ ref: t.item.id, amount: t.amount, unit: t.item.limits.unit })),
    conditions: { temperatureC, stirring, ignition },
  };
}

export function resolveMix(
  tray: TrayItem[],
  temperatureC: number,
  stirring: boolean,
  ignition = false,
): Promise<SimulationResult> {
  return call<SimulationResult>("/v1/safety/resolve", {
    method: "POST",
    body: JSON.stringify(mixRequest(tray, temperatureC, stirring, ignition)),
  });
}

/**
 * What the safety engine says is worth trying next with this beaker: shelf items that would start a
 * new reaction, or a bench tool (heat, flame) that would. Nothing is mixed by asking. Resolves to an
 * empty list when the engine is unreachable, so hints never get in the way of the bench.
 */
export async function fetchTryNext(
  tray: TrayItem[],
  temperatureC: number,
  stirring: boolean,
  ignition = false,
): Promise<TryNextHint[]> {
  if (!tray.length) return [];
  try {
    const res = await call<{ suggestions: TryNextHint[] }>("/v1/playground/try-next", {
      method: "POST",
      body: JSON.stringify(mixRequest(tray, temperatureC, stirring, ignition)),
    });
    return res.suggestions ?? [];
  } catch {
    return [];
  }
}
