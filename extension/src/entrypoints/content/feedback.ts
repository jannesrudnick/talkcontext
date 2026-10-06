/**
 * Feedback points: explicit findings instead of guessed assignment.
 *
 * A point is created by right-clicking an element or with the pen.
 * While it is active, everything said (live
 * transcript), typed and drawn belongs to it. Each point gets a
 * screenshot, the component chain (React/Vue), computed styles and a
 * DOM snippet - enough context for an agent to get going without follow-up questions.
 */
import type { LiveTextEvent } from "@/lib/messages";
import { describe, meaningful } from "@/lib/recorder/describe";
import { newId } from "@/lib/settings";
import type { ComponentInfo, FeedbackItem, Screenshot, Stroke } from "@/lib/types";
import { request } from "./api";
import { createStore } from "./store";

export interface Caption {
  id: string;
  text: string;
  /** Which point the sentence was counted towards. */
  feedback: string | null;
  at: number;
}

export interface FeedbackState {
  active: FeedbackItem | null;
  /** Current, not yet final sentence from the live transcript. */
  partial: string;
  captions: Caption[];
  pen: boolean;
  penColor: string;
  /** Visible strokes (active point and not yet assigned ones). */
  strokes: Stroke[];
  /** Our own UI is hidden while a screenshot is taken. */
  capturing: boolean;
}

export const feedbackStore = createStore<FeedbackState>(() => ({
  active: null,
  partial: "",
  captions: [],
  pen: false,
  penColor: "#ef4444",
  strokes: [],
  capturing: false,
}));

export interface FeedbackDeps {
  save: (item: FeedbackItem) => void;
  saveStrokes: (strokes: Stroke[]) => void;
  /** Write a note to the semantic log (for the timeline). */
  logNote: (item: FeedbackItem) => void;
  probeComponent: (el: Element) => Promise<ComponentInfo | null>;
  captureHtml: boolean;
  isOwn: (node: EventTarget | Node | null) => boolean;
}

const STYLE_PROPS = [
  "display",
  "position",
  "width",
  "height",
  "margin",
  "padding",
  "gap",
  "flex-direction",
  "justify-content",
  "align-items",
  "grid-template-columns",
  "font-family",
  "font-size",
  "font-weight",
  "line-height",
  "color",
  "background-color",
  "border",
  "border-radius",
  "box-shadow",
  "opacity",
  "overflow",
  "white-space",
  "text-overflow",
  "z-index",
  "cursor",
];

const DEFAULTISH = new Set(["none", "normal", "auto", "0px", "visible", "static", "rgba(0, 0, 0, 0)", "1", "0px none rgb(0, 0, 0)"]);

/** Values that only mean something in certain layouts. */
const ONLY_IF: Record<string, (computed: CSSStyleDeclaration) => boolean> = {
  "flex-direction": (c) => c.display.includes("flex"),
  "justify-content": (c) => c.display.includes("flex") || c.display.includes("grid"),
  "align-items": (c) => c.display.includes("flex") || c.display.includes("grid"),
  gap: (c) => c.display.includes("flex") || c.display.includes("grid"),
  "grid-template-columns": (c) => c.display.includes("grid"),
  "text-overflow": (c) => c.textOverflow === "ellipsis",
  "white-space": (c) => c.whiteSpace !== "normal",
  border: (c) => !c.border.startsWith("0px"),
};

function stylesOf(el: Element): Record<string, string> {
  const computed = getComputedStyle(el);
  const styles: Record<string, string> = {};
  for (const prop of STYLE_PROPS) {
    const value = computed.getPropertyValue(prop).trim();
    if (!value || DEFAULTISH.has(value)) continue;
    if (ONLY_IF[prop] && !ONLY_IF[prop](computed)) continue;
    styles[prop] = value.length > 120 ? `${value.slice(0, 120)}…` : value;
  }
  // Clipped content is one of the most common layout findings.
  if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) {
    styles["(overflow)"] = `content ${el.scrollWidth}×${el.scrollHeight} > visible ${el.clientWidth}×${el.clientHeight}`;
  }
  return styles;
}

const CONTAINER = "form,section,article,dialog,[role=dialog],main,nav,header,footer,li,tr,[class*=card]";

/** DOM snippet around the element, with the target marked by `data-talkcontext-target`. */
function domSnippet(el: Element): string {
  let container = el.closest(CONTAINER) ?? el.parentElement?.parentElement ?? el;
  if (container === document.body || container === document.documentElement) container = el.parentElement ?? el;

  // Remember the path from container to target to mark the clone - the original stays untouched.
  const path: number[] = [];
  for (let node: Element | null = el; node && node !== container; node = node.parentElement) {
    if (!node.parentElement) break;
    path.unshift(Array.prototype.indexOf.call(node.parentElement.children, node));
  }
  const clone = container.cloneNode(true) as Element;
  let target: Element | undefined = clone;
  for (const index of path) target = target?.children[index];
  target?.setAttribute("data-talkcontext-target", "");

  clone.querySelectorAll("script,style,noscript,template").forEach((node) => node.remove());
  clone.querySelectorAll("svg").forEach((svg) => {
    svg.innerHTML = "";
  });
  clone.querySelectorAll('input[type="password"]').forEach((input) => input.setAttribute("value", "***"));
  const html = clone.outerHTML.replace(/\s{2,}/g, " ");
  return html.length > 12000 ? `${html.slice(0, 12000)}…` : html;
}

function iou(a: DOMRect, b: { x: number; y: number; w: number; h: number }) {
  const x1 = Math.max(a.left, b.x);
  const y1 = Math.max(a.top, b.y);
  const x2 = Math.min(a.right, b.x + b.w);
  const y2 = Math.min(a.bottom, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.width * a.height + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

export class FeedbackManager {
  private saveTimer: number | undefined;
  private strokeTimer: number | undefined;
  private pendingStrokes: Stroke[] = [];
  private lastClosed: FeedbackItem | null = null;
  private liveItemId = "";
  /** Sentences without a point - collected on the next right-click. */
  private loose: Array<{ text: string; at: number }> = [];

  constructor(private deps: FeedbackDeps) {}

  get active() {
    return feedbackStore.getState().active;
  }

  /* ------------------------------------------------------------ Lifecycle */

  async begin(
    el: Element | null,
    source: FeedbackItem["source"],
    options: { text?: string; screenshot?: boolean } = {},
  ): Promise<FeedbackItem> {
    this.close();
    const index = await request<number>({ type: "talkcontext:next-feedback-index" }).catch(() => 1);
    const item: FeedbackItem = {
      id: newId("fb_"),
      index,
      source,
      url: location.href,
      pageTitle: document.title,
      activeFrom: Date.now(),
      target: el ? describe(el, { captureHtml: this.deps.captureHtml }) : undefined,
      text: options.text ?? "",
      speech: this.takeLoose(),
      screenshotIds: [],
      strokeIds: [],
    };
    if (el) {
      item.styles = stylesOf(el);
      item.dom = domSnippet(el);
    }
    this.setActive(item);
    this.save(true);

    if (el) {
      void this.deps.probeComponent(el).then((component) => {
        if (component && this.active?.id === item.id) this.update({ component });
      });
    }
    if (options.screenshot !== false) void this.screenshot("feedback");
    return item;
  }

  /** Recently said speech not yet tied to a point (talk, then right-click). */
  private takeLoose() {
    const recent = this.loose.filter((entry) => Date.now() - entry.at < 10000).map((entry) => entry.text);
    this.loose = [];
    return recent;
  }

  close() {
    if (!this.active) return;
    this.attachPendingStrokes();
    const item = this.active;
    const closed = { ...item, activeTo: Date.now() };
    this.setActive(null);
    this.deps.save(closed);
    this.deps.logNote(closed);
    this.lastClosed = closed;
    feedbackStore.setState({ strokes: [] });
  }

  discard() {
    const item = this.active;
    if (!item) return;
    this.deps.save({ ...item, activeTo: Date.now(), discarded: true });
    this.setActive(null);
    feedbackStore.setState({ strokes: [] });
  }

  setText(text: string) {
    this.update({ text });
  }

  /** On navigation or stop: close everything still open. */
  finish() {
    this.close();
    window.clearTimeout(this.saveTimer);
  }

  /* --------------------------------------------------------------- Speech */

  onLive(event: LiveTextEvent) {
    if (event.kind === "delta") {
      if (event.itemId !== this.liveItemId) {
        this.liveItemId = event.itemId;
        feedbackStore.setState({ partial: "" });
      }
      feedbackStore.setState({ partial: feedbackStore.getState().partial + event.delta });
      return;
    }

    feedbackStore.setState({ partial: "" });
    if (!event.text) return;

    // To the active point, or to the one just closed if the sentence
    // started while it was still active.
    let target: FeedbackItem | null = null;
    const active = this.active;
    if (active && event.end >= active.activeFrom - 1500) target = active;
    else if (this.lastClosed?.activeTo && event.start <= this.lastClosed.activeTo) target = this.lastClosed;

    if (target === active && active) {
      this.update({ speech: [...active.speech, event.text] });
    } else if (target && this.lastClosed) {
      this.lastClosed = { ...this.lastClosed, speech: [...this.lastClosed.speech, event.text] };
      this.deps.save(this.lastClosed);
    }

    if (!target) this.loose.push({ text: event.text, at: Date.now() });

    const captions = [
      ...feedbackStore.getState().captions,
      { id: event.itemId, text: event.text, feedback: target ? `F${target.index}` : null, at: Date.now() },
    ].slice(-3);
    feedbackStore.setState({ captions });
  }

  /* ------------------------------------------------------------------ Pen */

  togglePen(on?: boolean) {
    const pen = on ?? !feedbackStore.getState().pen;
    if (!pen) this.flushStrokes();
    feedbackStore.setState({ pen });
  }

  setPenColor(penColor: string) {
    feedbackStore.setState({ penColor });
  }

  /** A stroke is done - wait briefly in case more belong to the same marking. */
  addStroke(stroke: Omit<Stroke, "feedbackId">) {
    const pending = { ...stroke, feedbackId: this.active?.id ?? "" };
    this.pendingStrokes.push(pending);
    feedbackStore.setState({ strokes: [...feedbackStore.getState().strokes, pending] });
    window.clearTimeout(this.strokeTimer);
    this.strokeTimer = window.setTimeout(() => void this.commitStrokes(), 700);
  }

  private flushStrokes() {
    if (!this.pendingStrokes.length) return;
    window.clearTimeout(this.strokeTimer);
    void this.commitStrokes();
  }

  /** Attach pending strokes to the active point directly, without a screenshot. */
  private attachPendingStrokes() {
    const item = this.active;
    if (!item || !this.pendingStrokes.length) return;
    window.clearTimeout(this.strokeTimer);
    const attached = this.pendingStrokes.splice(0).map((stroke) => ({ ...stroke, feedbackId: item.id }));
    this.deps.saveStrokes(attached);
    this.setActive({ ...item, strokeIds: [...item.strokeIds, ...attached.map((stroke) => stroke.id)] });
  }

  private async commitStrokes() {
    const strokes = this.pendingStrokes.splice(0);
    if (!strokes.length) return;

    if (!this.active) {
      const target = this.elementForStrokes(strokes);
      await this.begin(target, "pen", { screenshot: false });
    }
    const item = this.active!;
    const attached = strokes.map((stroke) => ({ ...stroke, feedbackId: item.id }));
    this.deps.saveStrokes(attached);
    this.update({ strokeIds: [...item.strokeIds, ...attached.map((stroke) => stroke.id)] });
    feedbackStore.setState({
      strokes: feedbackStore
        .getState()
        .strokes.map((stroke) => attached.find((a) => a.id === stroke.id) ?? stroke),
    });
    await this.screenshot("stroke");
  }

  /** The circled/marked element: best overlap ratio with the outline. */
  private elementForStrokes(strokes: Stroke[]): Element | null {
    const xs = strokes.flatMap((stroke) => stroke.points.map((point) => point[0]));
    const ys = strokes.flatMap((stroke) => stroke.points.map((point) => point[1]));
    const box = {
      x: Math.min(...xs),
      y: Math.min(...ys),
      w: Math.max(1, Math.max(...xs) - Math.min(...xs)),
      h: Math.max(1, Math.max(...ys) - Math.min(...ys)),
    };
    const stack = document
      .elementsFromPoint(box.x + box.w / 2, box.y + box.h / 2)
      .filter((el) => !this.deps.isOwn(el));
    const deepest = stack[0];
    if (!deepest) return null;
    let best: Element = deepest;
    let bestScore = -1;
    for (let node: Element | null = deepest; node && node !== document.documentElement; node = node.parentElement) {
      const score = iou(node.getBoundingClientRect(), box);
      if (score > bestScore) {
        best = node;
        bestScore = score;
      }
    }
    return meaningful(best);
  }

  /* ----------------------------------------------------------- Screenshot */

  async screenshot(reason: Screenshot["reason"]): Promise<void> {
    const item = this.active;
    feedbackStore.setState({ capturing: true });
    await nextFrame();
    try {
      const shot = await request<{ id: string }>({ type: "talkcontext:capture", reason, feedbackId: item?.id });
      const current = this.active;
      if (current && item && current.id === item.id) {
        this.update({ screenshotIds: [...current.screenshotIds, shot.id] });
      }
    } catch {
      /* A screenshot is nice, but never more important than the recording */
    } finally {
      feedbackStore.setState({ capturing: false });
    }
  }

  /* ------------------------------------------------------------- internal */

  private setActive(item: FeedbackItem | null) {
    feedbackStore.setState({ active: item });
  }

  private update(patch: Partial<FeedbackItem>) {
    const item = this.active;
    if (!item) return;
    this.setActive({ ...item, ...patch });
    this.save();
  }

  private save(immediate = false) {
    window.clearTimeout(this.saveTimer);
    const persist = () => {
      const item = this.active;
      if (item) this.deps.save(item);
    };
    if (immediate) persist();
    else this.saveTimer = window.setTimeout(persist, 400);
  }
}
