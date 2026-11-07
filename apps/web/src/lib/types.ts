/** Response shapes of Part 1's /v1 endpoints (mirrors apps/api core.*). */
import type { RewardResult } from "@labscape/contracts";

export type Level = RewardResult["level"];
export type Streak = RewardResult["streaks"][number];

export type Me = {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  guest: boolean;
  role: "student" | "teacher" | "reviewer" | "admin" | "super_admin";
  ageBand: "under_13" | "13_17" | "18_plus" | null;
  minor: boolean;
  timezone: string;
  createdAt: string;
  profile: {
    learningLevel: string | null;
    interests: string[];
    preference: string | null;
    avatar: { hue?: number | undefined; emoji?: string | undefined };
    settings: Record<string, unknown>;
    leaderboardOptOut: boolean;
    onboarded: boolean;
  };
  totalXp: number;
  level: Level;
  streaks: Streak[];
  unreadNotifications: number;
  plan: "free" | "premium_monthly" | "premium_annual";
};

export type Badge = {
  id: string;
  name: string;
  description: string;
  icon: string;
  tier: "bronze" | "silver" | "gold" | "platinum";
  target: number;
  progress: number;
  unlocked: boolean;
  unlockedAt: string | null;
};

export type Summary = {
  totalXp: number;
  level: Level;
  streaks: Streak[];
  badges: Badge[];
  xpToday: number;
  xpThisWeek: number;
  xpBySubject: Record<string, number>;
  recent: { kind: string; refId: string; subject: string | null; xp: number; at: string }[];
  counts: { experiments: number; quizzes: number; discoveries: number; challenges: number; quizAccuracy: number };
};

export type Challenge = {
  id: string;
  title: string;
  description: string;
  icon: string;
  progress: number;
  target: number;
  completed: boolean;
  xp: number;
  link: string;
};

export type ExperimentCard = {
  id: string;
  slug: string;
  subject: "chemistry" | "physics" | "maths";
  chapter: string;
  topic: string;
  title: string;
  summary: string;
  difficulty: "beginner" | "intermediate" | "advanced";
  levels: string[];
  estimatedMinutes: number;
  xpReward: number;
  stages: number;
  objectives: string[];
  equipment: string[];
  premium: boolean;
  locked: boolean;
  featured: boolean;
  completed: boolean;
  release: "MVP" | "Later";
  playable: boolean;
  relevance: number;
};

export type LibraryPage = {
  items: ExperimentCard[];
  total: number;
  facets: { subjects: Record<string, number>; chapters: string[]; equipment: string[] };
};

export type ExperimentDetail = {
  card: ExperimentCard;
  concept: string;
  elements?: string[];
  realWorld: string[];
  materials: string[];
  safety: string[];
  stageList: string[];
  related: ExperimentCard[];
};

export type BoardRow = { rank: number; prevRank: number | null; userId: string; name: string; avatar: string | null; xp: number; me: boolean };
export type Board = { scope: string; periodStart: string | null; resetsAt: string | null; rows: BoardRow[]; me: BoardRow | null; participants: number };

export type NotificationItem = { id: number; kind: string; title: string; body: string | null; link: string | null; createdAt: string; read: boolean };

export type Plan = { id: string; name: string; pricePaise: number; interval: string; features: string[]; savePaise: number | null; highlighted: boolean };
export type EntitlementsView = {
  plan: Me["plan"];
  values: Record<string, boolean | number | null | undefined>;
  status: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
};
export type Invoice = { id: string; invoiceNumber: string; amountPaise: number; gstPaise: number; currency: string; status: string; createdAt: string; plan: string | null };
