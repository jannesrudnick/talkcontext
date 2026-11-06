/**
 * Team sharing via the team's own Supabase project (see supabase/README.md).
 *
 * The extension only holds the project URL and the anon key; who may read and
 * write is enforced by RLS in supabase/setup.sql. A shared recording is the full
 * `.talkcontext` file in the private bucket under `<owner>/<id>/` plus one row in
 * `talkcontext_recordings` for the team folder. Opening a team recording downloads
 * the file and imports it locally.
 */
import { useEffect, useState } from "react";
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { listRecordings, updateRecording } from "./db";
import { importRecording, packRecording, SHARE_EXTENSION } from "./share";
import type { RecordingMeta, TeamConfig } from "./types";

const BUCKET = "talkcontext";
const TABLE = "talkcontext_recordings";

export interface TeamRecording {
  id: string;
  owner_id: string;
  owner_name: string;
  title: string;
  url: string;
  environment: string | null;
  started_at: string;
  duration_ms: number;
  feedback_count: number;
  error_count: number;
  shared_at: string;
}

let cached: { key: string; client: SupabaseClient } | null = null;

/**
 * Session lives in extension storage, so background (comments, MCP) and the
 * extension pages share one sign-in. Refreshes are serialised by supabase-js
 * through Web Locks, which span all extension contexts.
 */
const authStorage = {
  getItem: async (key: string) => ((await browser.storage.local.get(key))[key] as string | undefined) ?? null,
  setItem: (key: string, value: string) => browser.storage.local.set({ [key]: value }),
  removeItem: (key: string) => browser.storage.local.remove(key),
};

/** One client per project. */
export function teamClient(team: TeamConfig): SupabaseClient | null {
  const url = team.url.trim().replace(/\/$/, "");
  const key = team.anonKey.trim();
  if (!url || !key) return null;
  if (cached?.key !== `${url}|${key}`) {
    cached = {
      key: `${url}|${key}`,
      client: createClient(url, key, {
        auth: { storageKey: "talkcontext-team-auth", storage: authStorage, persistSession: true, autoRefreshToken: true },
      }),
    };
  }
  return cached.client;
}

/** Current sign-in for the configured project, live. `undefined` while loading. */
export function useTeamSession(team: TeamConfig): Session | null | undefined {
  const client = teamClient(team);
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    if (!client) {
      setSession(null);
      return;
    }
    void ensureConnected(team).then(() => client.auth.getSession().then(({ data }) => setSession(data.session)));
    const { data } = client.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);
  return session;
}

const fail = (error: { message: string } | null) => {
  if (error) throw new Error(error.message);
};

function requireClient(team: TeamConfig): SupabaseClient {
  const client = teamClient(team);
  if (!client) throw new Error("Team sharing is not set up (Settings → Team sharing).");
  return client;
}

async function requireUser(client: SupabaseClient) {
  const { data } = await client.auth.getSession();
  if (!data.session) throw new Error("Not connected to team sharing (Settings → Team sharing).");
  return data.session.user;
}

/* ---------------------------------------------------------------- Sign-in */

/**
 * Anonymous sign-in + `talkcontext_join(team_key, name)`. Only the database can
 * check the key; on success this (anonymous) user is a team member for good.
 */
export async function connectTeam(team: TeamConfig): Promise<void> {
  const client = requireClient(team);
  if (!team.key.trim() || !team.name.trim()) throw new Error("Team key and your name are required.");
  const { data } = await client.auth.getSession();
  if (!data.session) fail((await client.auth.signInAnonymously()).error);
  const { error } = await client.rpc("talkcontext_join", { team_key: team.key.trim(), member_name: team.name.trim() });
  if (error) {
    await client.auth.signOut();
    throw new Error(error.message);
  }
}

/** Reconnect silently when the session got lost but key and name are known. */
export async function ensureConnected(team: TeamConfig): Promise<boolean> {
  const client = teamClient(team);
  if (!client) return false;
  if ((await client.auth.getSession()).data.session) return true;
  if (!team.key.trim() || !team.name.trim()) return false;
  try {
    await connectTeam(team);
    return true;
  } catch {
    return false;
  }
}

export async function signOut(team: TeamConfig) {
  await teamClient(team)?.auth.signOut();
}

/* ---------------------------------------------------------------- Sharing */

const filePath = (ownerId: string, id: string) => `${ownerId}/${id}/recording${SHARE_EXTENSION}`;

export async function shareRecording(team: TeamConfig, meta: RecordingMeta): Promise<RecordingMeta | undefined> {
  const client = requireClient(team);
  const user = await requireUser(client);

  const file = await packRecording(meta.id);
  const upload = await client.storage
    .from(BUCKET)
    .upload(filePath(user.id, meta.id), file, { upsert: true, contentType: "application/zip" });
  fail(upload.error);

  const { error } = await client.from(TABLE).upsert({
    id: meta.id,
    title: meta.title,
    url: meta.initialUrl,
    environment: meta.environment?.name ?? null,
    started_at: new Date(meta.startedAt).toISOString(),
    duration_ms: Math.round(meta.durationMs),
    feedback_count: meta.counts.feedback ?? meta.counts.notes,
    error_count: meta.counts.errors,
    manifest: { format: "talkcontext-recording/1", file: filePath(user.id, meta.id), size: file.size },
  });
  fail(error);
  return updateRecording(meta.id, (current) => ({ ...current, sharedAt: Date.now() }));
}

export async function unshareRecording(team: TeamConfig, meta: RecordingMeta): Promise<RecordingMeta | undefined> {
  const client = requireClient(team);
  const user = await requireUser(client);
  fail((await client.from(TABLE).delete().eq("id", meta.id).eq("owner_id", user.id)).error);
  fail((await client.storage.from(BUCKET).remove([filePath(user.id, meta.id)])).error);
  return updateRecording(meta.id, (current) => ({ ...current, sharedAt: undefined }));
}

/* ------------------------------------------------------------ Team folder */

export async function listTeamRecordings(team: TeamConfig): Promise<TeamRecording[]> {
  const { data, error } = await requireClient(team)
    .from(TABLE)
    .select("id, owner_id, owner_name, title, url, environment, started_at, duration_ms, feedback_count, error_count, shared_at")
    .order("shared_at", { ascending: false })
    .limit(200);
  fail(error);
  return (data ?? []) as TeamRecording[];
}

/** Calls `onChange` whenever someone shares or unshares. */
export function watchTeamRecordings(team: TeamConfig, onChange: () => void): () => void {
  const client = teamClient(team);
  if (!client) return () => undefined;
  const channel = client
    .channel("talkcontext-team-folder")
    .on("postgres_changes", { event: "*", schema: "public", table: TABLE }, onChange)
    .subscribe();
  return () => void client.removeChannel(channel);
}

/**
 * Local recording id for a team recording: your own original, an earlier import,
 * or a fresh download + import.
 */
export async function openTeamRecording(team: TeamConfig, row: TeamRecording): Promise<string> {
  const local = await listRecordings();
  const existing = local.find((meta) => meta.id === row.id || meta.imported?.originalId === row.id);
  if (existing) return existing.id;

  const { data, error } = await requireClient(team).storage.from(BUCKET).download(filePath(row.owner_id, row.id));
  fail(error);
  if (!data) throw new Error("Shared file is missing.");
  const meta = await importRecording(data, row.owner_name);
  return meta.id;
}
