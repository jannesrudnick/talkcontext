"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { TranscriptSegment } from "@/lib/qa/types";

/* Die Web Speech API ist nicht in den TypeScript-DOM-Typen enthalten. */
interface SpeechRecognitionAlternativeLike {
  transcript: string;
  confidence: number;
}
interface SpeechRecognitionResultLike {
  readonly length: number;
  isFinal: boolean;
  [index: number]: SpeechRecognitionAlternativeLike;
}
interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: { readonly length: number; [index: number]: SpeechRecognitionResultLike };
}
interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: Event & { error?: string }) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognition(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const scope = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

const SERVER_SUPPORT = { audio: false, speech: false } as const;
let cachedSupport: { audio: boolean; speech: boolean } | null = null;

/** Stabiler Snapshot, damit useSyncExternalStore nicht dauernd neu rendert. */
function getSupport() {
  if (!cachedSupport) {
    cachedSupport = {
      audio: !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined",
      speech: !!getSpeechRecognition(),
    };
  }
  return cachedSupport;
}

const subscribeToNothing = () => () => {};

export interface NarrationState {
  supported: { audio: boolean; speech: boolean };
  active: boolean;
  transcript: TranscriptSegment[];
  interim: string;
  audioBlob: Blob | null;
  error: string | null;
}

/**
 * Nimmt die gesprochene Erklaerung auf: Audiospur via MediaRecorder und -
 * sofern der Browser sie hat - ein Live-Transkript via Web Speech API.
 * Das Transkript ist der Teil, den ein Agent spaeter wirklich lesen kann.
 */
export function useNarration(language: string) {
  const supported = useSyncExternalStore(subscribeToNothing, getSupport, () => SERVER_SUPPORT);
  const [active, setActive] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptSegment[]>([]);
  const [interim, setInterim] = useState("");
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const keepAliveRef = useRef(false);
  const startedAtRef = useRef<number>(0);
  const segmentStartRef = useRef<number | null>(null);
  const languageRef = useRef(language);

  useEffect(() => {
    languageRef.current = language;
  }, [language]);

  const startRecognition = useCallback(() => {
    const Recognition = getSpeechRecognition();
    if (!Recognition) return;
    const recognition = new Recognition();
    recognition.lang = languageRef.current;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      let interimText = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const text = result[0]?.transcript ?? "";
        if (segmentStartRef.current == null) {
          segmentStartRef.current = Date.now() - startedAtRef.current;
        }
        if (result.isFinal) {
          const start = segmentStartRef.current ?? Date.now() - startedAtRef.current;
          segmentStartRef.current = null;
          const trimmed = text.trim();
          if (trimmed) {
            setTranscript((previous) => [
              ...previous,
              { t: start, endT: Date.now() - startedAtRef.current, text: trimmed, final: true },
            ]);
          }
        } else {
          interimText += text;
        }
      }
      setInterim(interimText.trim());
    };

    recognition.onerror = (event) => {
      const code = event.error;
      // "no-speech" und "aborted" sind normale Zwischenzustaende.
      if (code && code !== "no-speech" && code !== "aborted") {
        setError(`Spracherkennung: ${code}`);
      }
    };

    // Chrome beendet die Erkennung nach Sprechpausen - neu starten.
    recognition.onend = () => {
      if (!keepAliveRef.current) return;
      try {
        recognition.start();
      } catch {
        /* Neustart zu frueh - naechstes onend versucht es erneut. */
      }
    };

    try {
      recognition.start();
      recognitionRef.current = recognition;
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "Spracherkennung nicht startbar");
    }
  }, []);

  const start = useCallback(
    async (startedAt: number) => {
      setError(null);
      setTranscript([]);
      setInterim("");
      setAudioBlob(null);
      chunksRef.current = [];
      startedAtRef.current = startedAt;
      segmentStartRef.current = null;

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = stream;
        const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find(
          (candidate) => MediaRecorder.isTypeSupported?.(candidate),
        );
        const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) chunksRef.current.push(event.data);
        };
        recorder.onstop = () => {
          setAudioBlob(new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" }));
        };
        recorder.start(1000);
        recorderRef.current = recorder;
      } catch (mediaError) {
        setError(
          mediaError instanceof Error
            ? `Mikrofon nicht verfuegbar: ${mediaError.message}`
            : "Mikrofon nicht verfuegbar",
        );
        return false;
      }

      keepAliveRef.current = true;
      startRecognition();
      setActive(true);
      return true;
    },
    [startRecognition],
  );

  const stop = useCallback(() => {
    keepAliveRef.current = false;
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setActive(false);
    setInterim("");
  }, []);

  useEffect(() => stop, [stop]);

  const addManualSegment = useCallback((text: string, t: number) => {
    setTranscript((previous) => [...previous, { t, endT: t, text, final: true }]);
  }, []);

  return { supported, active, transcript, interim, audioBlob, error, start, stop, addManualSegment };
}
