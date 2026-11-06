import { useEffect, useRef, useState } from "react";
import { FileTextIcon, HashIcon, Loader2Icon, MessageSquareIcon, PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { navigate } from "@/hooks/use-hash-route";
import { getSpec, saveSpec, type Spec } from "@/lib/comments";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { NotSignedIn } from "./not-signed-in";
import { useTeam } from "./use-team";

/** One collaborative spec text per feature. Last write wins; edits of others show up live. */
export function SpecsPage({ feature: routeFeature }: { feature?: string }) {
  const { session, client, features, version, settings } = useTeam();
  const feature = routeFeature ?? (settings.team.feature || features[0]);
  const [creating, setCreating] = useState("");

  if (session === null) {
    return (
      <div className="mx-auto w-full max-w-5xl px-8 py-8">
        <NotSignedIn what="Specs" />
      </div>
    );
  }

  const list = feature && !features.includes(feature) ? [...features, feature].sort() : features;

  return (
    <div className="mx-auto flex h-full w-full max-w-5xl gap-8 px-8 py-8">
      <nav className="flex w-52 shrink-0 flex-col gap-0.5">
        <h1 className="mb-4 text-2xl font-semibold tracking-tight">Specs</h1>
        {list.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => navigate(`specs/${encodeURIComponent(name)}`)}
            className={cn(
              "flex items-center gap-1.5 truncate rounded-lg px-2.5 py-1.5 text-left text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground",
              name === feature && "bg-muted font-medium text-foreground",
            )}
          >
            <HashIcon className="size-3.5 shrink-0" />
            <span className="truncate">{name}</span>
          </button>
        ))}
        <form
          className="mt-3 flex gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            if (creating.trim()) navigate(`specs/${encodeURIComponent(creating.trim())}`);
            setCreating("");
          }}
        >
          <Input placeholder="New feature" value={creating} onChange={(event) => setCreating(event.target.value)} className="h-8" />
          <Button size="icon-sm" variant="outline" type="submit" aria-label="Add feature">
            <PlusIcon />
          </Button>
        </form>
      </nav>
      <div className="min-w-0 flex-1">
        {client && feature ? (
          <SpecEditor key={feature} feature={feature} version={version} save={(body) => saveSpec(client, feature, body)} load={() => getSpec(client, feature)} />
        ) : (
          <Empty className="rounded-2xl border border-dashed py-16">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FileTextIcon />
              </EmptyMedia>
              <EmptyTitle>No feature yet</EmptyTitle>
              <EmptyDescription>Add one on the left – or pick it in the overlay when you comment.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </div>
    </div>
  );
}

function SpecEditor({
  feature,
  version,
  load,
  save,
}: {
  feature: string;
  version: number;
  load: () => Promise<Spec | null>;
  save: (body: string) => Promise<Spec>;
}) {
  const [spec, setSpec] = useState<Spec | null | undefined>(undefined);
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const dirty = useRef(false);
  const timer = useRef<number | undefined>(undefined);

  // Initial load and live updates - but never overwrite what you are typing.
  useEffect(() => {
    void load().then((next) => {
      setSpec(next);
      if (!dirty.current) setBody(next?.body ?? "");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  const flush = async (text: string) => {
    window.clearTimeout(timer.current);
    setSaving(true);
    try {
      setSpec(await save(text));
      dirty.current = false;
    } catch (error) {
      toast.error("Spec not saved", { description: error instanceof Error ? error.message : String(error) });
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center gap-3">
        <h2 className="flex min-w-0 flex-1 items-center gap-1 truncate text-lg font-semibold">
          <HashIcon className="size-4 text-muted-foreground" />
          {feature}
        </h2>
        <span className="text-xs text-muted-foreground">
          {saving ? (
            <Loader2Icon className="inline size-3.5 animate-spin" />
          ) : spec ? (
            `Saved · ${spec.updated_by_name} · ${formatRelative(new Date(spec.updated_at).getTime())}`
          ) : spec === null ? (
            "Not written yet"
          ) : (
            "…"
          )}
        </span>
        <Button variant="outline" size="sm" onClick={() => navigate(`comments/${encodeURIComponent(feature)}`)}>
          <MessageSquareIcon />
          Comments
        </Button>
      </div>
      <Textarea
        value={body}
        disabled={spec === undefined}
        placeholder={`What should #${feature} do? Goals, decisions, open questions … – the whole team edits this, and Claude Code can read it.`}
        onChange={(event) => {
          const text = event.target.value;
          setBody(text);
          dirty.current = true;
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => void flush(text), 1000);
        }}
        onBlur={() => dirty.current && void flush(body)}
        className="min-h-[60vh] flex-1 resize-none font-mono text-sm leading-relaxed"
      />
    </div>
  );
}
