/**
 * Realtime-only Supabase client for this tab. Sign-in stays in the background
 * (lib/team-bridge.ts); this client borrows its current access token, which
 * realtime-js re-reads on every heartbeat.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSettings } from "@/lib/settings";
import { request } from "./api";

// ponytail: created once per page load - changing the project in settings needs a tab reload.
let client: Promise<SupabaseClient | null> | null = null;

export function realtime(): Promise<SupabaseClient | null> {
  client ??= getSettings().then(({ team }) => {
    const url = team.url.trim().replace(/\/$/, "");
    const key = team.anonKey.trim();
    if (!url || !key) return null;
    return createClient(url, key, {
      accessToken: async () => (await request<string | null>({ type: "talkcontext:comments", request: { op: "token" } })) ?? "",
    });
  });
  return client;
}
