/** Shared primitives used across contracts. */

/** ULID string (26 chars, Crockford base32). */
export type Ulid = string;

/** ISO-8601 timestamp, UTC. */
export type IsoDateTime = string;

export type Subject = "chemistry" | "physics" | "maths";

/** Perceptual colour, used for every simulated colour change (see ObservationCue). */
export type Oklab = { L: number; a: number; b: number; alpha?: number };

export type Measurement = { key: string; value: number; unit: string };

/** RFC 9457 problem details - every API error has this shape. */
export type ProblemDetails = {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  /** Machine-readable code, e.g. ENTITLEMENT_LIMIT, IDEMPOTENCY_CONFLICT. */
  code?: string;
  [extension: string]: unknown;
};

/** Cursor pagination envelope for list endpoints. */
export type CursorPage<T> = {
  items: T[];
  nextCursor: string | null;
};
