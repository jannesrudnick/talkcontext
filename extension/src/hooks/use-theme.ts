import { useEffect, useState, useSyncExternalStore } from "react";
import { getSettings, watchSettings } from "@/lib/settings";
import type { ThemePreference } from "@/lib/types";

const media = typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)") : null;

function subscribeSystem(callback: () => void) {
  media?.addEventListener("change", callback);
  return () => media?.removeEventListener("change", callback);
}

/** Theme aus den Einstellungen, "system" folgt dem Betriebssystem. */
export function useTheme() {
  const [preference, setPreference] = useState<ThemePreference>("system");
  const systemDark = useSyncExternalStore(subscribeSystem, () => media?.matches ?? false);

  useEffect(() => {
    void getSettings().then((settings) => setPreference(settings.theme));
    return watchSettings((settings) => setPreference(settings.theme));
  }, []);

  const resolved: "light" | "dark" = preference === "system" ? (systemDark ? "dark" : "light") : preference;

  useEffect(() => {
    document.documentElement.classList.toggle("dark", resolved === "dark");
  }, [resolved]);

  return { preference, resolved };
}
