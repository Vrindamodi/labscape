import { sound, type AudioChannel, DEFAULT_BUS_SETTINGS } from "@labscape/audio";
import type { MotionPrefs } from "@labscape/motion";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

/** Settings and accessibility (build plan 1.10). Kept locally and synced to the profile when signed in. */
export type Settings = {
  animationSpeed: number;
  reducedMotion: MotionPrefs["reduced"];
  palette: "none" | "deuteranopia" | "protanopia" | "tritanopia";
  textSize: "normal" | "large" | "xlarge";
  captions: boolean;
  haptics: boolean;
  muted: boolean;
  master: number;
  volumes: Record<AudioChannel, number>;
  aiVoice: boolean;
  sidebarCollapsed: boolean;
  contextPanelOpen: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  animationSpeed: 1,
  reducedMotion: "system",
  palette: "none",
  textSize: "normal",
  captions: true,
  haptics: true,
  muted: false,
  master: DEFAULT_BUS_SETTINGS.master,
  volumes: { ...DEFAULT_BUS_SETTINGS.channels },
  aiVoice: false,
  sidebarCollapsed: false,
  contextPanelOpen: true,
};

const KEY = "labscape.settings.v1";

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...DEFAULT_SETTINGS, ...parsed, volumes: { ...DEFAULT_SETTINGS.volumes, ...parsed.volumes } };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

type Ctx = { settings: Settings; update: (patch: Partial<Settings>) => void; replace: (s: Partial<Settings>) => void };
const SettingsCtx = createContext<Ctx | null>(null);

export function SettingsProvider({ children, onSync }: { children: ReactNode; onSync?: (s: Settings) => void }) {
  const [settings, setSettings] = useState<Settings>(load);
  const syncRef = useRef(onSync);
  syncRef.current = onSync;
  const timer = useRef<number>();

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(settings));
    } catch {
      // private mode: settings still apply for this session
    }
    const root = document.documentElement;
    root.dataset.palette = settings.palette;
    root.dataset.textSize = settings.textSize;
    sound.configure({ master: settings.master, channels: settings.volumes, muted: settings.muted, haptics: settings.haptics });
  }, [settings]);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((s) => {
      const next = { ...s, ...patch };
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => syncRef.current?.(next), 600);
      return next;
    });
  }, []);

  /** Apply settings that came from the server without syncing them back. */
  const replace = useCallback((s: Partial<Settings>) => {
    setSettings((cur) => ({ ...cur, ...s, volumes: { ...cur.volumes, ...s.volumes } }));
  }, []);

  const value = useMemo(() => ({ settings, update, replace }), [settings, update, replace]);
  return <SettingsCtx.Provider value={value}>{children}</SettingsCtx.Provider>;
}

export function useSettings() {
  const c = useContext(SettingsCtx);
  if (!c) throw new Error("useSettings outside provider");
  return c;
}
