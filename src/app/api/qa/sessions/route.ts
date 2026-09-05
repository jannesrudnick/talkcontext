/**
 * Speichert eine Aufnahme als Datei-Paar (JSON + Markdown) im Projektordner
 * `qa-sessions/`, damit ein Agent sie direkt vom Dateisystem lesen kann.
 */
import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { buildMarkdown, sessionFileBase } from "@/lib/qa/export";
import type { QaSession } from "@/lib/qa/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OUTPUT_DIR = path.join(process.cwd(), "qa-sessions");

export async function GET() {
  try {
    const entries = await readdir(OUTPUT_DIR);
    return NextResponse.json({ dir: OUTPUT_DIR, files: entries.filter((name) => name.endsWith(".json")).sort() });
  } catch {
    return NextResponse.json({ dir: OUTPUT_DIR, files: [] });
  }
}

export async function POST(request: NextRequest) {
  let session: QaSession;
  try {
    session = (await request.json()) as QaSession;
  } catch {
    return NextResponse.json({ error: "Ungueltiges JSON" }, { status: 400 });
  }

  if (session?.version !== "qa-recording/1" || !Array.isArray(session.events)) {
    return NextResponse.json({ error: "Kein gueltiges QA-Recording" }, { status: 400 });
  }

  const base = sessionFileBase(session).replace(/[^a-z0-9._-]/gi, "-");
  await mkdir(OUTPUT_DIR, { recursive: true });
  const jsonPath = path.join(OUTPUT_DIR, `${base}.json`);
  const markdownPath = path.join(OUTPUT_DIR, `${base}.md`);

  await writeFile(jsonPath, JSON.stringify(session, null, 2), "utf8");
  await writeFile(markdownPath, buildMarkdown(session), "utf8");

  return NextResponse.json({ json: jsonPath, markdown: markdownPath });
}
