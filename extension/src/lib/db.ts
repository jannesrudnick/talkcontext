/**
 * Persistenz aller Aufnahmen in IndexedDB der Extension-Origin.
 *
 * Background, Offscreen-Dokument und die Aufnahmen-Seite teilen sich diese
 * Origin und damit dieselbe Datenbank. Jede Spur wird in Stuecken geschrieben,
 * sobald sie anfaellt - stirbt der Service Worker oder der Browser, ist nur
 * die letzte Sekunde verloren, nicht die Aufnahme.
 */
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { ChunkKind, ChunkPayloads, RecordingMeta } from "./types";

interface ChunkRecord<K extends ChunkKind = ChunkKind> {
  key?: number;
  recordingId: string;
  kind: K;
  ts: number;
  data: ChunkPayloads[K];
}

interface QeyDb extends DBSchema {
  recordings: {
    key: string;
    value: RecordingMeta;
    indexes: { startedAt: number };
  };
  chunks: {
    key: number;
    value: ChunkRecord;
    indexes: { recording: string; recordingKind: [string, string] };
  };
}

let dbPromise: Promise<IDBPDatabase<QeyDb>> | null = null;

export function db(): Promise<IDBPDatabase<QeyDb>> {
  dbPromise ??= openDB<QeyDb>("qey", 1, {
    upgrade(database) {
      const recordings = database.createObjectStore("recordings", { keyPath: "id" });
      recordings.createIndex("startedAt", "startedAt");
      const chunks = database.createObjectStore("chunks", { keyPath: "key", autoIncrement: true });
      chunks.createIndex("recording", "recordingId");
      chunks.createIndex("recordingKind", ["recordingId", "kind"]);
    },
  });
  return dbPromise;
}

export async function putRecording(meta: RecordingMeta): Promise<void> {
  await (await db()).put("recordings", meta);
}

export async function getRecording(id: string): Promise<RecordingMeta | undefined> {
  return (await db()).get("recordings", id);
}

export async function updateRecording(
  id: string,
  update: (meta: RecordingMeta) => RecordingMeta,
): Promise<RecordingMeta | undefined> {
  const database = await db();
  const tx = database.transaction("recordings", "readwrite");
  const current = await tx.store.get(id);
  if (!current) {
    await tx.done;
    return undefined;
  }
  const next = update(current);
  await tx.store.put(next);
  await tx.done;
  return next;
}

export async function listRecordings(): Promise<RecordingMeta[]> {
  const all = await (await db()).getAllFromIndex("recordings", "startedAt");
  return all.reverse();
}

export async function deleteRecording(id: string): Promise<void> {
  const database = await db();
  const tx = database.transaction(["recordings", "chunks"], "readwrite");
  await tx.objectStore("recordings").delete(id);
  const index = tx.objectStore("chunks").index("recording");
  let cursor = await index.openKeyCursor(IDBKeyRange.only(id));
  while (cursor) {
    await tx.objectStore("chunks").delete(cursor.primaryKey);
    cursor = await cursor.continue();
  }
  await tx.done;
}

export async function appendChunk<K extends ChunkKind>(
  recordingId: string,
  kind: K,
  data: ChunkPayloads[K],
): Promise<void> {
  if (!data.length) return;
  await (await db()).add("chunks", { recordingId, kind, ts: Date.now(), data } as ChunkRecord);
}

/** Alle Stuecke einer Spur in Schreibreihenfolge zusammengefuegt. */
export async function readTrack<K extends ChunkKind>(recordingId: string, kind: K): Promise<ChunkPayloads[K]> {
  const records = await (await db()).getAllFromIndex("chunks", "recordingKind", [recordingId, kind]);
  records.sort((a, b) => (a.key ?? 0) - (b.key ?? 0));
  return records.flatMap((record) => record.data as unknown[]) as ChunkPayloads[K];
}

export async function readAudio(recordingId: string, mimeType: string): Promise<Blob | null> {
  const parts = await readTrack(recordingId, "audio");
  return parts.length ? new Blob(parts, { type: mimeType }) : null;
}

export async function estimateUsage(): Promise<{ usage: number; quota: number } | null> {
  if (!navigator.storage?.estimate) return null;
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  return { usage, quota };
}
