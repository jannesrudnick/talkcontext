"use client";

import { useCallback, useState } from "react";
import type { TranscriptSegment } from "@/lib/qa/types";

/** Price of whisper-1, for the cost estimate before sending. */
export const OPENAI_WHISPER_USD_PER_MINUTE = 0.006;

/**
 * Transcribes the audio track via OpenAI's whisper-1 - the only reason to send
 * it through /api/qa/transcribe instead of directly from the browser is the
 * missing CORS on api.openai.com. The key goes along as part of the single
 * request; our server stores it nowhere (see route.ts).
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
          setError((data && "error" in data && data.error) || "Transcription failed");
          return null;
        }
        return data.segments;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Network error");
        return null;
      } finally {
        setRunning(false);
      }
    },
    [],
  );

  return { transcribe, running, error };
}
