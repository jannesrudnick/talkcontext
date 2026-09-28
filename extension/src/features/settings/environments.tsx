import { useState } from "react";
import { EyeIcon, EyeOffIcon, GlobeIcon, LockIcon, PlusIcon, Trash2Icon, UnlockIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { newId } from "@/lib/settings";
import type { Environment, EnvVariable, Settings } from "@/lib/types";
import { cn } from "@/lib/utils";
import { SectionHeader } from "./settings-page";

const COLORS = ["#22c55e", "#3b82f6", "#f59e0b", "#ef4444", "#a855f7", "#ec4899", "#14b8a6", "#64748b"];

type SectionProps = { settings: Settings; update: (updater: (current: Settings) => Settings) => void };

export function EnvironmentsSection({ settings, update }: SectionProps) {
  const setEnvironments = (updater: (list: Environment[]) => Environment[]) =>
    update((s) => ({ ...s, environments: updater(s.environments) }));

  const add = () =>
    setEnvironments((list) => [
      ...list,
      {
        id: newId("env_"),
        name: `Umgebung ${list.length + 1}`,
        color: COLORS[list.length % COLORS.length]!,
        patterns: [""],
        notes: "",
        variables: [],
      },
    ]);

  return (
    <section>
      <SectionHeader
        title="Umgebungen"
        description="Lokal, Staging, Produktion … Anhand der URL erkennt qey die Umgebung, zeigt sie im Overlay und hängt Notizen und Variablen an jede Aufnahme – damit der Agent weiß, wo er testen kann."
        action={
          <Button onClick={add}>
            <PlusIcon />
            Umgebung
          </Button>
        }
      />
      {settings.environments.length === 0 ? (
        <Empty className="rounded-2xl border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <GlobeIcon />
            </EmptyMedia>
            <EmptyTitle>Keine Umgebungen</EmptyTitle>
            <EmptyDescription>Aufnahmen funktionieren auch ohne – mit Umgebung bekommt der Agent mehr Kontext.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={add}>
              <PlusIcon />
              Erste Umgebung anlegen
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="space-y-4">
          {settings.environments.map((env) => (
            <EnvironmentCard
              key={env.id}
              env={env}
              onChange={(next) => setEnvironments((list) => list.map((item) => (item.id === env.id ? next : item)))}
              onRemove={() => setEnvironments((list) => list.filter((item) => item.id !== env.id))}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function EnvironmentCard({
  env,
  onChange,
  onRemove,
}: {
  env: Environment;
  onChange: (env: Environment) => void;
  onRemove: () => void;
}) {
  const setVariable = (id: string, patch: Partial<EnvVariable>) =>
    onChange({ ...env, variables: env.variables.map((v) => (v.id === id ? { ...v, ...patch } : v)) });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-3">
        <div className="flex gap-1">
          {COLORS.map((color) => (
            <button
              key={color}
              type="button"
              aria-label={`Farbe ${color}`}
              onClick={() => onChange({ ...env, color })}
              className={cn(
                "size-4 rounded-full ring-offset-2 ring-offset-card transition",
                env.color === color ? "ring-2 ring-foreground/60" : "opacity-60 hover:opacity-100",
              )}
              style={{ background: color }}
            />
          ))}
        </div>
        <Input
          value={env.name}
          onChange={(event) => onChange({ ...env, name: event.target.value })}
          className="h-8 max-w-60 border-transparent bg-transparent text-base font-semibold shadow-none hover:border-input focus-visible:border-ring"
        />
        <Badge variant="outline" className="ml-auto gap-1.5">
          <span className="size-1.5 rounded-full" style={{ background: env.color }} />
          {env.name || "Ohne Namen"}
        </Badge>
        <Button size="icon" variant="ghost" onClick={onRemove} aria-label="Umgebung löschen">
          <Trash2Icon />
        </Button>
      </CardHeader>
      <CardContent className="space-y-6">
        <Field>
          <FieldLabel>URL-Muster</FieldLabel>
          <div className="space-y-2">
            {env.patterns.map((pattern, index) => (
              <div key={index} className="flex gap-2">
                <Input
                  value={pattern}
                  placeholder="https://*.staging.example.com/*"
                  className="font-mono text-xs"
                  onChange={(event) =>
                    onChange({ ...env, patterns: env.patterns.map((p, i) => (i === index ? event.target.value : p)) })
                  }
                />
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Muster entfernen"
                  onClick={() => onChange({ ...env, patterns: env.patterns.filter((_, i) => i !== index) })}
                >
                  <Trash2Icon />
                </Button>
              </div>
            ))}
            <Button size="sm" variant="outline" onClick={() => onChange({ ...env, patterns: [...env.patterns, ""] })}>
              <PlusIcon />
              Muster
            </Button>
          </div>
          <FieldDescription>
            <span className="font-mono">*</span> steht für beliebige Zeichen, z.B.{" "}
            <span className="font-mono">http://localhost:*/*</span>. Die erste passende Umgebung gewinnt.
          </FieldDescription>
        </Field>

        <Field>
          <FieldLabel>Notizen für den Agenten</FieldLabel>
          <Textarea
            value={env.notes}
            placeholder={"Testnutzer: qa@example.com\nFeature-Flag „new-checkout“ ist hier aktiv\nDeploy: main, automatisch"}
            rows={3}
            onChange={(event) => onChange({ ...env, notes: event.target.value })}
          />
          <FieldDescription>Landet im Kontext-Abschnitt jedes Exports.</FieldDescription>
        </Field>

        <Field>
          <FieldLabel>Variablen</FieldLabel>
          <div className="overflow-hidden rounded-lg border">
            {env.variables.length === 0 && (
              <p className="px-3 py-3 text-sm text-muted-foreground">
                Z.B. <span className="font-mono">API_URL</span>, <span className="font-mono">BUILD</span>,{" "}
                <span className="font-mono">TEST_USER</span>.
              </p>
            )}
            {env.variables.map((variable) => (
              <VariableRow
                key={variable.id}
                variable={variable}
                onChange={(patch) => setVariable(variable.id, patch)}
                onRemove={() => onChange({ ...env, variables: env.variables.filter((v) => v.id !== variable.id) })}
              />
            ))}
          </div>
          <div>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                onChange({
                  ...env,
                  variables: [...env.variables, { id: newId("var_"), key: "", value: "", secret: false }],
                })
              }
            >
              <PlusIcon />
              Variable
            </Button>
          </div>
          <FieldDescription>
            Geheime Werte (Schloss) werden nie in Aufnahmen oder Exporte übernommen – dort steht nur der Name.
          </FieldDescription>
        </Field>
      </CardContent>
    </Card>
  );
}

function VariableRow({
  variable,
  onChange,
  onRemove,
}: {
  variable: EnvVariable;
  onChange: (patch: Partial<EnvVariable>) => void;
  onRemove: () => void;
}) {
  const [reveal, setReveal] = useState(false);
  return (
    <div className="flex items-center gap-2 border-b px-2 py-1.5 last:border-b-0">
      <Input
        value={variable.key}
        placeholder="NAME"
        className="h-8 w-48 font-mono text-xs uppercase"
        onChange={(event) => onChange({ key: event.target.value.replace(/\s+/g, "_") })}
      />
      <span className="text-muted-foreground">=</span>
      <Input
        value={variable.value}
        type={variable.secret && !reveal ? "password" : "text"}
        placeholder="Wert"
        className="h-8 flex-1 font-mono text-xs"
        onChange={(event) => onChange({ value: event.target.value })}
      />
      {variable.secret && (
        <Button size="icon-sm" variant="ghost" onClick={() => setReveal((value) => !value)} aria-label="Anzeigen">
          {reveal ? <EyeOffIcon /> : <EyeIcon />}
        </Button>
      )}
      <Button
        size="icon-sm"
        variant={variable.secret ? "secondary" : "ghost"}
        title={variable.secret ? "Geheim – wird nicht exportiert" : "Als geheim markieren"}
        onClick={() => onChange({ secret: !variable.secret })}
      >
        {variable.secret ? <LockIcon /> : <UnlockIcon />}
      </Button>
      <Button size="icon-sm" variant="ghost" onClick={onRemove} aria-label="Variable entfernen">
        <Trash2Icon />
      </Button>
    </div>
  );
}
