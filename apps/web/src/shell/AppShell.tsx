import { sound } from "@labscape/audio";
import { AssistantDock } from "../components/AssistantDock";
import { useMotion } from "@labscape/motion";
import { Avatar, Button, Chip, cx, Kbd, NamedIcon, ProgressRing, Skeleton, useShell, XpBar, type ContextPanelSlotName } from "@labscape/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import {
  Bell,
  Check,
  CheckCheck,
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
import { Link, NavLink, Outlet, useLocation, useNavigate, useOutlet } from "react-router-dom";
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
  // Captured per render so the page fading out keeps its own content (and surface) instead of
  // re-rendering the next route inside its exiting wrapper.
  const outlet = useOutlet();

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
  // Pages render straight on the cream page; lab sections load on a rounded dark stage.
  const light = !isDarkSection(location.pathname);
  return (
    <div className="ls-app-bg min-h-full">
      <OfflineBanner />
      <Sidebar collapsed={collapsed} onToggle={() => update({ sidebarCollapsed: !collapsed })} />
      <div className={cx("transition-[padding] duration-base ease-standard", collapsed ? "lg:pl-rail" : "lg:pl-sidebar")}>
        <TopBar onSearch={() => setPaletteOpen(true)} />
        <div className="flex">
          <main id="main" className="min-w-0 flex-1 px-4 pb-28 pt-2 sm:px-6 lg:px-8 lg:pb-12">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={location.pathname}
                initial={{ opacity: 0, y: reduced ? 0 : 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: d(240), ease: [0.2, 0, 0, 1] }}
              >
                <div {...(light ? {} : { "data-surface": "dark", className: "ls-stage p-4 sm:p-6 lg:p-8" })}>
                  <RouteErrorBoundary key={location.pathname}>
                    <Suspense fallback={<PageSkeleton />}>{outlet}</Suspense>
                  </RouteErrorBoundary>
                </div>
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

/**
 * Lab sections. Their pages go full screen once mounted; until a lazy page has loaded, its skeleton
 * sits on the rounded dark stage instead of the cream page. A trailing "/" matches only sub-routes
 * (the /playground list itself is a light page). Every other route (including the 404 page, which
 * can match any path) renders on the cream page.
 */
const DARK_SECTIONS = ["/lab", "/playground/"];
const isDarkSection = (path: string) => DARK_SECTIONS.some((p) => (p.endsWith("/") ? path.startsWith(p) : path === p || path.startsWith(`${p}/`)));

/** Nav accent hues are tuned for dark; these deeper tones keep the icons readable on cream. */
const ON_LIGHT: Record<string, string> = {
  "#2DD4BF": "#0F766E",
  "#38BDF8": "#0369A1",
  "#FB923C": "#C2410C",
  "#E879F9": "#A21CAF",
  "#EF4444": "#C5221F",
  "#8B5CF6": "#6D28D9",
};
const onLight = (c?: string) => (c ? ON_LIGHT[c.toUpperCase()] ?? c : undefined);

/* ------------------------------------------------------------------ sidebar */

function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { pathname, search } = useLocation();
  const { me } = useSession();
  return (
    <aside
      className={cx(
        "fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-line bg-surface transition-[width] duration-base ease-standard lg:flex",
        collapsed ? "w-rail" : "w-sidebar",
      )}
      aria-label="Main navigation"
    >
      <div className={cx("flex h-[72px] items-center gap-2.5", collapsed ? "justify-center" : "px-6")}>
        <Link to="/" className="flex items-center gap-2" aria-label="LABscape home">
          <LogoMark size={28} />
          {!collapsed && <Wordmark size={20} />}
        </Link>
      </div>
      <nav className="ls-scroll flex-1 overflow-y-auto overflow-x-hidden px-3 pb-4">
        {NAV.map((group, gi) => (
          <div key={gi} className="mt-4 first:mt-0">
            {group.label &&
              (collapsed ? (
                <div className="mx-auto my-2 h-px w-6 bg-line" />
              ) : (
                <div className="mb-1 px-4 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-muted">{group.label}</div>
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
                    "group relative flex items-center gap-3 rounded-full text-[14px] font-medium transition-colors duration-fast",
                    collapsed ? "mx-auto h-11 w-11 justify-center" : "h-10 px-4",
                    active ? "text-ink-strong" : "text-ink-muted hover:bg-line/70 hover:text-ink-strong",
                  )}
                  aria-current={active ? "page" : undefined}
                  title={collapsed ? item.label : undefined}
                >
                  {active && (
                    <motion.span
                      layoutId="nav-active"
                      className="absolute inset-0 rounded-full bg-line-strong"
                      transition={{ type: "spring", stiffness: 500, damping: 36 }}
                    />
                  )}
                  <I className="relative h-[18px] w-[18px] shrink-0" style={{ color: onLight(item.color) }} aria-hidden />
                  {!collapsed && <span className="relative truncate">{item.label}</span>}
                  {!collapsed && item.part && item.part !== 1 && (
                    <span className="relative ml-auto rounded-full px-2 py-0.5 text-[10px] font-semibold text-ink-muted ring-1 ring-inset ring-line-strong">
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
            className={cx("mt-3 flex items-center gap-3 rounded-full text-[14px] font-medium text-ink-muted hover:bg-line/70 hover:text-ink-strong", collapsed ? "mx-auto h-11 w-11 justify-center" : "h-10 px-4")}
          >
            <Shield className="h-[18px] w-[18px]" aria-hidden />
            {!collapsed && "Admin"}
          </NavLink>
        )}
      </nav>
      {!collapsed && me && me.plan === "free" && <PremiumNudge />}
      <button
        onClick={onToggle}
        className="flex h-12 items-center justify-center gap-2 border-t border-line text-xs font-medium text-ink-muted transition-colors hover:text-ink-strong"
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
      className="group relative mx-3 mb-3 overflow-hidden rounded-[20px] bg-tint-yellow p-4 text-[#2a1600] transition-colors hover:bg-ink-strong hover:text-tint-yellow"
    >
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Crown className="h-4 w-4" /> Go Premium
        <span className="ml-auto transition-transform group-hover:translate-x-0.5" aria-hidden>→</span>
      </div>
      <p className="mt-1 text-xs opacity-80">No ads, more AI help, detailed reports.</p>
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
    <header className="sticky top-0 z-30 flex h-[72px] items-center gap-3 bg-surface/85 px-4 backdrop-blur-md sm:px-6 lg:px-8">
      <Link to="/" className="flex items-center gap-2 lg:hidden" aria-label="LABscape home">
        <LogoMark size={28} />
      </Link>
      <button
        onClick={onSearch}
        className="flex h-11 min-w-0 flex-1 items-center gap-2.5 rounded-full bg-card px-4 text-sm text-ink-muted ring-1 ring-inset ring-line transition hover:text-ink hover:ring-line-strong sm:max-w-md"
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
            <div className="hidden h-11 items-center gap-1.5 rounded-full bg-card px-3 ring-1 ring-inset ring-line sm:flex" title={`${login}-day login streak`}>
              <StreakFlame days={login} size={20} />
              <span className="tabular text-sm font-semibold text-ink-strong">{login}</span>
            </div>
            <Link
              to="/progress"
              id="xp-counter"
              className="group flex h-11 items-center gap-2.5 rounded-full bg-card py-1 pl-1.5 pr-4 ring-1 ring-inset ring-line transition hover:ring-line-strong"
              aria-label={`Level ${(lvl?.index ?? 0) + 1}, ${me.totalXp} XP`}
            >
              <ProgressRing value={progress} size={32} stroke={3.5} color="#2F80FF">
                <span className="font-heading text-xs font-bold text-ink-strong">{(lvl?.index ?? 0) + 1}</span>
              </ProgressRing>
              <span className="leading-tight">
                <span data-xp-value className="tabular block text-sm font-semibold text-ink-strong">
                  {me.totalXp.toLocaleString()} <span className="font-normal text-ink-muted">XP</span>
                </span>
                <span className="hidden text-[11px] text-ink-muted md:block">{lvl?.name}</span>
              </span>
            </Link>
            <NotificationBell unread={me.unreadNotifications} />
            <button
              onClick={() => update({ contextPanelOpen: !settings.contextPanelOpen })}
              className="hidden h-11 w-11 place-items-center rounded-full text-ink-muted ring-1 ring-inset ring-line transition hover:bg-card hover:text-ink-strong 2xl:grid"
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
    <span className="hidden items-center gap-1.5 text-xs text-ink-muted md:flex" aria-live="polite">
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
        className={cx(
          "relative grid h-11 w-11 place-items-center rounded-full ring-1 ring-inset transition",
          open ? "bg-ink-strong text-on-ink ring-ink-strong" : "text-ink-muted ring-line hover:bg-card hover:text-ink-strong",
        )}
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
              className="absolute -right-0.5 -top-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-[#D93025] px-1 text-[10px] font-bold text-white ring-2 ring-surface"
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
            // Phones: pinned to the screen edges (the bell is not at the edge, so a right-anchored
            // panel would run off the left side). The header's backdrop blur makes it the containing
            // block, and it spans the full width there.
            className="fixed inset-x-3 top-[66px] z-50 overflow-hidden rounded-card bg-card shadow-pop ring-1 ring-inset ring-line sm:absolute sm:inset-x-auto sm:right-0 sm:top-[52px] sm:w-[380px]"
          >
            <div className="flex items-center justify-between px-5 pb-2 pt-4">
              <span className="font-heading text-lg font-medium text-ink-strong">Notifications</span>
              {count > 0 && (
                <button onClick={markAll} className="rounded-full bg-line px-3 py-1 text-xs font-medium text-ink transition hover:bg-ink-strong hover:text-on-ink">
                  Mark all read
                </button>
              )}
            </div>
            <div className="ls-scroll max-h-[420px] overflow-y-auto px-2 pb-2">
              {q.isLoading ? (
                <div className="space-y-2 p-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 rounded-2xl" />)}</div>
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
                    className="flex w-full gap-3 rounded-2xl px-3 py-3 text-left transition hover:bg-surface"
                  >
                    <span className={cx("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.read ? "bg-transparent" : "bg-accent")} />
                    <span className="min-w-0">
                      <span className={cx("block text-sm", n.read ? "text-ink-muted" : "font-medium text-ink-strong")}>{noEmoji(n.title)}</span>
                      {n.body && <span className="mt-0.5 block text-xs text-ink-muted">{n.body}</span>}
                      <span className="mt-1 block text-[11px] text-ink-muted">{timeAgo(n.createdAt)}</span>
                    </span>
                  </button>
                ))
              ) : (
                <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-sm text-ink-muted">
                  <span className="grid h-10 w-10 place-items-center rounded-full bg-surface text-ink-strong">
                    <CheckCheck className="h-5 w-5" aria-hidden />
                  </span>
                  You're all caught up
                </div>
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
      <button onClick={() => setOpen((o) => !o)} aria-label="Account menu" aria-expanded={open} className="grid h-11 w-11 place-items-center rounded-full">
        <Avatar name={me.displayName} spec={me.profile.avatar} size={38} ring={me.plan !== "free" ? "#ffc23d" : undefined} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ type: "spring", stiffness: 500, damping: 34 }}
            className="absolute right-0 top-[52px] z-50 w-72 overflow-hidden rounded-card bg-card p-2 shadow-pop ring-1 ring-inset ring-line"
          >
            <div className="flex items-center gap-3 px-3 py-3">
              <Avatar name={me.displayName} spec={me.profile.avatar} size={40} />
              <div className="min-w-0">
                <div className="truncate font-medium text-ink-strong">{me.displayName}</div>
                <div className="text-xs text-ink-muted">{me.guest ? "Guest — progress saved on this device" : `@${me.username}`}</div>
                {me.plan !== "free" && <Chip tone="gold" className="mt-2"><Crown className="h-3 w-3" /> Premium</Chip>}
              </div>
            </div>
            <div className="mx-3 my-1 h-px bg-line" />
            {me.guest && (
              <MenuItem icon={<UserRound className="h-4 w-4" />} onClick={() => navigate("/signup")} highlight>
                Save your progress
              </MenuItem>
            )}
            <MenuItem icon={<UserRound className="h-4 w-4" />} onClick={() => navigate("/profile")}>Profile</MenuItem>
            <MenuItem icon={<Crown className="h-4 w-4" />} onClick={() => navigate("/plans")}>Plans & billing</MenuItem>
            <MenuItem icon={<SettingsIcon className="h-4 w-4" />} onClick={() => navigate("/settings")}>Settings</MenuItem>
            <div className="mx-3 my-1 h-px bg-line" />
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
      className={cx(
        "flex w-full items-center gap-3 rounded-full px-3 py-2.5 text-left text-sm transition",
        highlight ? "bg-ink-strong font-medium text-on-ink hover:bg-ink-strong/85" : "text-ink hover:bg-surface hover:text-ink-strong",
      )}
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
          className="sticky top-[72px] hidden h-[calc(100vh-72px)] shrink-0 overflow-hidden 2xl:block"
          aria-label="Context panel"
        >
          <div className="ls-scroll h-full w-[360px] overflow-y-auto pb-5 pl-1 pr-6 pt-2">
            <div className="mb-4 flex gap-1 rounded-full bg-card p-1 ring-1 ring-inset ring-line">
              {(["progress", "assistant", "info"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={cx("flex-1 rounded-full py-2 text-xs font-medium capitalize transition", tab === t ? "bg-ink-strong text-on-ink" : "text-ink-muted hover:text-ink-strong")}
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
              <div className="h-[calc(100vh-160px)] overflow-hidden rounded-card bg-card p-3">
                {/* The default placeholder is too long for this narrow panel and wraps. */}
                {tab === "assistant" && <AssistantDock compact panel={{ placeholder: "Ask a question…" }} />}
              </div>
            </div>
            {/* The placeholder hides itself once a page portals its own details in here. */}
            <div hidden={tab !== "info"} ref={slotRefs.info} className="rounded-card bg-card p-5 [&>p:not(:only-child)]:hidden">
              <p className="text-sm text-ink-muted">Open an experiment or element to see details here.</p>
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
    <div className="space-y-3">
      <div className="rounded-card bg-card p-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-muted">Level {lvl.index + 1}</div>
            <div className="font-heading text-xl font-medium tracking-tight text-ink-strong">{lvl.name}</div>
          </div>
          <StreakFlame days={me.streaks.find((s) => s.kind === "login")?.days ?? 0} size={28} />
        </div>
        <XpBar value={lvl.xpForNext ? lvl.xpIntoLevel / lvl.xpForNext : 1} className="mt-4" />
        <div className="tabular mt-2 flex justify-between text-xs text-ink-muted">
          <span>{lvl.xpIntoLevel.toLocaleString()} XP</span>
          <span>{lvl.xpForNext ? `${(lvl.xpForNext - lvl.xpIntoLevel).toLocaleString()} to go` : "Max level"}</span>
        </div>
      </div>
      <div className="rounded-card bg-card p-3">
        <div className="mb-2 flex items-center justify-between px-2 pt-1">
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-muted">Today's challenges</span>
          <span className="tabular text-xs text-ink-muted">{q.data?.filter((c) => c.completed).length ?? 0}/{q.data?.length ?? 3}</span>
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
        "group flex items-center gap-3 rounded-[20px] p-3 transition",
        c.completed ? "bg-[#E3F6EA]" : "bg-surface hover:bg-line",
      )}
    >
      <span className={cx("grid shrink-0 place-items-center rounded-full", compact ? "h-9 w-9" : "h-11 w-11", c.completed ? "bg-tint-green text-[#0B4D27]" : "bg-card text-ink-strong ring-1 ring-inset ring-line")}>
        {c.completed ? <Check className="h-5 w-5" aria-label="Completed" /> : <NamedIcon name={c.icon} className="h-5 w-5" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className={cx("block truncate text-sm font-medium text-ink-strong", c.completed && "text-ink-muted line-through decoration-ink/30")}>{c.title}</span>
        <span className="block truncate text-xs text-ink-muted">{c.description}</span>
        {c.target > 1 && !c.completed && (
          <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-ink/10">
            <span className="block h-full rounded-full bg-accent" style={{ width: `${(c.progress / c.target) * 100}%` }} />
          </span>
        )}
      </span>
      <span className={cx("tabular shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold", c.completed ? "text-[#11703A]" : "bg-tint-yellow text-[#3d2a00]")}>+{c.xp}</span>
    </Link>
  );
}

/* ------------------------------------------------------------------ mobile + states */

function MobileNav() {
  const { pathname, search } = useLocation();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden" aria-label="Main">
      <div className="grid grid-cols-5">
        {MOBILE_TABS.map((t) => {
          const active = isActive(t, pathname, search);
          const I = t.icon;
          return (
            <NavLink key={t.to} to={t.to} className={cx("relative flex flex-col items-center gap-1 pb-2.5 pt-2 text-[11px] font-medium", active ? "text-ink-strong" : "text-ink-muted")}>
              <span className="relative grid h-8 w-14 place-items-center">
                {active && <motion.span layoutId="mobile-tab" className="absolute inset-0 rounded-full bg-line-strong" transition={{ type: "spring", stiffness: 500, damping: 36 }} />}
                <I className="relative h-5 w-5" />
              </span>
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
      <div className="flex flex-col items-center gap-3 text-ink-muted">
        <LogoMark size={44} draw />
        <span className="text-sm">Setting up the lab…</span>
      </div>
    </div>
  );
}

/** The UI shows no emojis; notifications saved before that rule may still carry one. */
const noEmoji = (s: string) => s.replace(/\p{Extended_Pictographic}\uFE0F?/gu, "").replace(/\s{2,}/g, " ").trim();

export function timeAgo(iso: string) {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}
