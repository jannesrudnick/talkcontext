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
          Welcome to qey
        </Badge>
        <h1 className="text-4xl font-semibold tracking-tight text-balance">
          Click through, explain out loud – the agent gets a log instead of a video.
        </h1>
        <p className="max-w-2xl text-lg text-muted-foreground text-pretty">
          qey sits as an overlay on top of any web app. Every session is saved as a replay – with DOM
          elements, console errors, requests and your explanation on one timeline.
        </p>
      </div>

      <ol className="space-y-3">
        <Step
          index={1}
          icon={<PuzzleIcon />}
          title="Pin the extension"
          description="Puzzle icon in the Chrome toolbar → pin qey. Clicking it shows the overlay."
        />
        <Step
          index={2}
          icon={<MicIcon />}
          title="Allow microphone"
          description="Once for the extension – Chrome won't ask again on any page."
          done={mic.state === "granted"}
          action={
            mic.state !== "granted" && (
              <Button
                onClick={async () => {
                  if (await mic.request()) toast.success("Microphone allowed");
                  else toast.error("Permission denied");
                }}
              >
                Allow
              </Button>
            )
          }
        />
        <Step
          index={3}
          icon={<GlobeIcon />}
          title="Add environments"
          description="URLs for Local, Staging & co., plus test users, flags and variables for the agent."
          action={
            <Button variant="outline" onClick={() => navigate("settings/environments")}>
              Set up
            </Button>
          }
        />
        <Step
          index={4}
          icon={<MousePointerClickIcon />}
          title="Record"
          description={
            <>
              In your app, press <Kbd>Alt</Kbd> <Kbd>Shift</Kbd> <Kbd>Q</Kbd> or click the icon, then “Start
              recording”. <Kbd>Alt</Kbd> <Kbd>Shift</Kbd> <Kbd>R</Kbd> starts and stops directly.
            </>
          }
        />
      </ol>

      <div>
        <Button size="lg" onClick={() => navigate("recordings")}>
          Go to recordings
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
