// User settings, stored on the device. Read through `settings`, change through `setSetting`.

export interface Settings {
  haptics: boolean; // vibration on supported phones, independent of sound
  patterns: boolean; // a distinct mark on each block colour, for colour-blind players
  reduce: boolean; // calmer visuals, on top of the system's reduced-motion preference
}

const KEY = "blockpuzzle.settings";
const defaults: Settings = { haptics: true, patterns: false, reduce: false };

export const settings: Settings = (() => {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<Settings> | null;
    return {
      haptics: typeof d?.haptics === "boolean" ? d.haptics : defaults.haptics,
      patterns: typeof d?.patterns === "boolean" ? d.patterns : defaults.patterns,
      reduce: typeof d?.reduce === "boolean" ? d.reduce : defaults.reduce,
    };
  } catch { return { ...defaults }; }
})();

export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
  settings[key] = value;
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* ignore */ }
}
