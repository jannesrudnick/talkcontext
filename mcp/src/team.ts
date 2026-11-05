/**
 * Team comments for Claude Code. The extension hands over the signed-in user's
 * access token (POST /team-session); this module talks to the team's Supabase
 * REST API with it, so RLS applies exactly as for the user. Nothing is stored
 * on disk - after a restart the extension pushes a fresh token within minutes.
 */
export interface TeamSession {
  url: string;
  anonKey: string;
  accessToken: string;
  /** epoch ms */
  expiresAt: number;
  email: string;
}

let session: TeamSession | null = null;

export function setTeamSession(next: TeamSession | null) {
  session = next;
}

export function teamStatus() {
  return session ? { email: session.email, expiresAt: session.expiresAt } : null;
}

function current(): TeamSession {
  if (!session) {
    throw new Error(
      "No team session yet. Sign in under TalkContext extension → Settings → Team sharing (with this Claude Code running) – the extension then hands over access.",
    );
  }
  if (session.expiresAt < Date.now() + 30_000) {
    throw new Error("The team session expired. Keep Chrome with the TalkContext extension open – it refreshes the access every 20 minutes.");
  }
  return session;
}

async function rest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { url, anonKey, accessToken } = current();
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      prefer: "return=representation",
      ...init.headers,
    },
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.text();
  if (!response.ok) {
    let message = body;
    try {
      message = (JSON.parse(body) as { message?: string }).message ?? body;
    } catch {
      // plain text
    }
    throw new Error(`Supabase ${response.status}: ${message}`);
  }
  return (body ? JSON.parse(body) : null) as T;
}

export interface Comment {
  id: string;
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
  status: "open" | "resolved";
  created_by_email: string;
  created_at: string;
  resolved_by_email: string | null;
  comments: Comment[];
}

const q = encodeURIComponent;
const SELECT = "select=*,comments:talkcontext_comments(id,body,author_email,via_claude,created_at)&comments.order=created_at.asc";

export async function listThreads(filter: { feature?: string; status?: "open" | "resolved"; url?: string; limit?: number }) {
  const parts = [SELECT, "order=last_activity_at.desc", `limit=${filter.limit ?? 50}`];
  if (filter.feature) parts.push(`feature=eq.${q(filter.feature)}`);
  if (filter.status) parts.push(`status=eq.${filter.status}`);
  if (filter.url) parts.push(`url=like.${q(`${filter.url.replace(/[%_*]/g, "")}*`)}`);
  return rest<Thread[]>(`talkcontext_threads?${parts.join("&")}`);
}

export async function getThread(id: string): Promise<Thread> {
  const rows = await rest<Thread[]>(`talkcontext_threads?${SELECT}&id=eq.${q(id)}`);
  if (!rows.length) throw new Error(`Thread ${id} not found`);
  return rows[0];
}

export async function reply(threadId: string, body: string) {
  await rest("talkcontext_comments", {
    method: "POST",
    body: JSON.stringify({ thread_id: threadId, body: body.trim(), via_claude: true }),
  });
}

export async function setStatus(threadId: string, status: "open" | "resolved") {
  const rows = await rest<unknown[]>(`talkcontext_threads?id=eq.${q(threadId)}`, { method: "PATCH", body: JSON.stringify({ status }) });
  if (!rows.length) throw new Error(`Thread ${threadId} not found`);
}

export async function getSpec(feature: string) {
  const rows = await rest<Array<{ body: string; updated_at: string; updated_by_email: string }>>(
    `talkcontext_specs?feature=eq.${q(feature)}&select=body,updated_at,updated_by_email`,
  );
  return rows[0] ?? null;
}

export async function listFeatures(): Promise<Array<{ feature: string; open: number; hasSpec: boolean }>> {
  const [specs, threads] = await Promise.all([
    rest<Array<{ feature: string }>>("talkcontext_specs?select=feature"),
    rest<Array<{ feature: string; status: string }>>("talkcontext_threads?select=feature,status&limit=5000"),
  ]);
  const map = new Map<string, { feature: string; open: number; hasSpec: boolean }>();
  const entry = (feature: string) => map.get(feature) ?? map.set(feature, { feature, open: 0, hasSpec: false }).get(feature)!;
  for (const { feature } of specs) entry(feature).hasSpec = true;
  for (const { feature, status } of threads) {
    const item = entry(feature);
    if (status === "open") item.open++;
  }
  return [...map.values()].sort((a, b) => a.feature.localeCompare(b.feature));
}

/** Thread as Markdown for the agent. */
export function threadMarkdown(thread: Thread): string {
  const lines = [
    `### Thread ${thread.id} · #${thread.feature} · ${thread.status}`,
    `- Page: ${thread.url}${thread.page_title ? ` (“${thread.page_title}”)` : ""}`,
    `- Element: ${thread.element_label ?? "?"} — selector \`${thread.selector}\``,
    `- Opened by ${thread.created_by_email} at ${thread.created_at}`,
  ];
  if (thread.status === "resolved") lines.push(`- Resolved by ${thread.resolved_by_email ?? "?"}`);
  lines.push("");
  for (const comment of thread.comments) {
    const who = comment.via_claude ? `Claude (for ${comment.author_email})` : comment.author_email;
    lines.push(`> **${who}** · ${comment.created_at}`, ...comment.body.split("\n").map((line) => `> ${line}`), ">");
  }
  return lines.join("\n");
}
