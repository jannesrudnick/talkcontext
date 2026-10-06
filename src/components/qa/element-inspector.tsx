"use client";

import { Badge } from "@/components/ui/badge";
import type { ElementRef } from "@/lib/qa/types";

interface ElementInspectorProps {
  element: ElementRef | null;
}

/** Shows what the recorder currently sees of the targeted element. */
export function ElementInspector({ element }: ElementInspectorProps) {
  if (!element) {
    return (
      <p className="px-3 py-6 text-center text-xs text-muted-foreground">
        No element captured yet. Move the mouse over an element in the frame.
      </p>
    );
  }

  return (
    <div className="space-y-3 p-3 text-xs">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="secondary" className="font-mono">
          {element.tag}
        </Badge>
        {element.role && <Badge variant="outline">role={element.role}</Badge>}
        {element.rect && (
          <span className="text-[10px] text-muted-foreground">
            {element.rect.w}×{element.rect.h} @ {element.rect.x},{element.rect.y}
          </span>
        )}
      </div>

      <Field label="Selector" value={element.selector} mono />
      {element.name && <Field label="Name" value={element.name} />}
      {element.text && element.text !== element.name && <Field label="Text" value={element.text} />}
      {element.path?.length ? <Field label="Path" value={element.path.join(" › ")} mono /> : null}
      <Field label="XPath" value={element.xpath} mono />

      {element.attrs && Object.keys(element.attrs).length > 0 && (
        <div>
          <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Attributes</p>
          <dl className="space-y-0.5">
            {Object.entries(element.attrs).map(([key, value]) => (
              <div key={key} className="flex gap-2">
                <dt className="shrink-0 font-mono text-[10px] text-muted-foreground">{key}</dt>
                <dd className="min-w-0 flex-1 truncate font-mono text-[10px]">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {element.html && (
        <div>
          <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">HTML</p>
          <pre className="max-h-40 overflow-auto rounded-md bg-muted p-2 font-mono text-[10px] leading-relaxed">
            {element.html}
          </pre>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="mb-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={mono ? "break-all font-mono text-[11px]" : "break-words text-[11px]"}>{value}</p>
    </div>
  );
}
