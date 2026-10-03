/**
 * Feedback-Punkte: ausdrueckliche Befunde statt geratener Zuordnung.
 *
 * Ein Punkt entsteht per Rechtsklick auf ein Element, mit dem Stift, oder ueber
 * die Notiz-/Bug-Buttons. Solange er aktiv ist, gehoert alles Gesagte (Live-
 * Transkript), Getippte und Gezeichnete zu ihm. Jeder Punkt bekommt einen
 * Screenshot, die Komponentenkette (React/Vue), berechnete Styles und einen
 * DOM-Ausschnitt - genug Kontext, damit ein Agent ohne Rueckfrage loslegen kann.
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
  /** Zu welchem Punkt der Satz gezaehlt wurde. */
  feedback: string | null;
  at: number;
}

export interface FeedbackState {
  active: FeedbackItem | null;
  /** Laufender, noch nicht finaler Satz aus dem Live-Transkript. */
  partial: string;
  captions: Caption[];
  pen: boolean;
  penColor: string;
  /** Sichtbare Striche (aktiver Punkt und noch nicht zugeordnete). */
  strokes: Stroke[];
  /** Waehrend eines Screenshots wird die eigene Oberflaeche ausgeblendet. */
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
  /** Notiz ins semantische Protokoll schreiben (fuer die Timeline). */
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

/** Werte, die nur in bestimmten Layouts etwas bedeuten. */
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
  // Abgeschnittener Inhalt ist einer der haeufigsten Layout-Befunde.
  if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) {
    styles["(overflow)"] = `Inhalt ${el.scrollWidth}×${el.scrollHeight} > sichtbar ${el.clientWidth}×${el.clientHeight}`;
  }
  return styles;
}

const CONTAINER = "form,section,article,dialog,[role=dialog],main,nav,header,footer,li,tr,[class*=card]";

/** DOM-Ausschnitt um das Element, das Ziel mit `data-qey-target` markiert. */
function domSnippet(el: Element): string {
  let container = el.closest(CONTAINER) ?? el.parentElement?.parentElement ?? el;
  if (container === document.body || container === document.documentElement) container = el.parentElement ?? el;

  // Pfad vom Container zum Ziel merken, um die Kopie zu markieren - das Original bleibt unangetastet.
  const path: number[] = [];
  for (let node: Element | null = el; node && node !== container; node = node.parentElement) {
    if (!node.parentElement) break;
    path.unshift(Array.prototype.indexOf.call(node.parentElement.children, node));
  }
  const clone = container.cloneNode(true) as Element;
  let target: Element | undefined = clone;
  for (const index of path) target = target?.children[index];
  target?.setAttribute("data-qey-target", "");

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
  /** Saetze ohne Punkt - werden beim naechsten Rechtsklick eingesammelt. */
  private loose: Array<{ text: string; at: number }> = [];

  constructor(private deps: FeedbackDeps) {}

  get active() {
    return feedbackStore.getState().active;
  }

  /* --------------------------------------------------------- Lebenszyklus */

  async begin(
    el: Element | null,
    source: FeedbackItem["source"],
    options: { text?: string; screenshot?: boolean } = {},
  ): Promise<FeedbackItem> {
    this.close();
    const index = await request<number>({ type: "qey:next-feedback-index" }).catch(() => 1);
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

  /** Kuerzlich Gesagtes, das noch zu keinem Punkt gehoert (Reden, dann Rechtsklick). */
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

  /** Beim Seitenwechsel oder Stoppen: alles Offene abschliessen. */
  finish() {
    this.close();
    window.clearTimeout(this.saveTimer);
  }

  /* ------------------------------------------------------------- Sprache */

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

    // Zum aktiven Punkt, oder zum gerade geschlossenen, wenn der Satz noch
    // waehrend dessen Aktivzeit begonnen hat.
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

  /* ---------------------------------------------------------------- Stift */

  togglePen(on?: boolean) {
    const pen = on ?? !feedbackStore.getState().pen;
    if (!pen) this.flushStrokes();
    feedbackStore.setState({ pen });
  }

  setPenColor(penColor: string) {
    feedbackStore.setState({ penColor });
  }

  /** Ein Strich ist fertig - kurz warten, ob weitere zur selben Markierung gehoeren. */
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

  /** Offene Striche ohne Screenshot direkt an den aktiven Punkt haengen. */
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

  /** Das umkreiste/markierte Element: bestes Ueberlappungsverhaeltnis mit dem Umriss. */
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
      const shot = await request<{ id: string }>({ type: "qey:capture", reason, feedbackId: item?.id });
      const current = this.active;
      if (current && item && current.id === item.id) {
        this.update({ screenshotIds: [...current.screenshotIds, shot.id] });
      }
    } catch {
      /* Screenshot ist nett, aber nie wichtiger als die Aufnahme */
    } finally {
      feedbackStore.setState({ capturing: false });
    }
  }

  /* --------------------------------------------------------------- intern */

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
