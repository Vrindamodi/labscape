import {
  Atom,
  Beaker,
  BookOpenText,
  Brain,
  ChartNoAxesCombined,
  Columns2,
  FlaskConical,
  FunctionSquare,
  LayoutDashboard,
  Library,
  ListChecks,
  NotebookPen,
  Orbit,
  Settings,
  ShieldAlert,
  Sigma,
  Sparkles,
  Trophy,
  UserRound,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  color?: string;
  /** Part that builds the page; anything not Part 1 shows a "coming in Part N" screen until it lands. */
  part?: 1 | 2 | 3 | 4;
  match?: (path: string, search: string) => boolean;
};

export type NavGroup = { label?: string; items: NavItem[] };

/** Sidebar order from build plan 1.1. */
export const NAV: NavGroup[] = [
  {
    items: [
      { to: "/", label: "Dashboard", icon: LayoutDashboard, part: 1, match: (p) => p === "/" },
      { to: "/library", label: "Library", icon: Library, part: 1, match: (p, s) => p.startsWith("/library") && !s.includes("subject=") },
    ],
  },
  {
    label: "Labs",
    items: [
      { to: "/library?subject=chemistry", label: "Chemistry", icon: FlaskConical, color: "#2DD4BF", part: 1, match: (p, s) => p.startsWith("/library") && s.includes("subject=chemistry") },
      { to: "/library?subject=physics", label: "Physics", icon: Orbit, color: "#38BDF8", part: 1, match: (p, s) => p.startsWith("/library") && s.includes("subject=physics") },
      { to: "/library?subject=maths", label: "Maths", icon: Sigma, color: "#FB923C", part: 1, match: (p, s) => p.startsWith("/library") && s.includes("subject=maths") },
      { to: "/playground", label: "Playground", icon: Beaker, color: "#E879F9", part: 1, match: (p) => p.startsWith("/playground") },
      { to: "/emergency", label: "Emergency", icon: ShieldAlert, color: "#EF4444", part: 1 },
      { to: "/assistant", label: "Assistant", icon: Sparkles, color: "#8B5CF6", part: 1 },
      { to: "/quizzes", label: "Quizzes", icon: ListChecks, part: 1 },
      { to: "/compare", label: "Compare", icon: Columns2, part: 1 },
    ],
  },
  {
    label: "You",
    items: [
      { to: "/achievements", label: "Achievements", icon: Trophy, part: 1 },
      { to: "/progress", label: "Progress", icon: ChartNoAxesCombined, part: 1 },
      { to: "/leaderboard", label: "Leaderboard", icon: Users, part: 1 },
    ],
  },
  {
    label: "Resources",
    items: [
      { to: "/periodic-table", label: "Periodic Table", icon: Atom, part: 1 },
      { to: "/equipment", label: "Equipment", icon: Wrench, part: 1 },
      { to: "/formulas", label: "Formulas", icon: FunctionSquare, part: 1 },
      { to: "/notebook", label: "Notebook", icon: NotebookPen, part: 1 },
      { to: "/community", label: "Community", icon: Brain, part: 1 },
    ],
  },
  {
    items: [
      { to: "/profile", label: "Profile", icon: UserRound, part: 1 },
      { to: "/settings", label: "Settings", icon: Settings, part: 1 },
    ],
  },
];

export const MOBILE_TABS: NavItem[] = [
  { to: "/", label: "Home", icon: LayoutDashboard, match: (p) => p === "/" },
  { to: "/library", label: "Labs", icon: BookOpenText, match: (p) => p.startsWith("/library") },
  { to: "/playground", label: "Playground", icon: Beaker, match: (p) => p.startsWith("/playground") },
  { to: "/assistant", label: "AI", icon: Sparkles },
  { to: "/profile", label: "Profile", icon: UserRound, match: (p) => ["/profile", "/progress", "/achievements", "/settings"].some((x) => p.startsWith(x)) },
];

export function isActive(item: NavItem, path: string, search: string) {
  if (item.match) return item.match(path, search);
  return path === item.to || path.startsWith(`${item.to}/`);
}
