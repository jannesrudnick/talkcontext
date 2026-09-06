"use client";

import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "qa-openai-api-key";

function readKey(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    // Privater Modus o.ae. blockt localStorage - Key gilt dann nur fuer die
    // laufende Seite (writeKey greift ebenfalls ins Leere, siehe unten).
    return "";
  }
}

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function writeKey(value: string) {
  try {
    if (value) localStorage.setItem(STORAGE_KEY, value);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignorieren, siehe readKey.
  }
  for (const listener of listeners) listener();
}

/** Haelt den OpenAI-Key ausschliesslich im Browser - nie im eigenen Backend. */
export function useOpenAiKey() {
  const key = useSyncExternalStore(subscribe, readKey, () => "");
  const setKey = useCallback((value: string) => writeKey(value), []);
  return { key, setKey };
}
