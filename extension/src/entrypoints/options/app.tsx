import { AppShell } from "@/components/app/app-shell";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CommentsPage } from "@/features/comments/comments-page";
import { SpecsPage } from "@/features/comments/specs-page";
import { RecordingDetailPage } from "@/features/recordings/detail-page";
import { RecordingsListPage } from "@/features/recordings/list-page";
import { SettingsPage } from "@/features/settings/settings-page";
import { WelcomePage } from "@/features/welcome/welcome-page";
import { useHashRoute } from "@/hooks/use-hash-route";
import { useTheme } from "@/hooks/use-theme";

export function App() {
  useTheme();
  const [page = "recordings", param] = useHashRoute();

  let content;
  let active = page;
  if (page === "recordings" && param) {
    content = <RecordingDetailPage key={param} id={param} />;
  } else if (page === "comments") {
    content = <CommentsPage feature={param ? decodeURIComponent(param) : undefined} />;
  } else if (page === "specs") {
    content = <SpecsPage feature={param ? decodeURIComponent(param) : undefined} />;
  } else if (page === "settings") {
    content = <SettingsPage section={param} />;
  } else if (page === "welcome") {
    content = <WelcomePage />;
  } else {
    active = "recordings";
    content = <RecordingsListPage />;
  }

  return (
    <TooltipProvider>
      <AppShell active={active}>{content}</AppShell>
      <Toaster position="bottom-right" />
    </TooltipProvider>
  );
}
