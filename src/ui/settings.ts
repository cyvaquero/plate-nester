import { DEFAULTS } from "../types";
import type { Settings } from "../types";

const KEY = "plate-nester.settings";

/** Load persisted settings, ignoring unknown keys and values of the wrong type. */
export function loadSettings(): Settings {
  const s: Settings = { ...DEFAULTS };
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "{}") as Record<string, unknown>;
    for (const k of Object.keys(DEFAULTS) as (keyof Settings)[])
      if (typeof raw[k] === typeof DEFAULTS[k]) (s as unknown as Record<string, unknown>)[k] = raw[k];
    if (s.mode !== "shape" && s.mode !== "bbox") s.mode = DEFAULTS.mode;
    if (s.unit !== "mm" && s.unit !== "in") s.unit = DEFAULTS.unit;
  } catch {
    /* storage unavailable or corrupt: use defaults */
  }
  return s;
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}
