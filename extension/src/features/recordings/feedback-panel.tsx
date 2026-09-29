import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  FlagIcon,
  ImageIcon,
  MessageSquareIcon,
  MousePointerClickIcon,
  PenLineIcon,
  ScanSearchIcon,
} from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { formatClock } from "@/lib/format";
import type { FeedbackItem, Screenshot } from "@/lib/types";
import { cn } from "@/lib/utils";
import { assignErrors } from "@/lib/handoff/build";
import { speechByFeedback, type LoadedRecording } from "./load";

const SOURCE = {
  contextmenu: { icon: MousePointerClickIcon, label: "Rechtsklick" },
  pen: { icon: PenLineIcon, label: "Stift" },
  note: { icon: MessageSquareIcon, label: "Notiz" },
  marker: { icon: FlagIcon, label: "Bug" },
} as const;

/** Object-URLs fuer Screenshot-Blobs, sauber freigegeben. */
export function useScreenshotUrls(screenshots: Screenshot[]) {
  const urls = useMemo(() => new Map(screenshots.map((shot) => [shot.id, URL.createObjectURL(shot.blob)])), [screenshots]);
  useEffect(() => () => urls.forEach((url) => URL.revokeObjectURL(url)), [urls]);
  return urls;
}

export function FeedbackPanel({
  recording,
  time,
  selectedId,
  onSelect,
}: {
  recording: LoadedRecording;
  time: number;
  selectedId: string | null;
  onSelect: (item: FeedbackItem) => void;
}) {
  const speech = useMemo(() => speechByFeedback(recording), [recording]);
  const errorsByItem = useMemo(() => {
    const failed = recording.network.filter((entry) => entry.status === 0 || entry.status >= 400);
    const errors = recording.console.filter((entry) => entry.level === "error");
    const counts = new Map<string, number>();
    for (const map of [assignErrors(failed, recording.feedback), assignErrors(errors, recording.feedback)]) {
      for (const [id, list] of map) counts.set(id, (counts.get(id) ?? 0) + list.length);
    }
    return counts;
  }, [recording]);
  const urls = useScreenshotUrls(recording.screenshots);
  const [lightbox, setLightbox] = useState<{ shots: Screenshot[]; index: number } | null>(null);
  const loose = recording.screenshots.filter(
    (shot) => !shot.feedbackId || !recording.feedback.some((item) => item.id === shot.feedbackId),
  );

  if (!recording.feedback.length && !loose.length) {
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ScanSearchIcon />
          </EmptyMedia>
          <EmptyTitle>Keine Feedback-Punkte</EmptyTitle>
          <EmptyDescription>
            Beim nächsten Mal während der Aufnahme per Rechtsklick auf ein Element oder mit dem Stift markieren – dann
            landen Aussage, Screenshot und Element hier gebündelt.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <>
      <ScrollArea className="h-full">
        <div className="space-y-2 p-2">
          {recording.feedback.map((item) => {
            const t = Math.max(0, item.activeFrom - recording.base);
            const said = [...(speech.get(item.id) ?? []), item.text].filter(Boolean).join(" ");
            const shots = recording.screenshots.filter((shot) => shot.feedbackId === item.id);
            const Source = SOURCE[item.source];
            const active = time >= t && time <= Math.max(t, (item.activeTo ?? item.activeFrom) - recording.base);
            const errors = errorsByItem.get(item.id) ?? 0;
            return (
              <div
                key={item.id}
                role="button"
                tabIndex={0}
                onClick={() => onSelect(item)}
                onKeyDown={(event) => event.key === "Enter" && onSelect(item)}
                className={cn(
                  "cursor-pointer rounded-xl border bg-card p-3 transition hover:border-brand/40",
                  selectedId === item.id && "border-brand/60 ring-2 ring-brand/15",
                  active && "bg-brand/5",
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="rounded-md bg-brand px-1.5 font-mono text-xs leading-5 font-semibold text-brand-foreground">
                    F{item.index}
                  </span>
                  <span className="font-mono text-[11px] text-muted-foreground tabular-nums">{formatClock(t)}</span>
                  <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Source.icon className="size-3" />
                    {Source.label}
                  </span>
                  {errors > 0 && (
                    <span className="ml-auto flex items-center gap-1 text-[11px] font-medium text-destructive">
                      <AlertTriangleIcon className="size-3" />
                      {errors}
                    </span>
                  )}
                </div>
                <p className="mt-2 text-sm">
                  {said ? `„${said}“` : <span className="text-muted-foreground italic">Keine Aussage</span>}
                </p>
                {item.target && (
                  <p className="mt-1.5 truncate font-mono text-[11px] text-muted-foreground" title={item.target.selector}>
                    {item.target.selector}
                  </p>
                )}
                {item.component && (
                  <p className="truncate font-mono text-[11px] text-brand/80" title={item.component.file}>
                    {item.component.chain.slice(-3).join(" › ")}
                    {item.component.file && <span className="text-muted-foreground"> · {item.component.file.split("/").pop()}</span>}
                  </p>
                )}
                {shots.length > 0 && (
                  <div className="mt-2.5 flex gap-1.5 overflow-x-auto">
                    {shots.map((shot, index) => (
                      <button
                        key={shot.id}
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setLightbox({ shots, index });
                        }}
                        className="relative h-16 w-28 shrink-0 overflow-hidden rounded-md border bg-muted transition hover:ring-2 hover:ring-brand/40"
                      >
                        <img src={urls.get(shot.id)} alt="" className="size-full object-cover object-top" />
                        <span className="absolute right-1 bottom-1 rounded bg-black/60 px-1 font-mono text-[9px] text-white">
                          {formatClock(shot.ts - recording.base)}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {loose.length > 0 && (
            <div className="pt-2">
              <p className="mb-2 flex items-center gap-1.5 px-1 text-xs font-medium text-muted-foreground">
                <ImageIcon className="size-3.5" />
                Weitere Screenshots
              </p>
              <div className="grid grid-cols-3 gap-1.5">
                {loose.map((shot, index) => (
                  <button
                    key={shot.id}
                    type="button"
                    onClick={() => setLightbox({ shots: loose, index })}
                    className="relative aspect-video overflow-hidden rounded-md border bg-muted hover:ring-2 hover:ring-brand/40"
                  >
                    <img src={urls.get(shot.id)} alt="" className="size-full object-cover object-top" />
                    <span className="absolute right-1 bottom-1 rounded bg-black/60 px-1 font-mono text-[9px] text-white">
                      {shot.reason === "error" ? "Fehler · " : ""}
                      {formatClock(shot.ts - recording.base)}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      <Dialog open={Boolean(lightbox)} onOpenChange={(open) => !open && setLightbox(null)}>
        <DialogContent className="max-w-[min(1200px,calc(100%-2rem))] gap-3 sm:max-w-[min(1200px,calc(100%-2rem))]">
          {lightbox && (
            <>
              <DialogTitle className="text-sm">
                Screenshot {lightbox.index + 1}/{lightbox.shots.length} ·{" "}
                <span className="font-mono">{formatClock(lightbox.shots[lightbox.index]!.ts - recording.base)}</span>
              </DialogTitle>
              <img
                src={urls.get(lightbox.shots[lightbox.index]!.id)}
                alt=""
                className="max-h-[75vh] w-full rounded-lg border object-contain"
              />
              {lightbox.shots.length > 1 && (
                <div className="flex justify-center gap-2">
                  <Button
                    size="icon"
                    variant="outline"
                    disabled={lightbox.index === 0}
                    onClick={() => setLightbox({ ...lightbox, index: lightbox.index - 1 })}
                  >
                    <ChevronLeftIcon />
                  </Button>
                  <Button
                    size="icon"
                    variant="outline"
                    disabled={lightbox.index === lightbox.shots.length - 1}
                    onClick={() => setLightbox({ ...lightbox, index: lightbox.index + 1 })}
                  >
                    <ChevronRightIcon />
                  </Button>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
