import { sound } from "@labscape/audio";
import { useMotion } from "@labscape/motion";
import { Avatar, Button, Chip, cx, Kbd, NamedIcon, ProgressRing, Skeleton, useShell, XpBar, type ContextPanelSlotName } from "@labscape/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import {
  Bell,
  Check,
  ChevronsLeft,
  ChevronsRight,
  CloudOff,
  Crown,
  LogIn,
  LogOut,
  PanelRightClose,
  PanelRightOpen,
  Search,
  Settings as SettingsIcon,
  Shield,
  UserRound,
  WifiOff,
} from "lucide-react";
import { Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { api, post } from "../lib/api";
import { isAdmin, useSession } from "../lib/session";
import { useSettings } from "../lib/settings";
import type { Challenge, NotificationItem } from "../lib/types";
import { LogoMark, StreakFlame, Wordmark } from "./brand";
import { CommandPalette } from "./CommandPalette";
import { isActive, MOBILE_TABS, NAV } from "./nav";
import { RouteErrorBoundary } from "./RouteErrorBoundary";

export function AppShell() {
  const { fullscreen } = useShell();
  const { settings, update } = useSettings();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const location = useLocation();
  const { d, reduced } = useMotion();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (fullscreen) {
    return (
      <>
        <RouteErrorBoundary key={location.pathname}>
          <Suspense fallback={<FullscreenLoader />}>
            <Outlet />
          </Suspense>
        </RouteErrorBoundary>
        <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      </>
    );
  }

  const collapsed = settings.sidebarCollapsed;
  return (
    <div className="ls-app-bg min-h-full">
      <OfflineBanner />
      <Sidebar collapsed={collapsed} onToggle={() => update({ sidebarCollapsed: !collapsed })} />
      <div className={cx("transition-[padding] duration-base ease-standard", collapsed ? "lg:pl-rail" : "lg:pl-sidebar")}>
        <TopBar onSearch={() => setPaletteOpen(true)} />
        <div className="flex">
          <main id="main" className="min-w-0 flex-1 px-4 pb-28 pt-4 sm:px-6 lg:px-8 lg:pb-12">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={location.pathname}
                initial={{ opacity: 0, y: reduced ? 0 : 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: d(240), ease: [0.2, 0, 0, 1] }}
              >
                <RouteErrorBoundary key={location.pathname}>
                  <Suspense fallback={<PageSkeleton />}>
                    <Outlet />
                  </Suspense>
                </RouteErrorBoundary>
              </motion.div>
            </AnimatePresence>
          </main>
          <ContextPanel open={settings.contextPanelOpen} />
        </div>
      </div>
      <MobileNav />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}

/* ------------------------------------------------------------------ sidebar */

function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { pathname, search } = useLocation();
  const { me } = useSession();
  return (
    <aside
      className={cx(
        "fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-white/[0.06] bg-[#0d1426]/85 backdrop-blur-xl transition-[width] duration-base ease-standard lg:flex",
        collapsed ? "w-rail" : "w-sidebar",
      )}
      aria-label="Main navigation"
    >
      <div className={cx("flex h-16 items-center gap-2.5", collapsed ? "justify-center" : "px-5")}>
        <Link to="/" className="flex items-center gap-2.5" aria-label="LABscape home">
          <LogoMark size={30} />
          {!collapsed && <Wordmark size={19} />}
        </Link>
      </div>
      <nav className="ls-scroll flex-1 overflow-y-auto overflow-x-hidden px-3 pb-4">
        {NAV.map((group, gi) => (
          <div key={gi} className="mt-3 first:mt-1">
            {group.label &&
              (collapsed ? (
                <div className="mx-auto my-2 h-px w-6 bg-white/10" />
              ) : (
                <div className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/35">{group.label}</div>
              ))}
            {group.items.map((item) => {
              const active = isActive(item, pathname, search);
              const I = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={() => sound.play("click")}
                  className={cx(
                    "group relative flex items-center gap-3 rounded-md text-sm font-medium transition-colors duration-fast",
                    collapsed ? "mx-auto h-11 w-11 justify-center" : "h-10 px-3",
                    active ? "text-white" : "text-white/60 hover:bg-white/[0.04] hover:text-white",
                  )}
                  aria-current={active ? "page" : undefined}
                  title={collapsed ? item.label : undefined}
                >
                  {active && (
                    <motion.span
                      layoutId="nav-active"
                      className="absolute inset-0 rounded-md bg-[linear-gradient(90deg,rgba(47,128,255,.28),rgba(47,128,255,.08))] shadow-[inset_0_0_0_1px_rgba(110,170,255,.35)]"
                      transition={{ type: "spring", stiffness: 500, damping: 36 }}
                    />
                  )}
                  {active && !collapsed && <span className="absolute -left-3 top-2 bottom-2 w-[3px] rounded-r bg-accent shadow-[0_0_12px_#2f80ff]" />}
                  <I className="relative h-[18px] w-[18px] shrink-0" style={{ color: active ? item.color ?? "#8cbcff" : item.color ? `${item.color}cc` : undefined }} aria-hidden />
                  {!collapsed && <span className="relative truncate">{item.label}</span>}
                  {!collapsed && item.part && item.part !== 1 && (
                    <span className="relative ml-auto rounded px-1.5 py-0.5 text-[10px] font-semibold text-white/30 ring-1 ring-inset ring-white/10">
                      {item.to === "/playground/chemistry" ? "LIVE" : "SOON"}
                    </span>
                  )}
                </NavLink>
              );
            })}
          </div>
        ))}
        {isAdmin(me) && (
          <NavLink
            to="/admin"
            className={cx("mt-3 flex items-center gap-3 rounded-md text-sm font-medium text-white/60 hover:text-white", collapsed ? "mx-auto h-11 w-11 justify-center" : "h-10 px-3")}
          >
            <Shield className="h-[18px] w-[18px]" aria-hidden />
            {!collapsed && "Admin"}
          </NavLink>
        )}
      </nav>
      {!collapsed && me && me.plan === "free" && <PremiumNudge />}
      <button
        onClick={onToggle}
        className="flex h-11 items-center justify-center gap-2 border-t border-white/[0.06] text-xs text-white/40 hover:text-white"
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        {collapsed ? <ChevronsRight className="h-4 w-4" /> : (<><ChevronsLeft className="h-4 w-4" /> Collapse</>)}
      </button>
    </aside>
  );
}

function PremiumNudge() {
  return (
    <Link
      to="/plans"
      className="group relative mx-3 mb-3 overflow-hidden rounded-lg p-3.5 ring-1 ring-inset ring-[#ffc23d]/30"
      style={{ background: "linear-gradient(135deg, rgba(255,194,61,.16), rgba(255,138,61,.06) 60%, rgba(139,92,246,.12))" }}
    >
      <span className="ls-premium-border pointer-events-none absolute inset-0 rounded-lg" aria-hidden />
      <div className="flex items-center gap-2 text-sm font-semibold text-[#ffd77a]">
        <Crown className="h-4 w-4" /> Go Premium
      </div>
      <p className="mt-1 text-xs text-white/60">Full library, every scenario, no ads.</p>
    </Link>
  );
}

/* ------------------------------------------------------------------ top bar */

function TopBar({ onSearch }: { onSearch: () => void }) {
  const { me, loading } = useSession();
  const { settings, update } = useSettings();
  const login = me?.streaks.find((s) => s.kind === "login")?.days ?? 0;
  const lvl = me?.level;
  const progress = lvl ? (lvl.xpForNext ? lvl.xpIntoLevel / lvl.xpForNext : 1) : 0;

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-white/[0.06] bg-[#0b1020]/75 px-4 backdrop-blur-xl sm:px-6 lg:px-8">
      <Link to="/" className="flex items-center gap-2 lg:hidden" aria-label="LABscape home">
        <LogoMark size={28} />
      </Link>
      <button
        onClick={onSearch}
        className="flex h-10 min-w-0 flex-1 items-center gap-2.5 rounded-md bg-white/[0.05] px-3 text-sm text-white/45 ring-1 ring-inset ring-white/[0.08] transition hover:bg-white/[0.08] hover:text-white/70 sm:max-w-md"
        aria-label="Search experiments, concepts, elements and formulas"
      >
        <Search className="h-4 w-4 shrink-0" />
        <span className="truncate">Search experiments, elements, formulas…</span>
        <span className="ml-auto hidden items-center gap-1 sm:flex">
          <Kbd>Ctrl</Kbd>
          <Kbd>K</Kbd>
        </span>
      </button>
      <AutosaveIndicator />
      <div className="ml-auto flex items-center gap-1.5 sm:gap-2.5">
        {loading ? (
          <Skeleton className="h-9 w-40" />
        ) : me ? (
          <>
            <div className="hidden items-center gap-1.5 rounded-md px-2 py-1.5 sm:flex" title={`${login}-day login streak`}>
              <StreakFlame days={login} />
              <span className="tabular text-sm font-semibold">{login}</span>
            </div>
            <Link
              to="/progress"
              id="xp-counter"
              className="group flex items-center gap-2.5 rounded-md py-1 pl-1 pr-3 ring-1 ring-inset ring-white/[0.08] transition hover:bg-white/[0.05]"
              aria-label={`Level ${(lvl?.index ?? 0) + 1}, ${me.totalXp} XP`}
            >
              <ProgressRing value={progress} size={32} stroke={3.5} color="#22D3EE">
                <span className="font-heading text-xs font-bold">{(lvl?.index ?? 0) + 1}</span>
              </ProgressRing>
              <span className="leading-tight">
                <span data-xp-value className="tabular block text-sm font-semibold">
                  {me.totalXp.toLocaleString()} <span className="text-white/45">XP</span>
                </span>
                <span className="hidden text-[11px] text-white/45 md:block">{lvl?.name}</span>
              </span>
            </Link>
            <NotificationBell unread={me.unreadNotifications} />
            <button
              onClick={() => update({ contextPanelOpen: !settings.contextPanelOpen })}
              className="hidden h-10 w-10 place-items-center rounded-md text-white/55 hover:bg-white/[0.06] hover:text-white 2xl:grid"
              aria-label={settings.contextPanelOpen ? "Hide side panel" : "Show side panel"}
            >
              {settings.contextPanelOpen ? <PanelRightClose className="h-5 w-5" /> : <PanelRightOpen className="h-5 w-5" />}
            </button>
            <AvatarMenu />
          </>
        ) : (
          <>
            <Link to="/login" className="hidden sm:block">
              <Button variant="ghost" size="sm" icon={<LogIn className="h-4 w-4" />}>
                Sign in
              </Button>
            </Link>
            <Link to="/onboarding">
              <Button size="sm">Get started</Button>
            </Link>
          </>
        )}
      </div>
    </header>
  );
}

function AutosaveIndicator() {
  const { autosave } = useShell();
  const [, tick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);
  if (autosave.state === "idle") return null;
  const secs = autosave.at ? Math.max(0, Math.round((Date.now() - autosave.at) / 1000)) : 0;
  return (
    <span className="hidden items-center gap-1.5 text-xs text-white/45 md:flex" aria-live="polite">
      {autosave.state === "saving" && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent-cyan" />}
      {autosave.state === "saved" && <Check className="h-3.5 w-3.5 text-state-success" />}
      {autosave.state === "error" && <CloudOff className="h-3.5 w-3.5 text-state-danger" />}
      {autosave.state === "saving" ? "Saving…" : autosave.state === "saved" ? `Saved ${secs < 5 ? "just now" : `${secs}s ago`}` : "Not saved"}
    </span>
  );
}

function NotificationBell({ unread }: { unread: number }) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { reduced } = useMotion();
  const ref = useRef<HTMLDivElement>(null);
  const prevUnread = useRef(unread);
  const [wiggle, setWiggle] = useState(0);
  const q = useQuery({ queryKey: ["notifications"], queryFn: () => api<{ items: NotificationItem[]; unread: number }>("/v1/notifications"), enabled: open, staleTime: 10_000 });
  const count = q.data?.unread ?? unread;

  useEffect(() => {
    if (unread > prevUnread.current) {
      setWiggle((w) => w + 1);
      sound.play("notify");
    }
    prevUnread.current = unread;
  }, [unread]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const markAll = async () => {
    await post("/v1/notifications/read-all");
    void qc.invalidateQueries({ queryKey: ["notifications"] });
    void qc.invalidateQueries({ queryKey: ["me"] });
  };

  return (
    <div ref={ref} className="relative">
      <motion.button
        key={wiggle}
        animate={wiggle && !reduced ? { rotate: [0, -14, 12, -10, 8, 0] } : {}}
        transition={{ duration: 0.6 }}
        onClick={() => {
          setOpen((o) => !o);
          sound.play(open ? "close" : "open");
        }}
        className="relative grid h-10 w-10 place-items-center rounded-md text-white/65 hover:bg-white/[0.06] hover:text-white"
        aria-label={`Notifications${count ? `, ${count} unread` : ""}`}
        aria-expanded={open}
      >
        <Bell className="h-5 w-5" />
        <AnimatePresence>
          {count > 0 && (
            <motion.span
              key={count}
              initial={{ scale: 0.4 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
              transition={{ type: "spring", stiffness: 500, damping: 18 }}
              className="absolute right-1 top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-state-danger px-1 text-[10px] font-bold text-white ring-2 ring-[#0b1020]"
            >
              {count > 9 ? "9+" : count}
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ type: "spring", stiffness: 500, damping: 34 }}
            className="absolute right-0 top-12 z-50 w-[min(380px,calc(100vw-24px))] overflow-hidden rounded-xl border border-white/10 bg-[#141b2e]/98 shadow-[0_30px_80px_-20px_rgba(0,0,0,.9)] backdrop-blur-xl"
          >
            <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
              <span className="font-heading font-semibold">Notifications</span>
              {count > 0 && (
                <button onClick={markAll} className="text-xs font-semibold text-accent-cyan hover:underline">
                  Mark all read
                </button>
              )}
            </div>
            <div className="ls-scroll max-h-[420px] overflow-y-auto">
              {q.isLoading ? (
                <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}</div>
              ) : q.data?.items.length ? (
                q.data.items.map((n) => (
                  <button
                    key={n.id}
                    onClick={async () => {
                      if (!n.read) await post(`/v1/notifications/${n.id}/read`);
                      void qc.invalidateQueries({ queryKey: ["notifications"] });
                      void qc.invalidateQueries({ queryKey: ["me"] });
                      setOpen(false);
                      if (n.link) navigate(n.link);
                    }}
                    className="flex w-full gap-3 border-b border-white/[0.04] px-4 py-3 text-left transition hover:bg-white/[0.04]"
                  >
                    <span className={cx("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.read ? "bg-transparent" : "bg-accent shadow-[0_0_8px_#2f80ff]")} />
                    <span className="min-w-0">
                      <span className={cx("block text-sm", n.read ? "text-white/65" : "font-semibold text-white")}>{n.title}</span>
                      {n.body && <span className="mt-0.5 block text-xs text-white/50">{n.body}</span>}
                      <span className="mt-1 block text-[11px] text-white/35">{timeAgo(n.createdAt)}</span>
                    </span>
                  </button>
                ))
              ) : (
                <div className="px-4 py-10 text-center text-sm text-white/50">You're all caught up ✨</div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function AvatarMenu() {
  const { me, logout } = useSession();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);
  if (!me) return null;
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-label="Account menu" aria-expanded={open} className="rounded-full">
        <Avatar name={me.displayName} spec={me.profile.avatar} size={36} ring={me.plan !== "free" ? "#ffc23d" : "#2f80ff"} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ type: "spring", stiffness: 500, damping: 34 }}
            className="absolute right-0 top-12 z-50 w-64 overflow-hidden rounded-xl border border-white/10 bg-[#141b2e]/98 p-1.5 shadow-[0_30px_80px_-20px_rgba(0,0,0,.9)] backdrop-blur-xl"
          >
            <div className="px-3 py-2.5">
              <div className="font-semibold">{me.displayName}</div>
              <div className="text-xs text-white/45">{me.guest ? "Guest — progress saved on this device" : `@${me.username}`}</div>
              {me.plan !== "free" && <Chip tone="gold" className="mt-2"><Crown className="h-3 w-3" /> Premium</Chip>}
            </div>
            <div className="my-1 h-px bg-white/[0.06]" />
            {me.guest && (
              <MenuItem icon={<UserRound className="h-4 w-4" />} onClick={() => navigate("/signup")} highlight>
                Save your progress
              </MenuItem>
            )}
            <MenuItem icon={<UserRound className="h-4 w-4" />} onClick={() => navigate("/profile")}>Profile</MenuItem>
            <MenuItem icon={<Crown className="h-4 w-4" />} onClick={() => navigate("/plans")}>Plans & billing</MenuItem>
            <MenuItem icon={<SettingsIcon className="h-4 w-4" />} onClick={() => navigate("/settings")}>Settings</MenuItem>
            <div className="my-1 h-px bg-white/[0.06]" />
            <MenuItem
              icon={<LogOut className="h-4 w-4" />}
              onClick={async () => {
                await logout();
                navigate("/welcome");
              }}
            >
              {me.guest ? "Leave guest session" : "Sign out"}
            </MenuItem>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function MenuItem({ icon, children, onClick, highlight }: { icon: ReactNode; children: ReactNode; onClick: () => void; highlight?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cx("flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition", highlight ? "text-accent-cyan hover:bg-accent-cyan/10" : "text-white/75 hover:bg-white/[0.06] hover:text-white")}
    >
      {icon}
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ context panel */

function ContextPanel({ open }: { open: boolean }) {
  const { registerPanelTarget } = useShell();
  const { me } = useSession();
  const [tab, setTab] = useState<ContextPanelSlotName>("progress");
  // Stable ref callbacks: inline ones would re-register on every render and loop.
  const slotRefs = useMemo(
    () => ({
      progress: (el: HTMLElement | null) => registerPanelTarget("progress", el),
      assistant: (el: HTMLElement | null) => registerPanelTarget("assistant", el),
      info: (el: HTMLElement | null) => registerPanelTarget("info", el),
    }),
    [registerPanelTarget],
  );
  if (!me) return null;
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.aside
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 360, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ type: "spring", stiffness: 220, damping: 26 }}
          className="sticky top-16 hidden h-[calc(100vh-64px)] shrink-0 overflow-hidden border-l border-white/[0.06] bg-[#0d1426]/60 2xl:block"
          aria-label="Context panel"
        >
          <div className="ls-scroll h-full w-[360px] overflow-y-auto p-5">
            <div className="mb-4 flex gap-1 rounded-lg bg-black/25 p-1 ring-1 ring-inset ring-white/10">
              {(["progress", "assistant", "info"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={cx("flex-1 rounded-md py-1.5 text-xs font-semibold capitalize transition", tab === t ? "bg-accent/25 text-white" : "text-white/50 hover:text-white/80")}
                >
                  {t}
                </button>
              ))}
            </div>
            <div hidden={tab !== "progress"}>
              <ProgressPanel />
              <div ref={slotRefs.progress} />
            </div>
            <div hidden={tab !== "assistant"} ref={slotRefs.assistant}>
              <div className="rounded-xl border border-ai-violet/30 bg-[linear-gradient(160deg,rgba(139,92,246,.18),rgba(232,121,249,.06))] p-4">
                <div className="flex items-center gap-2 font-heading font-semibold">
                  <span className="ls-orb h-7 w-7 rounded-full" /> AI science assistant
                </div>
                <p className="mt-2 text-sm text-white/65">Ask about any reaction, formula or step. Arriving with Part 4 — it will read what's on your bench.</p>
              </div>
            </div>
            <div hidden={tab !== "info"} ref={slotRefs.info}>
              <p className="text-sm text-white/50">Open an experiment or element to see details here.</p>
            </div>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

function ProgressPanel() {
  const { me } = useSession();
  const q = useQuery({ queryKey: ["challenges"], queryFn: () => api<Challenge[]>("/v1/challenges/today"), enabled: !!me });
  if (!me) return null;
  const lvl = me.level;
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">Level {lvl.index + 1}</div>
            <div className="font-heading text-lg font-semibold">{lvl.name}</div>
          </div>
          <StreakFlame days={me.streaks.find((s) => s.kind === "login")?.days ?? 0} size={28} />
        </div>
        <XpBar value={lvl.xpForNext ? lvl.xpIntoLevel / lvl.xpForNext : 1} className="mt-3" />
        <div className="tabular mt-1.5 flex justify-between text-xs text-white/45">
          <span>{lvl.xpIntoLevel.toLocaleString()} XP</span>
          <span>{lvl.xpForNext ? `${(lvl.xpForNext - lvl.xpIntoLevel).toLocaleString()} to go` : "Max level"}</span>
        </div>
      </div>
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">Today's challenges</span>
          <span className="tabular text-xs text-white/40">{q.data?.filter((c) => c.completed).length ?? 0}/{q.data?.length ?? 3}</span>
        </div>
        <div className="space-y-2">
          {q.isLoading
            ? [0, 1, 2].map((i) => <Skeleton key={i} className="h-16" />)
            : q.data?.map((c) => <ChallengeRow key={c.id} c={c} compact />)}
        </div>
      </div>
    </div>
  );
}

export function ChallengeRow({ c, compact }: { c: Challenge; compact?: boolean }) {
  return (
    <Link
      to={c.link}
      className={cx(
        "group flex items-center gap-3 rounded-lg border p-3 transition",
        c.completed ? "border-state-success/30 bg-state-success/[0.07]" : "border-white/[0.08] bg-white/[0.03] hover:border-accent/40 hover:bg-accent/[0.06]",
      )}
    >
      <span className={cx("grid shrink-0 place-items-center rounded-lg", compact ? "h-9 w-9" : "h-11 w-11", c.completed ? "bg-state-success/20 text-state-success" : "bg-accent/15 text-[#8cbcff]")}>
        {c.completed ? <Check className="h-5 w-5" aria-label="Completed" /> : <NamedIcon name={c.icon} className="h-5 w-5" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className={cx("block truncate text-sm font-semibold", c.completed && "text-white/70 line-through decoration-white/30")}>{c.title}</span>
        <span className="block truncate text-xs text-white/50">{c.description}</span>
        {c.target > 1 && !c.completed && (
          <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-white/10">
            <span className="block h-full rounded-full bg-accent-cyan" style={{ width: `${(c.progress / c.target) * 100}%` }} />
          </span>
        )}
      </span>
      <span className={cx("tabular shrink-0 text-xs font-bold", c.completed ? "text-state-success" : "text-[#ffd77a]")}>+{c.xp}</span>
    </Link>
  );
}

/* ------------------------------------------------------------------ mobile + states */

function MobileNav() {
  const { pathname, search } = useLocation();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-white/[0.08] bg-[#0b1020]/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden" aria-label="Main">
      <div className="grid grid-cols-5">
        {MOBILE_TABS.map((t) => {
          const active = isActive(t, pathname, search);
          const I = t.icon;
          return (
            <NavLink key={t.to} to={t.to} className={cx("relative flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium", active ? "text-white" : "text-white/50")}>
              {active && <motion.span layoutId="mobile-tab" className="absolute top-0 h-[3px] w-10 rounded-b bg-accent shadow-[0_0_12px_#2f80ff]" />}
              <I className="h-5 w-5" style={{ color: active ? "#8cbcff" : undefined }} />
              {t.label}
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}

function OfflineBanner() {
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return (
    <AnimatePresence>
      {!online && (
        <motion.div
          initial={{ y: -40 }}
          animate={{ y: 0 }}
          exit={{ y: -40 }}
          role="status"
          className="fixed inset-x-0 top-0 z-[70] flex items-center justify-center gap-2 bg-state-warning py-1.5 text-sm font-semibold text-[#2a1600]"
        >
          <WifiOff className="h-4 w-4" /> You're offline. Saved pages still work; progress will sync when you're back.
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function PageSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-10 w-72" />
      <Skeleton className="h-40" />
      <div className="grid gap-4 md:grid-cols-3">
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
      </div>
    </div>
  );
}

function FullscreenLoader() {
  return (
    <div className="grid h-screen place-items-center">
      <div className="flex flex-col items-center gap-3 text-white/50">
        <LogoMark size={44} draw />
        <span className="text-sm">Setting up the lab…</span>
      </div>
    </div>
  );
}

export function timeAgo(iso: string) {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}
