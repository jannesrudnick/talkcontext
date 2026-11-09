import { useEffect, useMemo, useState } from "react";
import { CheckIcon, ExternalLinkIcon, HashIcon, Loader2Icon, MessageSquareIcon, RotateCcwIcon, SearchIcon, SendIcon, SparklesIcon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { SupabaseClient } from "@supabase/supabase-js";
import { navigate } from "@/hooks/use-hash-route";
import { addComment, listThreads, setThreadStatus, type Thread } from "@/lib/comments";
import { formatRelative, hostOf, pathOf } from "@/lib/format";
import { cn } from "@/lib/utils";
import { NotSignedIn } from "./not-signed-in";
import { useTeam } from "./use-team";

const ALL = "__all__";
type Status = "open" | "resolved" | "all";

/** Every comment thread of the team, independent of the page it sits on. */
export function CommentsPage({ feature: initialFeature }: { feature?: string }) {
  const { session, client, features, version, settings } = useTeam();
  const [feature, setFeature] = useState(initialFeature ?? (settings.team.feature || ALL));
  const [status, setStatus] = useState<Status>("open");
  const [query, setQuery] = useState("");
  const [threads, setThreads] = useState<Thread[] | null>(null);

  useEffect(() => {
    if (initialFeature) setFeature(initialFeature);
  }, [initialFeature]);

  useEffect(() => {
    if (!client) return;
    void listThreads(client, { feature: feature === ALL ? undefined : feature, status: status === "all" ? undefined : status }).then(
      setThreads,
      (error: unknown) => toast.error("Could not load comments", { description: error instanceof Error ? error.message : String(error) }),
    );
  }, [client, feature, status, version]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return threads ?? [];
    return (threads ?? []).filter((thread) =>
      [thread.url, thread.element_label, thread.page_title, ...thread.comments.map((c) => c.body)].join(" ").toLowerCase().includes(needle),
    );
  }, [threads, query]);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-8 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Comments</h1>
          <p className="mt-1 text-sm text-muted-foreground">Threads pinned on pages, per feature. Claude Code can read, answer and resolve them.</p>
        </div>
        {client && (
          <InputGroup className="w-64">
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput placeholder="Search …" value={query} onChange={(event) => setQuery(event.target.value)} />
          </InputGroup>
        )}
      </div>

      {session === null || (session !== undefined && !client) ? (
        <NotSignedIn what="Comments" />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <Select
              items={[{ value: ALL, label: "All features" }, ...features.map((f) => ({ value: f, label: f }))]}
              value={feature}
              onValueChange={(value) => setFeature(String(value))}
            >
              <SelectTrigger className="w-56">
                <HashIcon className="size-3.5 text-muted-foreground" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All features</SelectItem>
                {features.map((item) => (
                  <SelectItem key={item} value={item}>
                    {item}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <ToggleGroup value={[status]} onValueChange={(value) => setStatus((value[0] as Status | undefined) ?? status)} size="sm" variant="outline">
              <ToggleGroupItem value="open">Open</ToggleGroupItem>
              <ToggleGroupItem value="resolved">Resolved</ToggleGroupItem>
              <ToggleGroupItem value="all">All</ToggleGroupItem>
            </ToggleGroup>
            {feature !== ALL && (
              <Button variant="ghost" size="sm" onClick={() => navigate(`specs/${encodeURIComponent(feature)}`)}>
                Spec for #{feature}
              </Button>
            )}
          </div>

          {threads === null ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }, (_, index) => (
                <Skeleton key={index} className="h-32 w-full rounded-xl" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <Empty className="rounded-2xl border border-dashed py-16">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <MessageSquareIcon />
                </EmptyMedia>
                <EmptyTitle>No comments</EmptyTitle>
                <EmptyDescription>Open the overlay on a page (Alt+Shift+Q), click the comment button and pick an element.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="space-y-3">
              {filtered.map((thread) => (
                client && <ThreadCard key={thread.id} thread={thread} client={client} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Changes show up through the realtime subscription of the page. */
function ThreadCard({ thread, client }: { thread: Thread; client: SupabaseClient }) {
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const resolved = thread.status === "resolved";

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    try {
      await task();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cn("rounded-xl border bg-card", resolved && "opacity-70")}>
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
        <Badge variant="secondary" className="gap-0.5">
          <HashIcon className="size-3" />
          {thread.feature}
        </Badge>
        {resolved && <Badge variant="outline">Resolved</Badge>}
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground" title={thread.url}>
          {hostOf(thread.url)}
          <span className="opacity-60">{pathOf(thread.url)}</span>
          {thread.element_label && <span className="font-sans"> · {thread.element_label}</span>}
        </span>
        <Button size="sm" variant="ghost" onClick={() => void openOnPage(thread)}>
          <ExternalLinkIcon />
          Open on page
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void run(() => setThreadStatus(client, thread.id, resolved ? "open" : "resolved"))}
        >
          {resolved ? <RotateCcwIcon /> : <CheckIcon />}
          {resolved ? "Reopen" : "Resolve"}
        </Button>
      </div>
      <div className="space-y-3 px-4 py-3">
        {thread.comments.map((comment) => (
          <div key={comment.id} className="flex gap-2.5">
            <span
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white",
                comment.via_claude ? "bg-[#d97757]" : "bg-amber-500",
              )}
            >
              {comment.via_claude ? <SparklesIcon className="size-3.5" /> : comment.author_name.charAt(0).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex items-baseline gap-1.5 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{comment.via_claude ? "Claude" : comment.author_name}</span>
                {comment.via_claude && <span>for {comment.author_name}</span>}
                <span>{formatRelative(new Date(comment.created_at).getTime())}</span>
              </p>
              <p className="text-sm whitespace-pre-wrap break-words">{comment.body}</p>
            </div>
          </div>
        ))}
        {resolved && thread.resolved_by_name && (
          <p className="text-xs text-muted-foreground">
            Resolved by {thread.resolved_by_name}
            {thread.resolved_at ? ` · ${formatRelative(new Date(thread.resolved_at).getTime())}` : ""}
          </p>
        )}
      </div>
      <div className="flex items-end gap-2 border-t px-4 py-2.5">
        <Textarea
          rows={1}
          placeholder="Reply…"
          value={reply}
          onChange={(event) => setReply(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && reply.trim()) {
              void run(async () => {
                await addComment(client, thread.id, reply);
                setReply("");
              });
            }
          }}
          className="min-h-9"
        />
        <Button
          size="icon"
          disabled={busy || !reply.trim()}
          aria-label="Send reply"
          onClick={() =>
            void run(async () => {
              await addComment(client, thread.id, reply);
              setReply("");
            })
          }
        >
          {busy ? <Loader2Icon className="animate-spin" /> : <SendIcon />}
        </Button>
      </div>
    </div>
  );
}

/** Open the page in a new tab, then ask its content script to show this thread. */
async function openOnPage(thread: Thread) {
  const tab = await browser.tabs.create({ url: thread.href ?? thread.url });
  if (tab.id == null) return;
  const tabId = tab.id;
  const send = (attempt = 0) =>
    void browser.tabs.sendMessage(tabId, { type: "talkcontext:open-thread", threadId: thread.id }).catch(() => {
      if (attempt < 10) window.setTimeout(() => send(attempt + 1), 500);
    });
  const onUpdated = (id: number, info: { status?: string }) => {
    if (id !== tabId || info.status !== "complete") return;
    browser.tabs.onUpdated.removeListener(onUpdated);
    window.setTimeout(() => send(), 400);
  };
  browser.tabs.onUpdated.addListener(onUpdated);
}
