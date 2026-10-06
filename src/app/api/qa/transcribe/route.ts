/**
 * Pure pass-through endpoint to OpenAI's transcription API.
 *
 * Why this has to go through our server at all: OpenAI sets no CORS headers
 * on api.openai.com, so a browser cannot send the key to the API directly.
 * The key arrives here only as part of the single request, is passed on to
 * OpenAI and stored nowhere afterwards - no DB, no log with the body. It is
 * persisted exclusively in the browser (localStorage, see use-openai-key.ts).
 */
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// OpenAI's own limit for /v1/audio/transcriptions.
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

interface OpenAiTranscriptionSegment {
  start: number;
  end: number;
  text: string;
}

interface OpenAiTranscriptionResponse {
  segments?: OpenAiTranscriptionSegment[];
  text?: string;
}

export async function POST(request: NextRequest) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const apiKey = form.get("apiKey");
  const language = form.get("language");
  const audio = form.get("audio");

  if (typeof apiKey !== "string" || !apiKey.trim()) {
    return NextResponse.json({ error: "API key missing" }, { status: 400 });
  }
  if (!(audio instanceof File) || audio.size === 0) {
    return NextResponse.json({ error: "Audio missing" }, { status: 400 });
  }
  if (audio.size > MAX_AUDIO_BYTES) {
    return NextResponse.json(
      { error: `Audio too large (${Math.round(audio.size / 1e6)} MB) - OpenAI allows at most 25 MB.` },
      { status: 413 },
    );
  }

  const upstream = new FormData();
  upstream.set("file", audio, "audio.webm");
  upstream.set("model", "whisper-1");
  upstream.set("response_format", "verbose_json");
  if (typeof language === "string" && language.trim()) {
    upstream.set("language", language.trim());
  }

  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: upstream,
      signal: AbortSignal.timeout(120_000),
    });
  } catch {
    // Don't pass on any detail from the catch - worst case it could contain
    // request internals, never the key.
    return NextResponse.json({ error: "OpenAI was unreachable" }, { status: 502 });
  }

  if (!response.ok) {
    let message = `OpenAI responded with status ${response.status}`;
    try {
      const body = (await response.json()) as { error?: { message?: string } };
      if (body.error?.message) message = body.error.message;
    } catch {
      // Response was not JSON - keep the generic message.
    }
    return NextResponse.json({ error: message }, { status: response.status });
  }

  const data = (await response.json()) as OpenAiTranscriptionResponse;
  const segments = (data.segments ?? []).map((segment) => ({
    t: Math.round(segment.start * 1000),
    endT: Math.round(segment.end * 1000),
    text: segment.text.trim(),
    final: true as const,
  }));

  return NextResponse.json({ segments });
}
