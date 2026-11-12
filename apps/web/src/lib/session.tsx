import type { ProgressEvent, RewardResult } from "@labscape/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useMemo, useRef, type ReactNode } from "react";
import { api, ApiError, post, ulid } from "./api";
import type { Me } from "./types";

export type AwardInput = Omit<ProgressEvent, "occurredAt" | "idempotencyKey"> & { idempotencyKey?: string };
export type RewardEvent = { result: RewardResult; origin?: { x: number; y: number }; label?: string };

type Listener = (e: RewardEvent) => void;
const rewardListeners = new Set<Listener>();
/** Rewards the server granted on its own (e.g. a scored experiment) still get the full celebration. */
export function emitReward(e: RewardEvent) {
  rewardListeners.forEach((l) => l(e));
}

/** The shell subscribes to show XP flights, badge reveals and level-ups. */
export function onReward(l: Listener) {
  rewardListeners.add(l);
  return () => void rewardListeners.delete(l);
}

export type Registration = { email: string; password: string; displayName: string; ageBand: string; parentalConsent: boolean };

type SessionCtx = {
  me: Me | null;
  loading: boolean;
  refresh: () => Promise<unknown>;
  setMe: (me: Me | null) => void;
  startGuest: () => Promise<Me>;
  login: (email: string, password: string) => Promise<Me>;
  register: (r: Registration) => Promise<Me>;
  logout: () => Promise<void>;
  award: (e: AwardInput, opts?: { origin?: { x: number; y: number }; label?: string }) => Promise<RewardResult | null>;
};

const Ctx = createContext<SessionCtx | null>(null);
const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        return await api<Me>("/v1/me");
      } catch (e) {
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
          if (e.code === "SESSION_INVALID") await post("/v1/auth/logout").catch(() => {});
          return null;
        }
        throw e;
      }
    },
    staleTime: 30_000,
    retry: (n, e) => !(e instanceof ApiError && e.status > 0 && e.status < 500) && n < 2,
  });

  const setMe = useCallback((me: Me | null) => qc.setQueryData(["me"], me), [qc]);
  const after = useCallback(
    (me: Me) => {
      setMe(me);
      void qc.invalidateQueries({ predicate: (x) => x.queryKey[0] !== "me" });
      return me;
    },
    [qc, setMe],
  );

  const guestPromise = useRef<Promise<Me> | null>(null);
  const startGuest = useCallback(() => {
    guestPromise.current ??= post<Me>("/v1/auth/guest", { timezone: tz() }).then(after).finally(() => (guestPromise.current = null));
    return guestPromise.current;
  }, [after]);

  const login = useCallback((email: string, password: string) => post<Me>("/v1/auth/login", { email, password }).then(after), [after]);
  const register = useCallback((r: Registration) => post<Me>("/v1/auth/register", { ...r, timezone: tz() }).then(after), [after]);
  const logout = useCallback(async () => {
    await post("/v1/auth/logout").catch(() => {});
    // Null "me" in place before dropping the rest: clear() would detach the mounted "me" query and keep
    // the old user on screen, so the welcome screen bounced straight back into the app.
    qc.setQueryData(["me"], null);
    qc.removeQueries({ predicate: (x) => x.queryKey[0] !== "me" });
  }, [qc]);

  const meRef = useRef<Me | null | undefined>(q.data);
  meRef.current = q.data;

  const award = useCallback<SessionCtx["award"]>(
    async (e, opts) => {
      // No session yet: start a guest one so nothing earned is lost (guest progress merges on sign-up).
      if (!meRef.current) await startGuest();
      const event: ProgressEvent = { ...e, idempotencyKey: e.idempotencyKey ?? ulid("evt_"), occurredAt: new Date().toISOString() };
      try {
        const result = await post<RewardResult>("/v1/progress/events", event);
        if (!result.duplicate) {
          qc.setQueryData<Me | null>(["me"], (m) => (m ? { ...m, totalXp: result.totalXp, level: result.level, streaks: result.streaks } : m));
          rewardListeners.forEach((l) => l({ result, ...(opts?.origin ? { origin: opts.origin } : {}), ...(opts?.label ? { label: opts.label } : {}) }));
          void qc.invalidateQueries({ queryKey: ["summary"] });
          void qc.invalidateQueries({ queryKey: ["challenges"] });
          void qc.invalidateQueries({ queryKey: ["notifications"] });
          void qc.invalidateQueries({ queryKey: ["board"] });
        }
        return result;
      } catch (err) {
        if (err instanceof ApiError && err.code === "FEATURE_NOT_LIVE") return null;
        throw err;
      }
    },
    [qc, startGuest],
  );

  const value = useMemo<SessionCtx>(
    () => ({ me: q.data ?? null, loading: q.isLoading, refresh: q.refetch, setMe, startGuest, login, register, logout, award }),
    [q.data, q.isLoading, q.refetch, setMe, startGuest, login, register, logout, award],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useSession outside provider");
  return c;
}

export const isAdmin = (me: Me | null) => me?.role === "admin" || me?.role === "super_admin";
