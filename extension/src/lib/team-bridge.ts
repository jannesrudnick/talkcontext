/**
 * Background side of team comments:
 *  - answers the content script's comment requests (it has no Supabase client of its own)
 *  - hands the current access token to the local TalkContext MCP server, so Claude Code
 *    can read, answer and resolve comments as the signed-in user.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  addComment,
  createThread,
  deleteThread,
  listFeatures,
  listThreads,
  setThreadStatus,
  type NewThread,
  type Thread,
} from "./comments";
import { getSettings, watchSettings } from "./settings";
import { ensureConnected, teamClient } from "./team";
import type { Settings } from "./types";

export type CommentOp =
  | { op: "session" }
  | { op: "list"; url: string; feature?: string }
  | { op: "features" }
  | { op: "create"; thread: NewThread }
  | { op: "reply"; threadId: string; body: string }
  | { op: "status"; threadId: string; status: Thread["status"] }
  | { op: "delete"; threadId: string };

async function signedInClient(): Promise<{ client: SupabaseClient; name: string; id: string } | null> {
  const { team } = await getSettings();
  const client = teamClient(team);
  if (!client || !(await ensureConnected(team))) return null;
  const { data } = await client.auth.getSession();
  return data.session ? { client, name: team.name.trim(), id: data.session.user.id } : null;
}

export async function handleCommentOp(request: CommentOp): Promise<unknown> {
  const team = await signedInClient();
  if (request.op === "session") return team ? { name: team.name, id: team.id } : null;
  if (!team) throw new Error("Connect under Settings → Team sharing to comment.");
  const { client } = team;
  switch (request.op) {
    case "list":
      return listThreads(client, { url: request.url, feature: request.feature || undefined });
    case "features":
      return listFeatures(client);
    case "create":
      return createThread(client, request.thread);
    case "reply":
      return addComment(client, request.threadId, request.body);
    case "status":
      return setThreadStatus(client, request.threadId, request.status);
    case "delete":
      return deleteThread(client, request.threadId);
  }
}

/* ------------------------------------------------------------- MCP token */

const ALARM = "talkcontext-team-token";

async function pushToken(settings: Settings) {
  const client = teamClient(settings.team);
  // getSession() refreshes an expired token first.
  const session = client && (await ensureConnected(settings.team)) ? (await client.auth.getSession()).data.session : null;
  const body = session
    ? {
        url: settings.team.url.trim().replace(/\/$/, ""),
        anonKey: settings.team.anonKey.trim(),
        accessToken: session.access_token,
        expiresAt: (session.expires_at ?? 0) * 1000,
        name: settings.team.name.trim(),
      }
    : { signedOut: true };
  await fetch(`${settings.handoff.endpoint.replace(/\/$/, "")}/team-session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(3000),
  }).catch(() => undefined); // MCP server not running - next push will catch up.
}

/** Call once from the background. */
export function startTeamBridge() {
  let unsubscribe: (() => void) | null = null;
  let current = "";

  const attach = (settings: Settings) => {
    const key = `${settings.team.url}|${settings.team.anonKey}|${settings.handoff.endpoint}`;
    if (key === current) return;
    current = key;
    unsubscribe?.();
    unsubscribe = null;
    const client = teamClient(settings.team);
    if (client) {
      const { data } = client.auth.onAuthStateChange(() => void pushToken(settings));
      unsubscribe = () => data.subscription.unsubscribe();
    }
    void pushToken(settings);
  };

  void getSettings().then(attach);
  watchSettings(attach);
  // Access tokens live an hour; keep the MCP server's copy fresh while the browser runs.
  void browser.alarms.create(ALARM, { periodInMinutes: 20 });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM) void getSettings().then(pushToken);
  });
}
