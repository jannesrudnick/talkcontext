import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import {
  CheckCircle2Icon,
  DatabaseIcon,
  GlobeIcon,
  KeyRoundIcon,
  MicIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  Trash2Icon,
  VideoIcon,
} from "lucide-react";
import { toast } from "sonner";
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
import { WHISPER_MODELS } from "@/lib/transcription/transcribe";
import type { Settings, TranscriptionEngine, WhisperModelId } from "@/lib/types";
import { cn } from "@/lib/utils";
import { EnvironmentsSection } from "./environments";
import { useMicPermission } from "./use-mic-permission";

const SECTIONS = [
  { id: "general", label: "Allgemein", icon: SlidersHorizontalIcon },
  { id: "environments", label: "Umgebungen", icon: GlobeIcon },
  { id: "recording", label: "Aufnahme", icon: VideoIcon },
  { id: "transcription", label: "Transkription", icon: SparklesIcon },
  { id: "data", label: "Daten", icon: DatabaseIcon },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

export function SettingsPage({ section }: { section?: string }) {
  const active: SectionId = SECTIONS.some((s) => s.id === section) ? (section as SectionId) : "general";
  const { settings, update, loaded } = useSettings();

  return (
    <div className="mx-auto flex w-full max-w-5xl gap-10 px-8 py-8">
      <nav className="sticky top-8 flex w-48 shrink-0 flex-col gap-0.5 self-start">
        <h1 className="mb-4 text-2xl font-semibold tracking-tight">Einstellungen</h1>
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
        {loaded && active === "transcription" && <TranscriptionSection settings={settings} update={update} />}
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

/* ---------------------------------------------------------------- Allgemein */

const LANGUAGES = [
  { value: "de-DE", label: "Deutsch" },
  { value: "en-US", label: "Englisch" },
  { value: "fr-FR", label: "Französisch" },
  { value: "es-ES", label: "Spanisch" },
];

const THEMES = [
  { value: "system", label: "System" },
  { value: "light", label: "Hell" },
  { value: "dark", label: "Dunkel" },
];

function GeneralSection({ settings, update }: SectionProps) {
  return (
    <section>
      <SectionHeader title="Allgemein" description="Sprache, Erscheinungsbild und Verhalten nach der Aufnahme." />
      <FieldGroup>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel>Sprache der Erklärung</FieldLabel>
            <FieldDescription>Wird für die Transkription verwendet.</FieldDescription>
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
            <FieldLabel>Erscheinungsbild</FieldLabel>
            <FieldDescription>Das Overlay auf der Seite ist immer dunkel, damit es sich abhebt.</FieldDescription>
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
          label="Aufnahme nach dem Stoppen öffnen"
          description="Öffnet das Replay in einem neuen Tab – dort startet auch die Transkription."
          checked={settings.openAfterStop}
          onChange={(value) => update((s) => ({ ...s, openAfterStop: value }))}
        />
        <FieldSeparator />
        <Field>
          <FieldLabel>Tastenkürzel</FieldLabel>
          <FieldDescription>
            <span className="font-mono">Alt+Shift+Q</span> blendet das Overlay ein, <span className="font-mono">Alt+Shift+R</span>{" "}
            startet/stoppt die Aufnahme. Ändern unter{" "}
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

/* ----------------------------------------------------------------- Aufnahme */

function RecordingSection({ settings, update }: SectionProps) {
  const mic = useMicPermission();
  const recorder = settings.recorder;
  const setRecorder = (patch: Partial<Settings["recorder"]>) =>
    update((s) => ({ ...s, recorder: { ...s.recorder, ...patch } }));
  const setReplay = (patch: Partial<Settings["replay"]>) => update((s) => ({ ...s, replay: { ...s.replay, ...patch } }));

  return (
    <section className="space-y-10">
      <div>
        <SectionHeader title="Mikrofon" description="Deine gesprochene Erklärung wird mit aufgenommen und später transkribiert." />
        <FieldGroup>
          <SwitchField
            label="Mikrofon aufnehmen"
            checked={settings.audio.enabled}
            onChange={(value) => update((s) => ({ ...s, audio: { ...s.audio, enabled: value } }))}
          />
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel>Freigabe</FieldLabel>
              <FieldDescription>
                Chrome fragt einmalig für die Extension – nicht für jede Seite, die du testest.
              </FieldDescription>
            </FieldContent>
            {mic.state === "granted" ? (
              <Badge variant="secondary" className="gap-1.5 text-success">
                <CheckCircle2Icon />
                Freigegeben
              </Badge>
            ) : (
              <Button
                variant={mic.state === "denied" ? "destructive" : "default"}
                onClick={async () => {
                  const ok = await mic.request();
                  if (ok) toast.success("Mikrofon freigegeben");
                  else toast.error("Freigabe abgelehnt", { description: "In den Website-Einstellungen der Extension erlauben." });
                }}
              >
                <MicIcon />
                {mic.state === "denied" ? "Erneut anfragen" : "Mikrofon freigeben"}
              </Button>
            )}
          </Field>
        </FieldGroup>
      </div>

      <div>
        <SectionHeader title="Protokoll" description="Was der semantische Recorder für den Agenten mitschreibt." />
        <FieldGroup>
          <SwitchField
            label="Element-Hervorhebung"
            description="Rahmen um das Element unter dem Cursor während der Aufnahme."
            checked={recorder.highlight}
            onChange={(value) => setRecorder({ highlight: value })}
          />
          <FieldSeparator />
          <Field>
            <div className="flex items-center justify-between">
              <FieldLabel>Hover ab</FieldLabel>
              <span className="font-mono text-sm text-muted-foreground">{recorder.hoverDwellMs} ms</span>
            </div>
            <Slider
              min={150}
              max={1500}
              step={50}
              value={[recorder.hoverDwellMs]}
              onValueChange={(value) => setRecorder({ hoverDwellMs: Array.isArray(value) ? (value[0] ?? 400) : value })}
            />
            <FieldDescription>Mindest-Verweildauer, ab der ein Hover im Protokoll landet.</FieldDescription>
          </Field>
          <FieldSeparator />
          <SwitchField
            label="HTML-Ausschnitte"
            description="Gekürztes outerHTML angeklickter Elemente."
            checked={recorder.captureHtml}
            onChange={(value) => setRecorder({ captureHtml: value })}
          />
          <SwitchField
            label="Eingabewerte"
            description="Passwörter und Felder mit data-qa-secret bleiben immer maskiert."
            checked={recorder.captureInputValues}
            onChange={(value) => setRecorder({ captureInputValues: value })}
          />
        </FieldGroup>
      </div>

      <div>
        <SectionHeader title="Replay" description="Wie die Seite für das Session-Replay mitgeschnitten wird." />
        <FieldGroup>
          <SwitchField
            label="Alle Eingaben im Replay maskieren"
            checked={settings.replay.maskAllInputs}
            onChange={(value) => setReplay({ maskAllInputs: value })}
          />
          <SwitchField
            label="Canvas aufzeichnen"
            description="Für Charts und Editoren – kostet deutlich mehr Speicher."
            checked={settings.replay.recordCanvas}
            onChange={(value) => setReplay({ recordCanvas: value })}
          />
          <Field>
            <FieldLabel>Ausblenden (CSS-Selektoren)</FieldLabel>
            <Input
              placeholder=".cookie-banner, [data-private]"
              defaultValue={settings.replay.blockSelector}
              onBlur={(event) => setReplay({ blockSelector: event.target.value })}
            />
            <FieldDescription>Diese Elemente erscheinen im Replay nur als graue Fläche.</FieldDescription>
          </Field>
        </FieldGroup>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ Transkription */

const ENGINES: Array<{ value: TranscriptionEngine; label: string }> = [
  { value: "whisper", label: "Whisper lokal" },
  { value: "openai", label: "OpenAI (Cloud)" },
  { value: "none", label: "Aus" },
];

function TranscriptionSection({ settings, update }: SectionProps) {
  const t = settings.transcription;
  const set = (patch: Partial<Settings["transcription"]>) =>
    update((s) => ({ ...s, transcription: { ...s.transcription, ...patch } }));
  const [showKey, setShowKey] = useState(false);

  return (
    <section>
      <SectionHeader
        title="Transkription"
        description="Die Tonspur wird nach der Aufnahme in Text übersetzt und mit den Interaktionen verknüpft."
      />
      <FieldGroup>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel>Standard</FieldLabel>
            <FieldDescription>
              Whisper lokal: nichts verlässt den Rechner, einmaliger Modell-Download. OpenAI: schneller, braucht API-Key.
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
            <FieldLabel>Whisper-Modell</FieldLabel>
            <FieldDescription>Größer = genauer, aber langsamer. Base ist ein guter Kompromiss.</FieldDescription>
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
          <FieldLabel>OpenAI-API-Key</FieldLabel>
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
              {showKey ? "Verbergen" : "Anzeigen"}
            </Button>
          </div>
          <FieldDescription>Liegt nur lokal im Speicher der Extension und geht direkt an api.openai.com.</FieldDescription>
        </Field>
        <FieldSeparator />
        <SwitchField
          label="Automatisch transkribieren"
          description="Sobald eine frische Aufnahme geöffnet wird."
          checked={t.auto}
          onChange={(value) => set({ auto: value })}
        />
      </FieldGroup>
    </section>
  );
}

/* -------------------------------------------------------------------- Daten */

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
      <SectionHeader title="Daten" description="Alle Aufnahmen liegen ausschließlich lokal in diesem Browser-Profil." />
      <FieldGroup>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel>Speicher</FieldLabel>
            <FieldDescription>
              {count} Aufnahme{count === 1 ? "" : "n"} · {usage ? formatBytes(usage.usage) : "…"} belegt
            </FieldDescription>
          </FieldContent>
        </Field>
        <FieldSeparator />
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel>Alle Aufnahmen löschen</FieldLabel>
            <FieldDescription>Einstellungen und Umgebungen bleiben erhalten.</FieldDescription>
          </FieldContent>
          <AlertDialog>
            <AlertDialogTrigger render={<Button variant="destructive" disabled={count === 0} />}>
              <Trash2Icon />
              Alle löschen
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{count} Aufnahmen löschen?</AlertDialogTitle>
                <AlertDialogDescription>Das kann nicht rückgängig gemacht werden.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={async () => {
                    for (const recording of await listRecordings()) await deleteRecording(recording.id);
                    toast.success("Alle Aufnahmen gelöscht");
                    refresh();
                  }}
                >
                  Löschen
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </Field>
      </FieldGroup>
    </section>
  );
}
