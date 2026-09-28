import { ArrowRightIcon, CheckCircle2Icon, GlobeIcon, MicIcon, MousePointerClickIcon, PuzzleIcon } from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { navigate } from "@/hooks/use-hash-route";
import { useMicPermission } from "@/features/settings/use-mic-permission";

export function WelcomePage() {
  const mic = useMicPermission();

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-8 py-14">
      <div className="space-y-4">
        <Badge variant="secondary" className="gap-1.5">
          <span className="size-1.5 rounded-full bg-brand" />
          Willkommen bei qey
        </Badge>
        <h1 className="text-4xl font-semibold tracking-tight text-balance">
          Klick dich durch, erklär laut – der Agent bekommt ein Protokoll statt eines Videos.
        </h1>
        <p className="max-w-2xl text-lg text-muted-foreground text-pretty">
          qey legt sich als Overlay über jede Web-App. Jede Session wird als Replay gespeichert – mit den
          DOM-Elementen, Konsolenfehlern, Requests und deiner Erklärung auf einer Zeitachse.
        </p>
      </div>

      <ol className="space-y-3">
        <Step
          index={1}
          icon={<PuzzleIcon />}
          title="Extension anheften"
          description="Puzzle-Symbol in der Chrome-Toolbar → qey anpinnen. Ein Klick darauf blendet das Overlay ein."
        />
        <Step
          index={2}
          icon={<MicIcon />}
          title="Mikrofon freigeben"
          description="Einmalig für die Extension – danach fragt Chrome bei keiner Seite mehr nach."
          done={mic.state === "granted"}
          action={
            mic.state !== "granted" && (
              <Button
                onClick={async () => {
                  if (await mic.request()) toast.success("Mikrofon freigegeben");
                  else toast.error("Freigabe abgelehnt");
                }}
              >
                Freigeben
              </Button>
            )
          }
        />
        <Step
          index={3}
          icon={<GlobeIcon />}
          title="Umgebungen hinterlegen"
          description="URLs für Lokal, Staging & Co., dazu Testnutzer, Flags und Variablen für den Agenten."
          action={
            <Button variant="outline" onClick={() => navigate("settings/environments")}>
              Einrichten
            </Button>
          }
        />
        <Step
          index={4}
          icon={<MousePointerClickIcon />}
          title="Aufnehmen"
          description={
            <>
              In deiner App <Kbd>Alt</Kbd> <Kbd>Shift</Kbd> <Kbd>Q</Kbd> drücken oder aufs Symbol klicken, dann
              „Aufnahme starten“. <Kbd>Alt</Kbd> <Kbd>Shift</Kbd> <Kbd>R</Kbd> startet und stoppt direkt.
            </>
          }
        />
      </ol>

      <div>
        <Button size="lg" onClick={() => navigate("recordings")}>
          Zu den Aufnahmen
          <ArrowRightIcon />
        </Button>
      </div>
    </div>
  );
}

function Step({
  index,
  icon,
  title,
  description,
  action,
  done,
}: {
  index: number;
  icon: ReactNode;
  title: string;
  description: ReactNode;
  action?: ReactNode;
  done?: boolean;
}) {
  return (
    <li className="flex items-center gap-4 rounded-2xl border bg-card p-4">
      <span className="relative flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand [&_svg]:size-5">
        {done ? <CheckCircle2Icon className="text-success" /> : icon}
        <span className="absolute -top-1.5 -left-1.5 flex size-5 items-center justify-center rounded-full border bg-background text-[10px] font-semibold text-muted-foreground">
          {index}
        </span>
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-medium">{title}</p>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {action}
    </li>
  );
}
