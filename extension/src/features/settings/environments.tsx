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
        name: `Environment ${list.length + 1}`,
        color: COLORS[list.length % COLORS.length]!,
        patterns: [""],
        notes: "",
        variables: [],
      },
    ]);

  return (
    <section>
      <SectionHeader
        title="Environments"
        description="Local, Staging, Production … TalkContext detects the environment from the URL, shows it in the overlay and attaches notes and variables to every recording – so the agent knows where to test."
        action={
          <Button onClick={add}>
            <PlusIcon />
            Environment
          </Button>
        }
      />
      {settings.environments.length === 0 ? (
        <Empty className="rounded-2xl border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <GlobeIcon />
            </EmptyMedia>
            <EmptyTitle>No environments</EmptyTitle>
            <EmptyDescription>Recordings work without one – with an environment the agent gets more context.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={add}>
              <PlusIcon />
              Add first environment
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
              aria-label={`Color ${color}`}
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
          {env.name || "Untitled"}
        </Badge>
        <Button size="icon" variant="ghost" onClick={onRemove} aria-label="Delete environment">
          <Trash2Icon />
        </Button>
      </CardHeader>
      <CardContent className="space-y-6">
        <Field>
          <FieldLabel>URL patterns</FieldLabel>
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
                  aria-label="Remove pattern"
                  onClick={() => onChange({ ...env, patterns: env.patterns.filter((_, i) => i !== index) })}
                >
                  <Trash2Icon />
                </Button>
              </div>
            ))}
            <Button size="sm" variant="outline" onClick={() => onChange({ ...env, patterns: [...env.patterns, ""] })}>
              <PlusIcon />
              Pattern
            </Button>
          </div>
          <FieldDescription>
            <span className="font-mono">*</span> matches any characters, e.g.{" "}
            <span className="font-mono">http://localhost:*/*</span>. The first matching environment wins.
          </FieldDescription>
        </Field>

        <Field>
          <FieldLabel>Notes for the agent</FieldLabel>
          <Textarea
            value={env.notes}
            placeholder={"Test user: qa@example.com\nFeature flag “new-checkout” is enabled here\nDeploy: main, automatic"}
            rows={3}
            onChange={(event) => onChange({ ...env, notes: event.target.value })}
          />
          <FieldDescription>Included in the context section of every export.</FieldDescription>
        </Field>

        <Field>
          <FieldLabel>Variables</FieldLabel>
          <div className="overflow-hidden rounded-lg border">
            {env.variables.length === 0 && (
              <p className="px-3 py-3 text-sm text-muted-foreground">
                E.g. <span className="font-mono">API_URL</span>, <span className="font-mono">BUILD</span>,{" "}
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
            Secret values (lock) are never included in recordings or exports – only the name is.
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
        placeholder="Value"
        className="h-8 flex-1 font-mono text-xs"
        onChange={(event) => onChange({ value: event.target.value })}
      />
      {variable.secret && (
        <Button size="icon-sm" variant="ghost" onClick={() => setReveal((value) => !value)} aria-label="Show">
          {reveal ? <EyeOffIcon /> : <EyeIcon />}
        </Button>
      )}
      <Button
        size="icon-sm"
        variant={variable.secret ? "secondary" : "ghost"}
        title={variable.secret ? "Secret – not exported" : "Mark as secret"}
        onClick={() => onChange({ secret: !variable.secret })}
      >
        {variable.secret ? <LockIcon /> : <UnlockIcon />}
      </Button>
      <Button size="icon-sm" variant="ghost" onClick={onRemove} aria-label="Remove variable">
        <Trash2Icon />
      </Button>
    </div>
  );
}
