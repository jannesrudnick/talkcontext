import { useCallback, useEffect, useState } from "react";
import { DEFAULT_SETTINGS, getSettings, saveSettings, watchSettings } from "@/lib/settings";
import type { Settings } from "@/lib/types";

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    void getSettings().then((value) => {
      if (!alive) return;
      setSettings(value);
      setLoaded(true);
    });
    const unwatch = watchSettings(setSettings);
    return () => {
      alive = false;
      unwatch();
    };
  }, []);

  const update = useCallback((updater: (current: Settings) => Settings) => {
    setSettings((current) => {
      const next = updater(current);
      void saveSettings(next);
      return next;
    });
  }, []);

  return { settings, loaded, update };
}
