import { storage } from "#imports";
import { DEFAULT_RECORDER_CONFIG } from "@/lib/qa/types";
import type { Environment, Settings } from "./types";

const KEY = "local:settings";

export const DEFAULT_SETTINGS: Settings = {
  language: "en-US",
  theme: "system",
  recorder: { ...DEFAULT_RECORDER_CONFIG },
  replay: { maskAllInputs: false, recordCanvas: false, blockSelector: "" },
  audio: { enabled: true },
  transcription: {
    whisperModel: "onnx-community/whisper-base",
    openaiKey: "",
    liveProvider: "openai",
    liveModel: "gpt-4o-transcribe",
    sonioxKey: "",
    sonioxModel: "latest",
  },
  feedback: { contextMenu: true, screenshotOnError: true, penColor: "#ef4444" },
  handoff: { endpoint: "http://127.0.0.1:4777", autoSend: true },
  team: { url: "", anonKey: "", key: "", name: "", feature: "", public: false },
  openAfterStop: true,
  environments: [
    {
      id: "local",
      name: "Local",
      color: "#22c55e",
      patterns: ["http://localhost:*/*", "http://127.0.0.1:*/*"],
      notes: "",
      variables: [],
    },
  ],
};

const settingsItem = storage.defineItem<Settings>(KEY, { fallback: DEFAULT_SETTINGS });

/** Merge deep enough that new fields get defaults in old stored states. */
function withDefaults(value: Partial<Settings> | null | undefined): Settings {
  const v = value ?? {};
  return {
    ...DEFAULT_SETTINGS,
    ...v,
    recorder: { ...DEFAULT_SETTINGS.recorder, ...v.recorder },
    replay: { ...DEFAULT_SETTINGS.replay, ...v.replay },
    audio: { ...DEFAULT_SETTINGS.audio, ...v.audio },
    transcription: { ...DEFAULT_SETTINGS.transcription, ...v.transcription },
    feedback: { ...DEFAULT_SETTINGS.feedback, ...v.feedback },
    handoff: { ...DEFAULT_SETTINGS.handoff, ...v.handoff },
    team: { ...DEFAULT_SETTINGS.team, ...v.team },
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

/* ------------------------------------------------------------ Environments */

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
  // "https://example.com" without a path should also match subpages.
  return !pattern.includes("*") && url.toLowerCase().startsWith(pattern.trim().toLowerCase());
}

export function findEnvironment(url: string, environments: Environment[]): Environment | null {
  return environments.find((env) => env.patterns.some((pattern) => matchesPattern(url, pattern))) ?? null;
}

export function newId(prefix = ""): string {
  return prefix + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}
