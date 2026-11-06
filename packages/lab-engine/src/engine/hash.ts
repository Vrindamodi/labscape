import type { LabState } from "./state";

/**
 * Stable hash of the bench state. Numbers are rounded to 6 significant figures first, so the
 * last-bit differences between JavaScript engines (V8 in the browser, GraalJS on the server) in
 * Math.exp/pow never change the hash, while any real divergence does.
 */
export function stateHash(state: LabState): string {
  return cyrb53(stable(strip(state)));
}

function strip(state: LabState) {
  const { setup: _setup, seen: _seen, ...rest } = state;
  void _setup;
  void _seen;
  return rest;
}

function stable(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number") return Number.isFinite(v) ? sig(v) : "null";
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
    .join(",")}}`;
}

function sig(n: number): string {
  if (n === 0 || Math.abs(n) < 1e-12) return "0";
  return Number(n.toPrecision(6)).toString();
}

/** cyrb53: fast, well-distributed 53-bit string hash. */
export function cyrb53(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}
