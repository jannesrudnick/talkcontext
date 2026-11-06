import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useSettings } from "@/hooks/use-settings";
import { listFeatures, watchComments } from "@/lib/comments";
import { teamClient, useTeamSession } from "@/lib/team";

/** Signed-in Supabase client for the extension pages, plus the team's features (live). */
export function useTeam() {
  const { settings, loaded, update } = useSettings();
  const session = useTeamSession(settings.team);
  const client: SupabaseClient | null = session ? teamClient(settings.team) : null;
  const [features, setFeatures] = useState<string[]>([]);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!client) return;
    return watchComments(client, () => setVersion((value) => value + 1));
  }, [client]);
  useEffect(() => {
    if (client) void listFeatures(client).then(setFeatures, () => undefined);
  }, [client, version]);

  return { settings, update, loaded, session, client, features, version };
}
