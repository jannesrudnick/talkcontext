"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_RECORDER_CONFIG,
  type ControlMessage,
  type ElementRef,
  type FrameMessage,
  type QaEvent,
  type QaMode,
  type CursorSample,
  type RecorderConfig,
} from "@/lib/qa/types";

export type RecorderStatus = "idle" | "recording" | "stopped";

const MAX_EVENTS = 50_000;
const MAX_CURSOR_SAMPLES = 60_000;

interface UseRecorderOptions {
  frameRef: React.RefObject<HTMLIFrameElement | null>;
  mode: QaMode;
}

/**
 * Bindeglied zwischen Studio und dem Recorder im iframe: nimmt Events
 * entgegen, rechnet Zeitstempel auf den Sessionstart um und haelt den Zustand.
 */
export function useRecorder({ frameRef, mode }: UseRecorderOptions) {
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [events, setEvents] = useState<QaEvent[]>([]);
  const [cursor, setCursor] = useState<CursorSample[]>([]);
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [frameConnected, setFrameConnected] = useState(false);
  const [config, setConfigState] = useState<RecorderConfig>(DEFAULT_RECORDER_CONFIG);
  const [elapsed, setElapsed] = useState(0);
  const [lastTarget, setLastTarget] = useState<ElementRef | null>(null);

  const [startedAtMs, setStartedAtMs] = useState<number | null>(null);

  const startedAtRef = useRef<number | null>(null);
  const statusRef = useRef<RecorderStatus>("idle");
  const configRef = useRef(config);
  const lastUrlRef = useRef<string | null>(null);
  const localSeq = useRef(0);

  // Spiegel fuer die asynchronen postMessage-Handler, die ausserhalb des
  // Renders laufen und den jeweils aktuellen Stand brauchen.
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    configRef.current = config;
  }, [config]);

  const send = useCallback(
    (message: ControlMessage) => {
      const frame = frameRef.current?.contentWindow;
      if (!frame) return;
      frame.postMessage(message, "*");
    },
    [frameRef],
  );

  const relativeTime = useCallback((ts: number) => {
    const startedAt = startedAtRef.current;
    if (startedAt == null) return 0;
    return Math.max(0, ts - startedAt);
  }, []);

  const pushLocalEvent = useCallback(
    (event: Omit<QaEvent, "id" | "t" | "ts" | "url"> & { url?: string }) => {
      if (statusRef.current !== "recording") return;
      const ts = Date.now();
      localSeq.current += 1;
      setEvents((previous) => [
        ...previous,
        {
          id: `local-${ts.toString(36)}-${localSeq.current}`,
          t: relativeTime(ts),
          ts,
          url: event.url ?? lastUrlRef.current ?? "",
          type: event.type,
          target: event.target,
          detail: event.detail,
        },
      ]);
    },
    [relativeTime],
  );

  useEffect(() => {
    function onMessage(messageEvent: MessageEvent) {
      const frame = frameRef.current;
      if (!frame || messageEvent.source !== frame.contentWindow) return;
      const data = messageEvent.data as FrameMessage;
      if (!data || data.source !== "qa-recorder") return;

      if (data.type === "ready") {
        setFrameConnected(true);
        setFrameUrl(data.url);
        const previousUrl = lastUrlRef.current;
        lastUrlRef.current = data.url;
        send({ source: "qa-studio", type: "config", config: configRef.current });
        if (statusRef.current === "recording") {
          send({ source: "qa-studio", type: "start" });
          if (previousUrl && previousUrl !== data.url) {
            pushLocalEvent({
              type: "navigate",
              detail: { from: previousUrl, to: data.url, kind: "load" },
              url: data.url,
            });
          }
        }
        return;
      }

      if (data.type === "events") {
        if (statusRef.current !== "recording") return;
        const mapped = data.events.map((raw) => ({
          id: raw.id,
          t: relativeTime(raw.ts),
          ts: raw.ts,
          type: raw.type,
          url: raw.url,
          target: raw.target,
          detail: raw.detail,
        }));
        for (const event of mapped) {
          if (event.url) lastUrlRef.current = event.url;
          if (event.target && (event.type === "hover" || event.type === "click")) {
            setLastTarget(event.target);
          }
        }
        const latestUrl = mapped[mapped.length - 1]?.url;
        if (latestUrl) setFrameUrl(latestUrl);
        setEvents((previous) => {
          const next = previous.concat(mapped);
          return next.length > MAX_EVENTS ? next.slice(next.length - MAX_EVENTS) : next;
        });
        return;
      }

      if (data.type === "cursor") {
        if (statusRef.current !== "recording") return;
        const samples = data.samples.map((sample) => ({
          t: relativeTime(sample.ts),
          x: sample.x,
          y: sample.y,
        }));
        setCursor((previous) => {
          const next = previous.concat(samples);
          return next.length > MAX_CURSOR_SAMPLES ? next.slice(next.length - MAX_CURSOR_SAMPLES) : next;
        });
        return;
      }

      if (data.type === "preview") {
        if (data.target) setLastTarget(data.target);
        return;
      }

      if (data.type === "effect") {
        setEvents((previous) =>
          previous.map((event) => (event.id === data.id ? { ...event, effect: data.effect } : event)),
        );
      }
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [frameRef, pushLocalEvent, relativeTime, send]);

  useEffect(() => {
    if (status !== "recording") return;
    const interval = window.setInterval(() => {
      if (startedAtRef.current != null) setElapsed(Date.now() - startedAtRef.current);
    }, 200);
    return () => window.clearInterval(interval);
  }, [status]);

  const start = useCallback(() => {
    startedAtRef.current = Date.now();
    setStartedAtMs(startedAtRef.current);
    localSeq.current = 0;
    setEvents([]);
    setCursor([]);
    setElapsed(0);
    setStatus("recording");
    statusRef.current = "recording";
    send({ source: "qa-studio", type: "config", config: configRef.current });
    send({ source: "qa-studio", type: "start" });
    // Startpunkt explizit protokollieren, damit die Timeline mit der Seite beginnt.
    pushLocalEvent({
      type: "navigate",
      detail: { to: lastUrlRef.current, kind: "start" },
      url: lastUrlRef.current ?? undefined,
    });
    return startedAtRef.current;
  }, [pushLocalEvent, send]);

  const stop = useCallback(() => {
    send({ source: "qa-studio", type: "stop" });
    setStatus("stopped");
    statusRef.current = "stopped";
    if (startedAtRef.current != null) setElapsed(Date.now() - startedAtRef.current);
  }, [send]);

  const reset = useCallback(() => {
    startedAtRef.current = null;
    setStartedAtMs(null);
    setStatus("idle");
    statusRef.current = "idle";
    setEvents([]);
    setCursor([]);
    setElapsed(0);
  }, []);

  const addNote = useCallback(
    (text: string) => {
      pushLocalEvent({ type: "note", detail: { text }, target: lastTarget ?? undefined });
    },
    [lastTarget, pushLocalEvent],
  );

  const setConfig = useCallback(
    (partial: Partial<RecorderConfig>) => {
      const next = { ...configRef.current, ...partial };
      configRef.current = next;
      setConfigState(next);
      send({ source: "qa-studio", type: "config", config: next });
    },
    [send],
  );

  const highlight = useCallback(
    (selector: string | null) => {
      send({ source: "qa-studio", type: "highlight", selector });
    },
    [send],
  );

  const markFrameDisconnected = useCallback(() => {
    setFrameConnected(false);
  }, []);

  return {
    status,
    mode,
    events,
    cursor,
    elapsed,
    frameUrl,
    frameConnected,
    config,
    lastTarget,
    startedAtMs,
    start,
    stop,
    reset,
    addNote,
    setConfig,
    highlight,
    markFrameDisconnected,
  };
}
