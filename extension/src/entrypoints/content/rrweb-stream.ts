/**
 * One rrweb recorder per tab, shared by the recording and the live view -
 * rrweb keeps global state, two `record()` calls at once would fight.
 * Every new listener gets a fresh Meta + FullSnapshot, so a recording that
 * starts while someone watches (or the other way round) starts complete.
 */
import { record, type eventWithTime } from "rrweb";
import type { Settings } from "@/lib/types";
import { OVERLAY_TAG } from "./controller";

type Listener = (event: eventWithTime) => void;

const listeners = new Set<Listener>();
let stop: (() => void) | undefined;

export function subscribeRrweb(settings: Settings, listener: Listener): () => void {
  listeners.add(listener);
  if (!stop) {
    // ponytail: options come from whoever starts the recorder; both pass the same settings.
    const blockSelector = [OVERLAY_TAG, settings.replay.blockSelector.trim()].filter(Boolean).join(",");
    stop = record({
      emit: (event) => {
        for (const fn of listeners) fn(event);
      },
      blockSelector,
      maskAllInputs: settings.replay.maskAllInputs,
      maskInputOptions: { password: true },
      recordCanvas: settings.replay.recordCanvas,
      inlineStylesheet: true,
      collectFonts: true,
      sampling: { mousemove: 50, scroll: 150, input: "last" },
      slimDOMOptions: { script: true, comment: true, headFavicon: true, headWhitespace: true },
    });
  } else {
    record.takeFullSnapshot(true);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size || !stop) return;
    stop();
    stop = undefined;
  };
}

/** Fresh Meta + FullSnapshot to every listener - for someone who just started watching. */
export function rrwebSnapshot() {
  if (stop) record.takeFullSnapshot(true);
}
