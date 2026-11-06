/**
 * Share a recording with someone else: one `.talkcontext` file (a ZIP) with every
 * track, the audio and the screenshots. Importing it adds the recording to the
 * recordings list as if it had been recorded locally.
 *
 *   recording.json          manifest: meta + all JSON tracks
 *   audio.<ext>             audio track (optional)
 *   screenshots/<id>.<ext>  screenshot images
 */
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from "fflate";
import { appendChunk, deleteRecording, getRecording, putRecording, readAudio, readLatestById, readTrack } from "./db";
import { newId } from "./settings";
import type { ChunkPayloads, RecordingMeta, Screenshot } from "./types";

export const SHARE_VERSION = "talkcontext-recording/1";
export const SHARE_EXTENSION = ".talkcontext";

const JSON_TRACKS = ["rrweb", "events", "effects", "cursor", "console", "network", "feedback", "strokes", "live"] as const;
type JsonTrack = (typeof JSON_TRACKS)[number];

interface Manifest {
  version: typeof SHARE_VERSION;
  exportedAt: number;
  meta: RecordingMeta;
  tracks: { [K in JsonTrack]: ChunkPayloads[K] };
  screenshots: Array<Omit<Screenshot, "blob"> & { file: string; type: string }>;
  audio?: { file: string };
}

const extensionOf = (type: string) => /^(?:image|audio)\/([a-z0-9]+)/i.exec(type)?.[1]?.replace("jpeg", "jpg") ?? "bin";

/** Pack a recording into a `.talkcontext` file. */
export async function packRecording(id: string): Promise<Blob> {
  const meta = await getRecording(id);
  if (!meta) throw new Error("Recording not found");

  const tracks = Object.fromEntries(
    await Promise.all(
      JSON_TRACKS.map(async (kind) => [kind, kind === "feedback" ? await readLatestById(id, kind) : await readTrack(id, kind)]),
    ),
  ) as Manifest["tracks"];
  const screenshots = await readTrack(id, "screenshots");
  const audio = meta.audio ? await readAudio(id, meta.audio.mimeType) : null;

  // Images and audio are already compressed - store them as they are.
  const files: Zippable = {};
  const manifest: Manifest = { version: SHARE_VERSION, exportedAt: Date.now(), meta, tracks, screenshots: [] };
  for (const { blob, ...shot } of screenshots) {
    const file = `screenshots/${shot.id}.${extensionOf(blob.type)}`;
    files[file] = [new Uint8Array(await blob.arrayBuffer()), { level: 0 }];
    manifest.screenshots.push({ ...shot, file, type: blob.type });
  }
  if (audio && meta.audio) {
    const file = `audio.${extensionOf(meta.audio.mimeType)}`;
    files[file] = [new Uint8Array(await audio.arrayBuffer()), { level: 0 }];
    manifest.audio = { file };
  }
  files["recording.json"] = [strToU8(JSON.stringify(manifest)), { level: 6 }];

  return new Blob([zipSync(files) as BlobPart], { type: "application/zip" });
}

/**
 * Import a `.talkcontext` file. The file comes from someone else - it is
 * checked for the expected shape, and gets a fresh id so it never overwrites
 * or mixes with an existing recording.
 */
export async function importRecording(file: Blob, by?: string): Promise<RecordingMeta> {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
  } catch {
    throw new Error("Not a TalkContext recording (no valid ZIP).");
  }
  const raw = entries["recording.json"];
  if (!raw) throw new Error("Not a TalkContext recording (recording.json missing).");

  let manifest: Manifest;
  try {
    manifest = JSON.parse(strFromU8(raw)) as Manifest;
  } catch {
    throw new Error("recording.json is not valid JSON.");
  }
  if (manifest?.version !== SHARE_VERSION) {
    throw new Error(`Unsupported format: ${String(manifest?.version)} (expected ${SHARE_VERSION}).`);
  }
  const { meta, tracks } = manifest;
  if (!meta || typeof meta.id !== "string" || typeof meta.startedAt !== "number" || !tracks || !Array.isArray(tracks.rrweb)) {
    throw new Error("recording.json is incomplete.");
  }

  const id = newId("rec_");
  try {
    return await writeImport(id, manifest, entries, by);
  } catch (error) {
    await deleteRecording(id).catch(() => undefined);
    throw error;
  }
}

async function writeImport(id: string, manifest: Manifest, entries: Record<string, Uint8Array>, by?: string): Promise<RecordingMeta> {
  const { meta, tracks } = manifest;
  for (const kind of JSON_TRACKS) {
    const data = tracks[kind];
    if (Array.isArray(data)) await appendChunk(id, kind, data as ChunkPayloads[typeof kind]);
  }

  const screenshots: Screenshot[] = [];
  for (const { file: path, type, ...shot } of Array.isArray(manifest.screenshots) ? manifest.screenshots : []) {
    const bytes = entries[path];
    if (bytes) screenshots.push({ ...shot, blob: new Blob([bytes as BlobPart], { type }) });
  }
  await appendChunk(id, "screenshots", screenshots);

  const audioBytes = manifest.audio && entries[manifest.audio.file];
  if (audioBytes && meta.audio) {
    await appendChunk(id, "audio", [new Blob([audioBytes as BlobPart], { type: meta.audio.mimeType })]);
  }

  const imported: RecordingMeta = {
    ...meta,
    id,
    status: "ready",
    sentAt: undefined,
    sharedAt: undefined,
    audio: audioBytes ? meta.audio : undefined,
    imported: { at: Date.now(), originalId: meta.id, by },
  };
  // Meta last: the recording only shows up once all tracks are written.
  await putRecording(imported);
  return imported;
}
