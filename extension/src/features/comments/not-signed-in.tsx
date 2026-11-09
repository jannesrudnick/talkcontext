import { MessagesSquareIcon, UsersIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { navigate } from "@/hooks/use-hash-route";

export function NotSignedIn({ what }: { what: string }) {
  return (
    <Empty className="rounded-2xl border border-dashed py-16">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <UsersIcon />
        </EmptyMedia>
        <EmptyTitle>Sign in to team sharing</EmptyTitle>
        <EmptyDescription>{what} live in your team's Supabase project.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" onClick={() => navigate("settings/team")}>
          Settings → Team sharing
        </Button>
      </EmptyContent>
    </Empty>
  );
}

/** Comments, specs and live view are opt-in (Settings → Collaboration). */
export function CollabOff() {
  return (
    <div className="mx-auto w-full max-w-5xl px-8 py-8">
      <Empty className="rounded-2xl border border-dashed py-16">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <MessagesSquareIcon />
          </EmptyMedia>
          <EmptyTitle>Collaboration is off</EmptyTitle>
          <EmptyDescription>Comments, specs and live view are opt-in. Turn them on once in the settings.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" onClick={() => navigate("settings/collab")}>
            Settings → Collaboration
          </Button>
        </EmptyContent>
      </Empty>
    </div>
  );
}
