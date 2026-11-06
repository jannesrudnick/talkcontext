import { useState } from "react";
import { CheckIcon, ChevronDownIcon, Loader2Icon, RefreshCwIcon, UsersIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatRelative } from "@/lib/format";
import { shareRecording, unshareRecording, useTeamSession } from "@/lib/team";
import type { RecordingMeta, TeamConfig } from "@/lib/types";

/** Share to / remove from the team folder. Only shown when signed in to team sharing. */
export function TeamShareButton({
  team,
  meta,
  onMeta,
}: {
  team: TeamConfig;
  meta: RecordingMeta;
  onMeta: (meta: RecordingMeta) => void;
}) {
  const session = useTeamSession(team);
  const [busy, setBusy] = useState(false);
  if (!session) return null;

  const run = async (task: () => Promise<RecordingMeta | undefined>, done: string) => {
    setBusy(true);
    try {
      const next = await task();
      if (next) onMeta(next);
      toast.success(done);
    } catch (error) {
      toast.error("Team sharing failed", { description: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  };
  const share = () => run(() => shareRecording(team, meta), "Shared with the team");

  if (!meta.sharedAt) {
    return (
      <Button variant="outline" onClick={() => void share()} disabled={busy}>
        {busy ? <Loader2Icon className="animate-spin" /> : <UsersIcon />}
        Share with team
      </Button>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" disabled={busy} title={`Shared ${formatRelative(meta.sharedAt)}`} />}>
        {busy ? <Loader2Icon className="animate-spin" /> : <CheckIcon />}
        Shared
        <ChevronDownIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onClick={() => void share()}>
          <RefreshCwIcon />
          Update shared copy
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void run(() => unshareRecording(team, meta), "Removed from the team folder")}>
          <XIcon />
          Stop sharing
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
