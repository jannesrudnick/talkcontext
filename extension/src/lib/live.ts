/**
 * Team presence + live view over Supabase Realtime (private channels, members
 * only - supabase/setup.sql §5).
 *
 *  - `talkcontext:team`: everyone with the overlay open. Public members also
 *    share their page. Join requests and replies are broadcast here.
 *  - `talkcontext:live:<host tab>`: the host's rrweb events, while approved
 *    viewers are present. The viewer replays them - no login to the app needed.
 *
 * ponytail: approval is consent, not access control - any member could listen
 * on a live topic. Per-viewer RLS would need an approvals table; add it if the
 * team key is shared beyond people you trust with what you see.
 */
import { gunzipSync, gzipSync, strFromU8, strToU8 } from "fflate";
import type { RealtimeChannel } from "@supabase/supabase-js";

export const TEAM_TOPIC = "talkcontext:team";
export const liveTopic = (hostKey: string) => `talkcontext:live:${hostKey}`;

export interface Peer {
  /** Tab key - stable across reloads of that tab. */
  key: string;
  userId: string;
  name: string;
  feature: string;
  public: boolean;
  /** Only when public. */
  url?: string;
  page?: string;
  title?: string;
  since: number;
}

export interface JoinRequest {
  /** Host tab key. */
  to: string;
  /** Viewer key. */
  from: string;
  userId: string;
  name: string;
}

export interface JoinReply {
  to: string;
  ok: boolean;
}

/** Latest entry per presence key. */
export function peersOf(channel: RealtimeChannel): Peer[] {
  return Object.values(channel.presenceState<Peer>()).flatMap((metas) => metas.slice(-1));
}

/* ----------------------------------------------------------- Event stream */

// Broadcast payloads are capped (256 KB on the free plan); a full snapshot is often bigger.
const PART = 180_000;

interface Part {
  id: string;
  i: number;
  n: number;
  part: string;
}

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function fromBase64(text: string) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Gzip, then split into broadcast-sized parts. */
export async function sendEvents(channel: RealtimeChannel, events: unknown[]) {
  const packed = toBase64(gzipSync(strToU8(JSON.stringify(events))));
  const id = crypto.randomUUID();
  const n = Math.ceil(packed.length / PART);
  for (let i = 0; i < n; i++) {
    const payload: Part = { id, i, n, part: packed.slice(i * PART, (i + 1) * PART) };
    await channel.send({ type: "broadcast", event: "events", payload });
  }
}

/** Reassembles parts from sendEvents. */
export function eventReceiver<T>(onEvents: (events: T[]) => void) {
  const pending = new Map<string, string[]>();
  return (payload: unknown) => {
    const { id, i, n, part } = payload as Part;
    const parts = pending.get(id) ?? [];
    parts[i] = part;
    pending.set(id, parts);
    if (parts.filter(Boolean).length < n) return;
    pending.delete(id);
    onEvents(JSON.parse(strFromU8(gunzipSync(fromBase64(parts.join(""))))) as T[]);
  };
}
