"use client";

import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "qa-openai-api-key";

function readKey(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    // Private mode or similar blocks localStorage - the key then only lives for
    // the current page (writeKey is a no-op too, see below).
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
    // Ignore, see readKey.
  }
  for (const listener of listeners) listener();
}

/** Keeps the OpenAI key exclusively in the browser - never in our own backend. */
export function useOpenAiKey() {
  const key = useSyncExternalStore(subscribe, readKey, () => "");
  const setKey = useCallback((value: string) => writeKey(value), []);
  return { key, setKey };
}
