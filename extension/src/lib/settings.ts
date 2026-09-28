import { storage } from "#imports";
import { DEFAULT_RECORDER_CONFIG } from "@shared/types";
import type { Environment, Settings } from "./types";

const KEY = "local:settings";

export const DEFAULT_SETTINGS: Settings = {
  language: "de-DE",
  theme: "system",
  recorder: { ...DEFAULT_RECORDER_CONFIG },
  replay: { maskAllInputs: false, recordCanvas: false, blockSelector: "" },
  audio: { enabled: true },
  transcription: {
    engine: "whisper",
    whisperModel: "onnx-community/whisper-base",
    openaiKey: "",
    auto: true,
  },
  openAfterStop: true,
  environments: [
    {
      id: "local",
      name: "Lokal",
      color: "#22c55e",
      patterns: ["http://localhost:*/*", "http://127.0.0.1:*/*"],
      notes: "",
      variables: [],
    },
  ],
};

const settingsItem = storage.defineItem<Settings>(KEY, { fallback: DEFAULT_SETTINGS });

/** Tief genug mergen, dass neue Felder in alten Speicherstaenden Defaults bekommen. */
function withDefaults(value: Partial<Settings> | null | undefined): Settings {
  const v = value ?? {};
  return {
    ...DEFAULT_SETTINGS,
    ...v,
    recorder: { ...DEFAULT_SETTINGS.recorder, ...v.recorder },
    replay: { ...DEFAULT_SETTINGS.replay, ...v.replay },
    audio: { ...DEFAULT_SETTINGS.audio, ...v.audio },
    transcription: { ...DEFAULT_SETTINGS.transcription, ...v.transcription },
    environments: v.environments ?? DEFAULT_SETTINGS.environments,
  };
}

export async function getSettings(): Promise<Settings> {
  return withDefaults(await settingsItem.getValue());
}

export async function saveSettings(next: Settings): Promise<void> {
  await settingsItem.setValue(next);
}

export function watchSettings(callback: (settings: Settings) => void): () => void {
  return settingsItem.watch((value) => callback(withDefaults(value)));
}

/* ------------------------------------------------------------ Umgebungen */

function patternToRegExp(pattern: string): RegExp | null {
  const trimmed = pattern.trim();
  if (!trimmed) return null;
  const escaped = trimmed.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  try {
    return new RegExp(`^${escaped}$`, "i");
  } catch {
    return null;
  }
}

export function matchesPattern(url: string, pattern: string): boolean {
  const regex = patternToRegExp(pattern);
  if (!regex) return false;
  if (regex.test(url)) return true;
  // "https://example.com" ohne Pfad soll auch Unterseiten treffen.
  return !pattern.includes("*") && url.toLowerCase().startsWith(pattern.trim().toLowerCase());
}

export function findEnvironment(url: string, environments: Environment[]): Environment | null {
  return environments.find((env) => env.patterns.some((pattern) => matchesPattern(url, pattern))) ?? null;
}

export function newId(prefix = ""): string {
  return prefix + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}
