"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";

const subscribeToNothing = () => () => {};

/** Vor dem Mount bleibt der Server-Snapshot stehen - sonst weicht das Icon vom SSR-Markup ab. */
function useMounted(): boolean {
  return useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );
}

/** Nocturne ist dunkel-nativ - der Toggle wechselt zum abgeleiteten Light-Modus. */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useMounted();

  const isDark = mounted ? resolvedTheme === "dark" : true;

  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className="h-8 px-2"
      aria-label={isDark ? "Light-Modus" : "Dark-Modus"}
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      {isDark ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
    </Button>
  );
}
