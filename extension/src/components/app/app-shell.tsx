import type { ReactNode } from "react";
import { KeyboardIcon, ListVideoIcon, SettingsIcon, SparklesIcon } from "lucide-react";
import { Kbd } from "@/components/ui/kbd";
import { navigate } from "@/hooks/use-hash-route";
import { cn } from "@/lib/utils";

const NAV = [
  { path: "recordings", label: "Aufnahmen", icon: ListVideoIcon },
  { path: "settings", label: "Einstellungen", icon: SettingsIcon },
  { path: "welcome", label: "Erste Schritte", icon: SparklesIcon },
];

export function AppShell({ active, children }: { active: string; children: ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="flex w-60 shrink-0 flex-col border-r bg-sidebar px-3 py-4">
        <button type="button" onClick={() => navigate("recordings")} className="mb-6 flex items-center gap-2.5 px-2">
          <Logo />
          <span className="text-lg font-semibold tracking-tight">qey</span>
          <span className="rounded-md border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">beta</span>
        </button>
        <nav className="flex flex-col gap-0.5">
          {NAV.map(({ path, label, icon: Icon }) => (
            <button
              key={path}
              type="button"
              onClick={() => navigate(path)}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-sidebar-foreground/70 transition hover:bg-sidebar-accent hover:text-sidebar-foreground",
                active === path && "bg-sidebar-accent font-medium text-sidebar-foreground",
              )}
            >
              <Icon className="size-4" />
              {label}
            </button>
          ))}
        </nav>
        <div className="mt-auto space-y-2 rounded-xl border bg-background/60 p-3 text-xs text-muted-foreground">
          <p className="flex items-center gap-1.5 font-medium text-foreground">
            <KeyboardIcon className="size-3.5" />
            Tastenkürzel
          </p>
          <div className="flex items-center justify-between">
            <span>Overlay</span>
            <span className="flex gap-0.5">
              <Kbd>⌥</Kbd>
              <Kbd>⇧</Kbd>
              <Kbd>Q</Kbd>
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span>Aufnahme</span>
            <span className="flex gap-0.5">
              <Kbd>⌥</Kbd>
              <Kbd>⇧</Kbd>
              <Kbd>R</Kbd>
            </span>
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-auto">{children}</main>
    </div>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "flex size-7 items-center justify-center rounded-lg bg-gradient-to-br from-brand to-fuchsia-500 text-sm font-bold text-white shadow-sm",
        className,
      )}
    >
      q
    </span>
  );
}
