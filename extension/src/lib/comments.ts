/**
 * On-page comments: Figma-style threads pinned to elements, filed under a
 * feature, plus one collaborative spec text per feature. Stored in the team's
 * Supabase project (supabase/setup.sql, section 4).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface Comment {
  id: string;
  thread_id: string;
  body: string;
  author_email: string;
  via_claude: boolean;
  created_at: string;
}

export interface Thread {
  id: string;
  feature: string;
  url: string;
  page_title: string | null;
  selector: string;
  element_label: string | null;
  pin_x: number;
  pin_y: number;
  status: "open" | "resolved";
  created_by_email: string;
  created_at: string;
  last_activity_at: string;
  resolved_at: string | null;
  resolved_by_email: string | null;
  comments: Comment[];
}

export interface Spec {
  feature: string;
  body: string;
  updated_at: string;
  updated_by_email: string;
}

export interface NewThread {
  feature: string;
  url: string;
  page_title?: string;
  selector: string;
  element_label?: string;
  pin_x: number;
  pin_y: number;
  body: string;
}

export interface ThreadFilter {
  url?: string;
  feature?: string;
  status?: "open" | "resolved";
}

const THREADS = "talkcontext_threads";
const COMMENTS = "talkcontext_comments";
const SPECS = "talkcontext_specs";

const fail = (error: { message: string } | null) => {
  if (error) throw new Error(error.message);
};

/** Page identity for pins: origin + path, no query/hash. */
export function pageKey(href: string): string {
  try {
    const url = new URL(href);
    return url.origin + url.pathname.replace(/\/$/, "");
  } catch {
    return href;
  }
}

export async function listThreads(client: SupabaseClient, filter: ThreadFilter = {}): Promise<Thread[]> {
  let query = client
    .from(THREADS)
    .select(`*, comments:${COMMENTS}(id, thread_id, body, author_email, via_claude, created_at)`)
    .order("last_activity_at", { ascending: false })
    .order("created_at", { referencedTable: COMMENTS, ascending: true })
    .limit(500);
  if (filter.url) query = query.eq("url", filter.url);
  if (filter.feature) query = query.eq("feature", filter.feature);
  if (filter.status) query = query.eq("status", filter.status);
  const { data, error } = await query;
  fail(error);
  return (data ?? []) as Thread[];
}

export async function getThread(client: SupabaseClient, id: string): Promise<Thread> {
  const { data, error } = await client
    .from(THREADS)
    .select(`*, comments:${COMMENTS}(id, thread_id, body, author_email, via_claude, created_at)`)
    .eq("id", id)
    .order("created_at", { referencedTable: COMMENTS, ascending: true })
    .single();
  fail(error);
  return data as Thread;
}

export async function createThread(client: SupabaseClient, input: NewThread): Promise<Thread> {
  const { body, ...thread } = input;
  const { data, error } = await client
    .from(THREADS)
    .insert({ ...thread, feature: thread.feature.trim() })
    .select("id")
    .single();
  fail(error);
  const id = (data as { id: string }).id;
  try {
    await addComment(client, id, body);
  } catch (err) {
    // A thread without its first comment is noise.
    await client.from(THREADS).delete().eq("id", id);
    throw err;
  }
  return getThread(client, id);
}

export async function addComment(client: SupabaseClient, threadId: string, body: string, viaClaude = false): Promise<void> {
  const { error } = await client.from(COMMENTS).insert({ thread_id: threadId, body: body.trim(), via_claude: viaClaude });
  fail(error);
}

export async function setThreadStatus(client: SupabaseClient, threadId: string, status: Thread["status"]): Promise<void> {
  const { error, count } = await client.from(THREADS).update({ status }, { count: "exact" }).eq("id", threadId);
  fail(error);
  if (!count) throw new Error("Thread not found");
}

export async function deleteThread(client: SupabaseClient, threadId: string): Promise<void> {
  const { error, count } = await client.from(THREADS).delete({ count: "exact" }).eq("id", threadId);
  fail(error);
  if (!count) throw new Error("Only whoever opened a thread can delete it.");
}

/** All features that have a spec or comments, alphabetically. */
export async function listFeatures(client: SupabaseClient): Promise<string[]> {
  const [specs, threads] = await Promise.all([
    client.from(SPECS).select("feature").limit(1000),
    client.from(THREADS).select("feature").limit(5000),
  ]);
  fail(specs.error);
  fail(threads.error);
  const names = new Set<string>();
  for (const row of [...(specs.data ?? []), ...(threads.data ?? [])] as Array<{ feature: string }>) names.add(row.feature);
  return [...names].sort((a, b) => a.localeCompare(b));
}

export async function getSpec(client: SupabaseClient, feature: string): Promise<Spec | null> {
  const { data, error } = await client.from(SPECS).select("*").eq("feature", feature.trim()).maybeSingle();
  fail(error);
  return (data as Spec | null) ?? null;
}

/** Create or replace the spec text. Last write wins. */
export async function saveSpec(client: SupabaseClient, feature: string, body: string): Promise<Spec> {
  const name = feature.trim();
  // Update first: an upsert would also "update" the key column, which members may not.
  const updated = await client.from(SPECS).update({ body }).eq("feature", name).select("*");
  fail(updated.error);
  if (updated.data?.length) return updated.data[0] as Spec;
  const inserted = await client.from(SPECS).insert({ feature: name, body }).select("*").single();
  fail(inserted.error);
  return inserted.data as Spec;
}

/** Calls `onChange` whenever a thread, comment or spec changes anywhere in the team. */
export function watchComments(client: SupabaseClient, onChange: () => void): () => void {
  const channel = client.channel(`talkcontext-comments-${Math.random().toString(36).slice(2)}`);
  for (const table of [THREADS, COMMENTS, SPECS]) {
    channel.on("postgres_changes", { event: "*", schema: "public", table }, onChange);
  }
  channel.subscribe();
  return () => void client.removeChannel(channel);
}
