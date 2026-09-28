import { AudioLinesIcon, Loader2Icon, MicOffIcon, RefreshCwIcon, SparklesIcon } from "lucide-react";
import type { TranscriptSegment } from "@shared/types";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatClock } from "@/lib/format";
import type { TranscriptionProgress } from "@/lib/transcription/transcribe";
import { WHISPER_MODELS } from "@/lib/transcription/transcribe";
import type { RecordingMeta, TranscriptionEngine, WhisperModelId } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface TranscriptionChoice {
  engine: Exclude<TranscriptionEngine, "none">;
  model: WhisperModelId;
}

const ENGINE_ITEMS = [
  { value: "whisper", label: "Whisper lokal (im Browser)" },
  { value: "openai", label: "OpenAI (Cloud)" },
];

export function TranscriptPanel({
  meta,
  segments,
  time,
  running,
  progress,
  error,
  choice,
  onChoice,
  onTranscribe,
  onSeek,
}: {
  meta: RecordingMeta;
  segments: TranscriptSegment[];
  time: number;
  running: boolean;
  progress: TranscriptionProgress | null;
  error: string | null;
  choice: TranscriptionChoice;
  onChoice: (choice: TranscriptionChoice) => void;
  onTranscribe: () => void;
  onSeek: (ms: number) => void;
}) {
  if (!meta.audio) {
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <MicOffIcon />
          </EmptyMedia>
          <EmptyTitle>Keine Tonspur</EmptyTitle>
          <EmptyDescription>
            {meta.audioError ?? "Diese Aufnahme wurde ohne Mikrofon gemacht."}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const controls = (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        items={ENGINE_ITEMS}
        value={choice.engine}
        onValueChange={(value) => onChoice({ ...choice, engine: value as TranscriptionChoice["engine"] })}
      >
        <SelectTrigger size="sm" className="min-w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ENGINE_ITEMS.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {choice.engine === "whisper" && (
        <Select
          items={WHISPER_MODELS.map((model) => ({ value: model.id, label: `${model.label} · ${model.size}` }))}
          value={choice.model}
          onValueChange={(value) => onChoice({ ...choice, model: value as WhisperModelId })}
        >
          <SelectTrigger size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {WHISPER_MODELS.map((model) => (
              <SelectItem key={model.id} value={model.id}>
                {model.label} · {model.size}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );

  if (!segments.length) {
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <AudioLinesIcon />
          </EmptyMedia>
          <EmptyTitle>Noch kein Transkript</EmptyTitle>
          <EmptyDescription>
            Die Tonspur wird transkribiert und mit Klicks und Hovern auf eine Zeitachse gelegt – so weiß der Agent,
            was du bei welchem Element gesagt hast.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          {controls}
          <Button onClick={onTranscribe} disabled={running} className="w-full">
            {running ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />}
            Transkribieren
          </Button>
          {progress && (
            <div className="w-full space-y-1.5">
              <Progress value={Math.round(progress.ratio * 100)} />
              <p className="text-xs text-muted-foreground">{progress.label}</p>
            </div>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </EmptyContent>
      </Empty>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <span className="text-xs text-muted-foreground">
          {meta.transcript?.source === "openai" ? "OpenAI" : "Whisper lokal"} · {meta.transcript?.model.split("/").pop()}
        </span>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={onTranscribe} disabled={running}>
          {running ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />}
          Neu
        </Button>
      </div>
      {(progress || error) && (
        <div className="space-y-1.5 border-b px-3 py-2">
          {progress && <Progress value={Math.round(progress.ratio * 100)} />}
          <p className={cn("text-xs", error ? "text-destructive" : "text-muted-foreground")}>{error ?? progress?.label}</p>
        </div>
      )}
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-0.5 p-1.5">
          {segments.map((segment, index) => {
            const active = time >= segment.t && time <= segment.endT;
            return (
              <button
                key={index}
                type="button"
                onClick={() => onSeek(segment.t)}
                className={cn(
                  "flex w-full gap-3 rounded-lg px-2.5 py-2 text-left text-sm transition hover:bg-muted",
                  active && "bg-success/10",
                )}
              >
                <span className="w-10 shrink-0 pt-0.5 font-mono text-[11px] text-muted-foreground tabular-nums">
                  {formatClock(segment.t)}
                </span>
                <span className={cn(time < segment.t && "text-muted-foreground")}>{segment.text}</span>
              </button>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
