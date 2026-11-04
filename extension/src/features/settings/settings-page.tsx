import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import {
  BotIcon,
  CheckCircle2Icon,
  CopyIcon,
  DatabaseIcon,
  Loader2Icon,
  MessageSquareDotIcon,
  PlugZapIcon,
  GlobeIcon,
  KeyRoundIcon,
  MicIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  Trash2Icon,
  VideoIcon,
} from "lucide-react";
import { toast } from "sonner";
import { listSonioxModels, SONIOX_LATEST } from "@/lib/transcription/soniox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldSeparator } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { useSettings } from "@/hooks/use-settings";
import { navigate } from "@/hooks/use-hash-route";
import { deleteRecording, estimateUsage, listRecordings } from "@/lib/db";
import { formatBytes } from "@/lib/format";
import { checkEndpoint, type EndpointHealth } from "@/lib/handoff/transport";
import { WHISPER_MODELS } from "@/lib/transcription/transcribe";
import type { Settings, TranscriptionEngine, WhisperModelId } from "@/lib/types";
import { cn } from "@/lib/utils";
import { EnvironmentsSection } from "./environments";
import { useMicPermission } from "./use-mic-permission";

const SECTIONS = [
  { id: "general", label: "General", icon: SlidersHorizontalIcon },
  { id: "environments", label: "Environments", icon: GlobeIcon },
  { id: "recording", label: "Recording", icon: VideoIcon },
  { id: "feedback", label: "Feedback", icon: MessageSquareDotIcon },
  { id: "transcription", label: "Transcription", icon: SparklesIcon },
  { id: "claude", label: "Claude Code", icon: BotIcon },
  { id: "data", label: "Data", icon: DatabaseIcon },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

export function SettingsPage({ section }: { section?: string }) {
  const active: SectionId = SECTIONS.some((s) => s.id === section) ? (section as SectionId) : "general";
  const { settings, update, loaded } = useSettings();

  return (
    <div className="mx-auto flex w-full max-w-5xl gap-10 px-8 py-8">
      <nav className="sticky top-8 flex w-48 shrink-0 flex-col gap-0.5 self-start">
        <h1 className="mb-4 text-2xl font-semibold tracking-tight">Settings</h1>
        {SECTIONS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => navigate(`settings/${id}`)}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground",
              active === id && "bg-muted font-medium text-foreground",
            )}
          >
            <Icon className="size-4" />
            {label}
          </button>
        ))}
      </nav>
      <div className="min-w-0 flex-1 pt-12">
        {loaded && active === "general" && <GeneralSection settings={settings} update={update} />}
        {loaded && active === "environments" && <EnvironmentsSection settings={settings} update={update} />}
        {loaded && active === "recording" && <RecordingSection settings={settings} update={update} />}
        {loaded && active === "feedback" && <FeedbackSection settings={settings} update={update} />}
        {loaded && active === "transcription" && <TranscriptionSection settings={settings} update={update} />}
        {loaded && active === "claude" && <ClaudeSection settings={settings} update={update} />}
        {loaded && active === "data" && <DataSection />}
      </div>
    </div>
  );
}

type SectionProps = { settings: Settings; update: (updater: (current: Settings) => Settings) => void };

export function SectionHeader({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}

function SwitchField({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <Field orientation="horizontal">
      <FieldContent>
        <FieldLabel>{label}</FieldLabel>
        {description && <FieldDescription>{description}</FieldDescription>}
      </FieldContent>
      <Switch checked={checked} onCheckedChange={onChange} />
    </Field>
  );
}

/* ------------------------------------------------------------------ General */

const LANGUAGES = [
  { value: "de-DE", label: "German" },
  { value: "en-US", label: "English" },
  { value: "fr-FR", label: "French" },
  { value: "es-ES", label: "Spanish" },
];

const THEMES = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

function GeneralSection({ settings, update }: SectionProps) {
  return (
    <section>
      <SectionHeader title="General" description="Language, appearance and what happens after recording." />
      <FieldGroup>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel>Transcription language</FieldLabel>
            <FieldDescription>Language you speak during recordings. Used for live and post-recording transcription.</FieldDescription>
          </FieldContent>
          <Select items={LANGUAGES} value={settings.language} onValueChange={(value) => update((s) => ({ ...s, language: String(value) }))}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LANGUAGES.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <FieldSeparator />
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel>Appearance</FieldLabel>
            <FieldDescription>The on-page overlay is always dark so it stands out.</FieldDescription>
          </FieldContent>
          <Select
            items={THEMES}
            value={settings.theme}
            onValueChange={(value) => update((s) => ({ ...s, theme: value as Settings["theme"] }))}
          >
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {THEMES.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <FieldSeparator />
        <SwitchField
          label="Open recording after stopping"
          description="Opens the replay in a new tab – transcription starts there too."
          checked={settings.openAfterStop}
          onChange={(value) => update((s) => ({ ...s, openAfterStop: value }))}
        />
        <FieldSeparator />
        <Field>
          <FieldLabel>Keyboard shortcuts</FieldLabel>
          <FieldDescription>
            <span className="font-mono">Alt+Shift+Q</span> toggles the overlay, <span className="font-mono">Alt+Shift+R</span>{" "}
            starts/stops recording. Change them at{" "}
            <button
              type="button"
              className="underline underline-offset-2"
              onClick={() => void browser.tabs.create({ url: "chrome://extensions/shortcuts" })}
            >
              chrome://extensions/shortcuts
            </button>
            .
          </FieldDescription>
        </Field>
      </FieldGroup>
    </section>
  );
}

/* ---------------------------------------------------------------- Recording */

function RecordingSection({ settings, update }: SectionProps) {
  const mic = useMicPermission();
  const recorder = settings.recorder;
  const setRecorder = (patch: Partial<Settings["recorder"]>) =>
    update((s) => ({ ...s, recorder: { ...s.recorder, ...patch } }));
  const setReplay = (patch: Partial<Settings["replay"]>) => update((s) => ({ ...s, replay: { ...s.replay, ...patch } }));

  return (
    <section className="space-y-10">
      <div>
        <SectionHeader title="Microphone" description="Your spoken explanation is recorded and transcribed later." />
        <FieldGroup>
          <SwitchField
            label="Record microphone"
            checked={settings.audio.enabled}
            onChange={(value) => update((s) => ({ ...s, audio: { ...s.audio, enabled: value } }))}
          />
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel>Permission</FieldLabel>
              <FieldDescription>
                Chrome asks once for the extension – not for every page you test.
              </FieldDescription>
            </FieldContent>
            {mic.state === "granted" ? (
              <Badge variant="secondary" className="gap-1.5 text-success">
                <CheckCircle2Icon />
                Allowed
              </Badge>
            ) : (
              <Button
                variant={mic.state === "denied" ? "destructive" : "default"}
                onClick={async () => {
                  const ok = await mic.request();
                  if (ok) toast.success("Microphone allowed");
                  else toast.error("Permission denied", { description: "Allow it in the extension's site settings." });
                }}
              >
                <MicIcon />
                {mic.state === "denied" ? "Ask again" : "Allow microphone"}
              </Button>
            )}
          </Field>
        </FieldGroup>
      </div>

      <div>
        <SectionHeader title="Log" description="What the semantic recorder captures for the agent." />
        <FieldGroup>
          <SwitchField
            label="Element highlight"
            description="Outline the element under the cursor while recording."
            checked={recorder.highlight}
            onChange={(value) => setRecorder({ highlight: value })}
          />
          <FieldSeparator />
          <Field>
            <div className="flex items-center justify-between">
              <FieldLabel>Hover after</FieldLabel>
              <span className="font-mono text-sm text-muted-foreground">{recorder.hoverDwellMs} ms</span>
            </div>
            <Slider
              min={150}
              max={1500}
              step={50}
              value={[recorder.hoverDwellMs]}
              onValueChange={(value) => setRecorder({ hoverDwellMs: Array.isArray(value) ? (value[0] ?? 400) : value })}
            />
            <FieldDescription>Minimum dwell time before a hover is logged.</FieldDescription>
          </Field>
          <FieldSeparator />
          <SwitchField
            label="HTML snippets"
            description="Truncated outerHTML of clicked elements."
            checked={recorder.captureHtml}
            onChange={(value) => setRecorder({ captureHtml: value })}
          />
          <SwitchField
            label="Input values"
            description="Passwords and fields with data-qa-secret are always masked."
            checked={recorder.captureInputValues}
            onChange={(value) => setRecorder({ captureInputValues: value })}
          />
        </FieldGroup>
      </div>

      <div>
        <SectionHeader title="Replay" description="How the page is captured for session replay." />
        <FieldGroup>
          <SwitchField
            label="Mask all inputs in replay"
            checked={settings.replay.maskAllInputs}
            onChange={(value) => setReplay({ maskAllInputs: value })}
          />
          <SwitchField
            label="Record canvas"
            description="For charts and editors – uses significantly more storage."
            checked={settings.replay.recordCanvas}
            onChange={(value) => setReplay({ recordCanvas: value })}
          />
          <Field>
            <FieldLabel>Hide (CSS selectors)</FieldLabel>
            <Input
              placeholder=".cookie-banner, [data-private]"
              defaultValue={settings.replay.blockSelector}
              onBlur={(event) => setReplay({ blockSelector: event.target.value })}
            />
            <FieldDescription>These elements show up as gray boxes in the replay.</FieldDescription>
          </Field>
        </FieldGroup>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ Transcription */

const ENGINES: Array<{ value: TranscriptionEngine; label: string }> = [
  { value: "whisper", label: "Whisper (local)" },
  { value: "openai", label: "OpenAI (Cloud)" },
  { value: "none", label: "Off" },
];

function TranscriptionSection({ settings, update }: SectionProps) {
  const t = settings.transcription;
  const set = (patch: Partial<Settings["transcription"]>) =>
    update((s) => ({ ...s, transcription: { ...s.transcription, ...patch } }));
  const [showKey, setShowKey] = useState(false);

  return (
    <section className="space-y-10">
      <div>
        <SectionHeader
          title="Live transcript"
          description="During recording via OpenAI Realtime or Soniox. You see right away what was understood and which feedback point it belongs to – nothing left to transcribe afterwards."
        />
        <FieldGroup>
          <SwitchField
            label="Live transcript"
            description={(t.liveProvider === "soniox" ? t.sonioxKey : t.openaiKey) ? "Uses the API key below." : "Add an API key for the provider first (below)."}
            checked={t.live}
            onChange={(value) => set({ live: value })}
          />
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel>Provider</FieldLabel>
              <FieldDescription>Soniox is about 3x cheaper than gpt-4o-transcribe (~$0.12/h).</FieldDescription>
            </FieldContent>
            <Select
              items={LIVE_PROVIDERS}
              value={t.liveProvider}
              onValueChange={(value) => set({ liveProvider: value as "openai" | "soniox" })}
            >
              <SelectTrigger className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LIVE_PROVIDERS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {t.liveProvider === "soniox" && <SonioxModelField apiKey={t.sonioxKey} value={t.sonioxModel} onChange={(sonioxModel) => set({ sonioxModel })} />}
          {t.liveProvider === "openai" && (
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel>Model</FieldLabel>
              <FieldDescription>gpt-4o-transcribe is more accurate, the mini variant is cheaper.</FieldDescription>
            </FieldContent>
            <Select items={LIVE_MODELS} value={t.liveModel} onValueChange={(value) => set({ liveModel: String(value) })}>
              <SelectTrigger className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LIVE_MODELS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          )}
        </FieldGroup>
      </div>
      <div>
      <SectionHeader
        title="After recording"
        description="If there is no live transcript, the audio track is transcribed after recording."
      />
      <FieldGroup>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel>Default</FieldLabel>
            <FieldDescription>
              Whisper (local): nothing leaves your machine, one-time model download. OpenAI: faster, needs an API key.
            </FieldDescription>
          </FieldContent>
          <Select items={ENGINES} value={t.engine} onValueChange={(value) => set({ engine: value as TranscriptionEngine })}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ENGINES.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <FieldSeparator />
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel>Whisper model</FieldLabel>
            <FieldDescription>Larger = more accurate but slower. Base is a good trade-off.</FieldDescription>
          </FieldContent>
          <Select
            items={WHISPER_MODELS.map((model) => ({ value: model.id, label: `${model.label} · ${model.size}` }))}
            value={t.whisperModel}
            onValueChange={(value) => set({ whisperModel: value as WhisperModelId })}
          >
            <SelectTrigger className="w-44">
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
        </Field>
        <FieldSeparator />
        <Field>
          <FieldLabel>OpenAI API key</FieldLabel>
          <div className="flex gap-2">
            <Input
              type={showKey ? "text" : "password"}
              placeholder="sk-…"
              defaultValue={t.openaiKey}
              onBlur={(event) => set({ openaiKey: event.target.value.trim() })}
              className="font-mono"
            />
            <Button variant="outline" onClick={() => setShowKey((value) => !value)}>
              <KeyRoundIcon />
              {showKey ? "Hide" : "Show"}
            </Button>
          </div>
          <FieldDescription>Stored only locally in the extension and sent directly to api.openai.com.</FieldDescription>
        </Field>
        <FieldSeparator />
        <Field>
          <FieldLabel>Soniox API key</FieldLabel>
          <Input
            type={showKey ? "text" : "password"}
            defaultValue={t.sonioxKey}
            onBlur={(event) => set({ sonioxKey: event.target.value.trim() })}
            className="font-mono"
          />
          <FieldDescription>Only for the live transcript. Stored locally, sent directly to soniox.com.</FieldDescription>
        </Field>
        <FieldSeparator />
        <SwitchField
          label="Transcribe automatically"
          description="As soon as a new recording is opened."
          checked={t.auto}
          onChange={(value) => set({ auto: value })}
        />
      </FieldGroup>
      </div>
    </section>
  );
}

function SonioxModelField({ apiKey, value, onChange }: { apiKey: string; value: string; onChange: (value: string) => void }) {
  const [models, setModels] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setModels([]);
    setError(null);
    if (!apiKey) return;
    let cancelled = false;
    listSonioxModels(apiKey).then(
      (list) => !cancelled && setModels(list),
      (err: unknown) => !cancelled && setError(err instanceof Error ? err.message : String(err)),
    );
    return () => {
      cancelled = true;
    };
  }, [apiKey]);

  const items = [
    { value: SONIOX_LATEST, label: models[0] ? `Latest (${models[0]})` : "Latest" },
    ...models.map((id) => ({ value: id, label: id })),
    // Keep a pinned model selectable even if the list didn't load.
    ...(value !== SONIOX_LATEST && !models.includes(value) ? [{ value, label: value }] : []),
  ];

  return (
    <Field orientation="horizontal">
      <FieldContent>
        <FieldLabel>Model</FieldLabel>
        <FieldDescription>
          {error ?? (apiKey ? "Latest picks the newest real-time model at each recording start." : "Add the Soniox API key below to load the models.")}
        </FieldDescription>
      </FieldContent>
      <Select items={items} value={value} onValueChange={(next) => onChange(String(next))}>
        <SelectTrigger className="w-56">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

const LIVE_PROVIDERS = [
  { value: "openai", label: "OpenAI Realtime" },
  { value: "soniox", label: "Soniox" },
];

const LIVE_MODELS = [
  { value: "gpt-4o-transcribe", label: "gpt-4o-transcribe" },
  { value: "gpt-4o-mini-transcribe", label: "gpt-4o-mini-transcribe" },
];

/* ----------------------------------------------------------------- Feedback */

const PEN_COLORS = ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#a855f7"];

function FeedbackSection({ settings, update }: SectionProps) {
  const f = settings.feedback;
  const set = (patch: Partial<Settings["feedback"]>) => update((s) => ({ ...s, feedback: { ...s.feedback, ...patch } }));
  return (
    <section>
      <SectionHeader
        title="Feedback"
        description="Feedback points are explicit findings: element, comment, screenshot and context bundled – what the agent needs to fix it."
      />
      <FieldGroup>
        <SwitchField
          label="Right-click starts a feedback point"
          description="While recording. Everything you say or type afterwards is attached to that element. Alt+right-click opens the normal context menu."
          checked={f.contextMenu}
          onChange={(value) => set({ contextMenu: value })}
        />
        <FieldSeparator />
        <SwitchField
          label="Screenshot on errors"
          description="Automatically capture the visible area on console errors and failed requests."
          checked={f.screenshotOnError}
          onChange={(value) => set({ screenshotOnError: value })}
        />
        <FieldSeparator />
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel>Pen color</FieldLabel>
            <FieldDescription>Each stroke creates an annotated screenshot.</FieldDescription>
          </FieldContent>
          <div className="flex gap-2">
            {PEN_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={`Color ${color}`}
                onClick={() => set({ penColor: color })}
                className={cn(
                  "size-6 rounded-full ring-offset-2 ring-offset-background transition",
                  f.penColor === color ? "ring-2 ring-foreground/60" : "opacity-70 hover:opacity-100",
                )}
                style={{ background: color }}
              />
            ))}
          </div>
        </Field>
      </FieldGroup>
    </section>
  );
}

/* -------------------------------------------------------------- Claude Code */

function ClaudeSection({ settings, update }: SectionProps) {
  const h = settings.handoff;
  const set = (patch: Partial<Settings["handoff"]>) => update((s) => ({ ...s, handoff: { ...s.handoff, ...patch } }));
  const [health, setHealth] = useState<EndpointHealth | null>(null);
  const [checking, setChecking] = useState(false);

  const test = async (endpoint = h.endpoint) => {
    setChecking(true);
    setHealth(await checkEndpoint(endpoint));
    setChecking(false);
  };
  useEffect(() => {
    void test();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const command = "claude mcp add talkcontext -- node <path-to-repo>/mcp/dist/index.js";

  return (
    <section>
      <SectionHeader
        title="Claude Code"
        description="Recordings are sent as a handoff (feedback points, screenshots, DOM, logs) to a local MCP server. Then in Claude Code just say: “Fix the latest TalkContext feedback”."
      />
      <FieldGroup>
        <Field>
          <FieldLabel>Setup (one-time)</FieldLabel>
          <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 font-mono text-xs">
            <span className="min-w-0 flex-1 truncate">{command}</span>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Copy"
              onClick={() => {
                void navigator.clipboard.writeText(command);
                toast.success("Command copied");
              }}
            >
              <CopyIcon />
            </Button>
          </div>
          <FieldDescription>
            First run <span className="font-mono">pnpm --filter talkcontext-mcp build</span> in the repo. While Claude Code is running, the server
            listens on the endpoint below and stores recordings in <span className="font-mono">~/.talkcontext/sessions</span>.
          </FieldDescription>
        </Field>
        <FieldSeparator />
        <Field>
          <FieldLabel>Endpoint</FieldLabel>
          <div className="flex gap-2">
            <Input
              defaultValue={h.endpoint}
              className="font-mono"
              onBlur={(event) => {
                const endpoint = event.target.value.trim() || "http://127.0.0.1:4777";
                set({ endpoint });
                void test(endpoint);
              }}
            />
            <Button variant="outline" onClick={() => void test()} disabled={checking}>
              {checking ? <Loader2Icon className="animate-spin" /> : <PlugZapIcon />}
              Test
            </Button>
          </div>
          <FieldDescription>
            {health === null
              ? "…"
              : health.ok
                ? `Connected – TalkContext MCP ${health.version ?? ""}${health.dir ? ` · ${health.dir}` : ""}`
                : `Unreachable (${health.error}). Is Claude Code running with the TalkContext server?`}
          </FieldDescription>
        </Field>
        <FieldSeparator />
        <SwitchField
          label="Send automatically"
          description="After stopping (and transcription, if any), the recording goes straight to Claude Code."
          checked={h.autoSend}
          onChange={(value) => set({ autoSend: value })}
        />
      </FieldGroup>
    </section>
  );
}

/* --------------------------------------------------------------------- Data */

function DataSection() {
  const [usage, setUsage] = useState<{ usage: number; quota: number } | null>(null);
  const [count, setCount] = useState(0);

  const refresh = () => {
    void estimateUsage().then(setUsage);
    void listRecordings().then((list) => setCount(list.length));
  };
  useEffect(refresh, []);

  return (
    <section>
      <SectionHeader title="Data" description="All recordings are stored locally in this browser profile only." />
      <FieldGroup>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel>Storage</FieldLabel>
            <FieldDescription>
              {count} recording{count === 1 ? "" : "s"} · {usage ? formatBytes(usage.usage) : "…"} used
            </FieldDescription>
          </FieldContent>
        </Field>
        <FieldSeparator />
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel>Delete all recordings</FieldLabel>
            <FieldDescription>Settings and environments are kept.</FieldDescription>
          </FieldContent>
          <AlertDialog>
            <AlertDialogTrigger render={<Button variant="destructive" disabled={count === 0} />}>
              <Trash2Icon />
              Delete all
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete {count} recordings?</AlertDialogTitle>
                <AlertDialogDescription>This can't be undone.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={async () => {
                    for (const recording of await listRecordings()) await deleteRecording(recording.id);
                    toast.success("All recordings deleted");
                    refresh();
                  }}
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </Field>
      </FieldGroup>
    </section>
  );
}
