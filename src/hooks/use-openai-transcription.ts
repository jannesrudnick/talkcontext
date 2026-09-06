"use client";

import { useCallback, useState } from "react";
import type { TranscriptSegment } from "@/lib/qa/types";

/** Preis von whisper-1, fuer die Kostenschaetzung vor dem Absenden. */
export const OPENAI_WHISPER_USD_PER_MINUTE = 0.006;

/**
 * Transkribiert die Tonspur ueber OpenAIs whisper-1 - der einzige Grund, das
 * ganze durch /api/qa/transcribe statt direkt vom Browser zu schicken, ist
 * fehlendes CORS auf api.openai.com. Der Key geht als Teil des einen Requests
 * mit, unser Server legt ihn nirgends ab (siehe route.ts).
 */
export function useOpenAiTranscription() {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const transcribe = useCallback(
    async (audio: Blob, apiKey: string, language: string): Promise<TranscriptSegment[] | null> => {
      setError(null);
      setRunning(true);
      try {
        const form = new FormData();
        form.set("apiKey", apiKey);
        form.set("language", language.split("-")[0]);
        form.set("audio", audio, "audio.webm");

        const response = await fetch("/api/qa/transcribe", { method: "POST", body: form });
        const data = (await response.json().catch(() => null)) as
          | { segments: TranscriptSegment[] }
          | { error: string }
          | null;

        if (!response.ok || !data || "error" in data) {
          setError((data && "error" in data && data.error) || "Transkription fehlgeschlagen");
          return null;
        }
        return data.segments;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Netzwerkfehler");
        return null;
      } finally {
        setRunning(false);
      }
    },
    [],
  );

  return { transcribe, running, error };
}
