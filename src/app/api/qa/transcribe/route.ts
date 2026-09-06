/**
 * Reiner Durchreich-Endpoint zu OpenAIs Transkriptions-API.
 *
 * Der Grund, dass das ueberhaupt durch unseren Server muss: OpenAI setzt keine
 * CORS-Header auf api.openai.com, ein Browser kann den Key also nicht direkt
 * gegen die API schicken. Der Key kommt hier nur als Teil des einen Requests
 * an, wird an OpenAI weitergereicht und danach nirgends abgelegt - keine DB,
 * kein Log mit Body. Persistiert wird er ausschliesslich im Browser
 * (localStorage, siehe use-openai-key.ts).
 */
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// OpenAIs eigenes Limit fuer /v1/audio/transcriptions.
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
    return NextResponse.json({ error: "Ungueltiger Request-Body" }, { status: 400 });
  }

  const apiKey = form.get("apiKey");
  const language = form.get("language");
  const audio = form.get("audio");

  if (typeof apiKey !== "string" || !apiKey.trim()) {
    return NextResponse.json({ error: "API-Key fehlt" }, { status: 400 });
  }
  if (!(audio instanceof File) || audio.size === 0) {
    return NextResponse.json({ error: "Audio fehlt" }, { status: 400 });
  }
  if (audio.size > MAX_AUDIO_BYTES) {
    return NextResponse.json(
      { error: `Audio zu gross (${Math.round(audio.size / 1e6)} MB) - OpenAI erlaubt maximal 25 MB.` },
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
    // Kein Detail aus dem catch weiterreichen - koennte im schlimmsten Fall
    // Request-Interna enthalten, nie den Key.
    return NextResponse.json({ error: "OpenAI war nicht erreichbar" }, { status: 502 });
  }

  if (!response.ok) {
    let message = `OpenAI antwortete mit Status ${response.status}`;
    try {
      const body = (await response.json()) as { error?: { message?: string } };
      if (body.error?.message) message = body.error.message;
    } catch {
      // Antwort war kein JSON - generische Meldung behalten.
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
