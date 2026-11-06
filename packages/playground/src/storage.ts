/**
 * Per-viewer progress for the playground. Real XP is awarded server-side by Part 1's rewards
 * service via ProgressEvent ("playground.discovery"); this only remembers what the viewer found.
 */
export type FoundDiscovery = { at: number; equationLatex: string };

const KEY = "labscape.playground.discoveries.v1";
const SOUND_KEY = "labscape.playground.muted";

export function loadDiscoveries(): Record<string, FoundDiscovery> {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Record<string, FoundDiscovery>) : {};
  } catch {
    return {};
  }
}

export function saveDiscoveries(d: Record<string, FoundDiscovery>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    /* storage unavailable: progress lives for this page only */
  }
}

export function loadMuted(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveMuted(m: boolean) {
  try {
    localStorage.setItem(SOUND_KEY, m ? "1" : "0");
  } catch {
    /* ignore */
  }
}
