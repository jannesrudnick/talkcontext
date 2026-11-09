/**
 * Watch a public teammate's tab live: ask to join, wait for their approval,
 * then replay their rrweb stream (protocol: lib/live.ts). Shows exactly what
 * they see without being signed in to their app.
 */
import { useEffect, useRef, useState } from "react";
import { Replayer, type eventWithTime } from "rrweb";
import "rrweb/dist/style.css";
import { Loader2Icon, MonitorPlayIcon, RotateCcwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { eventReceiver, liveTopic, peersOf, TEAM_TOPIC, type JoinReply, type JoinRequest, type Peer } from "@/lib/live";
import { NotSignedIn } from "@/features/comments/not-signed-in";
import { useTeam } from "@/features/comments/use-team";

type Phase = "connecting" | "waiting" | "declined" | "live" | "ended";

/** Same key for this host across reloads of this tab, so an approval survives a reload. */
function viewerKey(hostKey: string) {
  const name = `talkcontext-viewer-${hostKey}`;
  try {
    const existing = sessionStorage.getItem(name);
    if (existing) return existing;
    const key = crypto.randomUUID();
    sessionStorage.setItem(name, key);
    return key;
  } catch {
    return crypto.randomUUID();
  }
}

export function LivePage({ hostKey }: { hostKey: string }) {
  const { settings, session, client, loaded } = useTeam();
  const [phase, setPhase] = useState<Phase>("connecting");
  const [host, setHost] = useState<Peer | undefined>();
  const [viewport, setViewport] = useState<{ width: number; height: number } | null>(null);
  const [scale, setScale] = useState(1);
  const stageRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const name = settings.team.name.trim();
  const userId = session?.user.id;

  useEffect(() => {
    if (!client || !userId) return;
    const me = viewerKey(hostKey);
    let replayer: Replayer | null = null;
    let live: ReturnType<typeof client.channel> | null = null;
    let current: Phase = "connecting";
    const set = (next: Phase) => {
      current = next;
      setPhase(next);
    };

    const team = client.channel(TEAM_TOPIC, { config: { private: true } });
    const ask = () => {
      const payload: JoinRequest = { to: hostKey, from: me, userId, name };
      void team.send({ type: "broadcast", event: "join-request", payload });
    };

    const watch = () => {
      if (live || !mountRef.current) return;
      set("live");
      mountRef.current.innerHTML = "";
      const player = new Replayer([], {
        root: mountRef.current,
        liveMode: true,
        showWarning: false,
        triggerFocus: false,
        mouseTail: { strokeStyle: "rgba(124, 92, 255, 0.55)", lineWidth: 2, duration: 600 },
        // See player.tsx: undo Chrome's extension-page font defaults inside the replay.
        insertStyleRules: ["body { font-size: inherit; font-family: inherit; }"],
      });
      replayer = player;
      player.on("resize", (size) => setViewport(size as { width: number; height: number }));
      let started = false;
      const receive = eventReceiver<eventWithTime>((events) => {
        for (const event of events) {
          // Incremental events before the first snapshot have nothing to apply to.
          if (!started && event.type !== 4) continue;
          if (!started) {
            started = true;
            // 1 s buffer absorbs clock skew between the machines and network jitter.
            player.startLive(event.timestamp - 1000);
          }
          player.addEvent(event);
        }
      });
      const channel = client.channel(liveTopic(hostKey), { config: { private: true, presence: { key: me } } });
      live = channel;
      channel
        .on("broadcast", { event: "events" }, ({ payload }) => receive(payload))
        .on("broadcast", { event: "end" }, () => set("ended"))
        .subscribe((status) => {
          if (status === "SUBSCRIBED") void channel.track({ name });
        });
    };

    team
      .on("presence", { event: "sync" }, () => {
        const found = peersOf(team).find((peer) => peer.key === hostKey);
        setHost(found);
        // Host (re)appeared while we wait - their tab may have missed the request.
        if (found && current === "waiting") ask();
      })
      .on("broadcast", { event: "join-reply" }, ({ payload }) => {
        const answer = payload as JoinReply;
        if (answer.to !== me) return;
        if (answer.ok) watch();
        else if (current !== "live") set("declined");
      })
      .subscribe((status) => {
        if (status !== "SUBSCRIBED" || current !== "connecting") return;
        set("waiting");
        ask();
      });

    return () => {
      void client.removeChannel(team);
      if (live) void client.removeChannel(live);
      replayer?.destroy();
    };
  }, [client, userId, hostKey, name]);

  // Fit the host's viewport into the stage.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !viewport) return;
    const update = () =>
      setScale(Math.max(0.1, Math.min((stage.clientWidth - 32) / viewport.width, (stage.clientHeight - 32) / viewport.height, 1)));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [viewport]);

  if (loaded && session === null) {
    return (
      <div className="mx-auto w-full max-w-5xl px-8 py-8">
        <NotSignedIn what="Live views run" />
      </div>
    );
  }

  const who = host?.name ?? "your teammate";
  const status: Record<Exclude<Phase, "live">, { title: string; text: string }> = {
    connecting: { title: "Connecting…", text: "Joining your team's live channel." },
    waiting: {
      title: host ? `Waiting for ${who} to allow it` : "Waiting for them to come online",
      text: host ? `${who} sees a request and decides. This tab starts as soon as they allow it.` : "They need the overlay open and to be public.",
    },
    declined: { title: `${who} declined`, text: "Nothing is shared. You can ask again." },
    ended: { title: "Live view ended", text: `${who} stopped sharing or closed the overlay.` },
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 px-6 py-5">
      <header className="flex items-center gap-2">
        <MonitorPlayIcon className="size-5 text-muted-foreground" />
        <h1 className="text-lg font-semibold tracking-tight">{phase === "live" ? `Watching ${who}` : "Live view"}</h1>
        {phase === "live" && <span className="rounded-full bg-red-500/15 px-2 text-xs leading-5 font-medium text-red-600 dark:text-red-300">LIVE</span>}
        {host?.url && (
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground" title={host.url}>
            {host.title ? `${host.title} · ` : ""}
            {host.url}
          </span>
        )}
      </header>
      <div
        ref={stageRef}
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-xl border bg-[radial-gradient(circle_at_1px_1px,var(--border)_1px,transparent_0)] [background-size:16px_16px]"
      >
        <div
          className="relative overflow-hidden rounded-md bg-white shadow-2xl ring-1 ring-black/10"
          style={phase === "live" && viewport ? { width: viewport.width * scale, height: viewport.height * scale } : { display: "none" }}
        >
          <div
            ref={mountRef}
            className="talkcontext-replay absolute top-0 left-0 origin-top-left"
            style={{ transform: `scale(${scale})`, width: viewport?.width, height: viewport?.height }}
          />
        </div>
        {phase !== "live" && (
          <Empty className="py-16">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                {phase === "connecting" || phase === "waiting" ? <Loader2Icon className="animate-spin" /> : <MonitorPlayIcon />}
              </EmptyMedia>
              <EmptyTitle>{status[phase].title}</EmptyTitle>
              <EmptyDescription>{status[phase].text}</EmptyDescription>
            </EmptyHeader>
            {(phase === "declined" || phase === "ended") && (
              <EmptyContent>
                <Button variant="outline" onClick={() => location.reload()}>
                  <RotateCcwIcon />
                  Ask again
                </Button>
              </EmptyContent>
            )}
          </Empty>
        )}
        {phase === "live" && !viewport && <Loader2Icon className="size-5 animate-spin text-muted-foreground" />}
      </div>
    </div>
  );
}
