import { CopyIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import type { QaEvent } from "@shared/types";
import { Button } from "@/components/ui/button";
import { eventMeta } from "./event-meta";

export function ElementInspector({ event, onClose }: { event: QaEvent; onClose: () => void }) {
  const ref = event.target;
  const meta = eventMeta(event);
  const copy = (value: string) => {
    void navigator.clipboard.writeText(value);
    toast.success("Kopiert");
  };

  return (
    <div className="max-h-[45%] shrink-0 overflow-auto border-t bg-muted/30 p-3 text-xs">
      <div className="mb-2 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Element</p>
          <p className="truncate text-sm font-medium">{meta.label}</p>
        </div>
        <Button size="icon-xs" variant="ghost" onClick={onClose} aria-label="Schließen">
          <XIcon />
        </Button>
      </div>
      {ref ? (
        <dl className="grid grid-cols-[72px_1fr] gap-x-2 gap-y-1.5">
          <Row label="Selektor" value={ref.selector} onCopy={copy} mono />
          <Row label="XPath" value={ref.xpath} onCopy={copy} mono />
          {ref.role && <Row label="Rolle" value={ref.role} />}
          {ref.name && <Row label="Name" value={ref.name} />}
          {ref.path?.length ? <Row label="Pfad" value={ref.path.join(" › ")} mono /> : null}
          {ref.attrs &&
            Object.entries(ref.attrs).map(([key, value]) => <Row key={key} label={key} value={value} mono />)}
          {ref.html && (
            <>
              <dt className="text-muted-foreground">HTML</dt>
              <dd>
                <pre className="max-h-32 overflow-auto rounded-md border bg-background p-2 font-mono text-[11px] whitespace-pre-wrap">
                  {ref.html}
                </pre>
              </dd>
            </>
          )}
        </dl>
      ) : (
        <p className="text-muted-foreground">Kein Element zu diesem Ereignis.</p>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  mono,
  onCopy,
}: {
  label: string;
  value: string;
  mono?: boolean;
  onCopy?: (value: string) => void;
}) {
  return (
    <>
      <dt className="truncate text-muted-foreground">{label}</dt>
      <dd className="group flex min-w-0 items-start gap-1">
        <span className={mono ? "font-mono break-all" : "break-words"}>{value}</span>
        {onCopy && (
          <button
            type="button"
            onClick={() => onCopy(value)}
            className="opacity-0 transition group-hover:opacity-100"
            aria-label="Kopieren"
          >
            <CopyIcon className="size-3 text-muted-foreground" />
          </button>
        )}
      </dd>
    </>
  );
}
