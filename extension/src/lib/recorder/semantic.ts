/**
 * Semantischer Recorder: Hover, Klick, Eingabe, Navigation und die DOM-Wirkung
 * danach - als Text, nicht als Pixel. Laeuft in der isolierten Welt des
 * Content-Scripts; Konsole/Netzwerk kommen aus dem MAIN-world-Script.
 */
import type { DomEffect, QaEventType, RawFrameEvent, RecorderConfig } from "@shared/types";
import { describe, isSecret, meaningful, selectorFor, truncate } from "./describe";

export interface SemanticRecorderOptions {
  config: RecorderConfig;
  onEvent: (event: RawFrameEvent) => void;
  onEffect: (id: string, effect: DomEffect) => void;
  onCursor: (sample: { ts: number; x: number; y: number }) => void;
  /** Das anvisierte Element hat gewechselt - fuer das Highlight im Overlay. */
  onTarget: (el: Element | null) => void;
  /** Gehoert der Knoten zum Overlay? Dann nicht protokollieren. */
  isOwn: (node: EventTarget | null) => boolean;
}

export interface SemanticRecorder {
  stop(): void;
  /** Befund an das zuletzt anvisierte Element haengen. */
  note(text: string, kind: "note" | "marker"): void;
  /** Aus dem MAIN-world-Script gemeldete History-Navigation. */
  checkNavigation(kind: string): void;
}

const DIALOG_SELECTOR = '[role="dialog"],[role="alertdialog"],dialog[open],[aria-modal="true"]';
const TRACKED_KEYS = ["Enter", "Escape", "Tab", "Backspace", "Delete", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];

let seq = 0;
const uid = () => `e${Date.now().toString(36)}-${(seq++).toString(36)}`;

export function startSemanticRecorder(options: SemanticRecorderOptions): SemanticRecorder {
  const { config } = options;
  const cleanups: Array<() => void> = [];
  const describeEl = (el: Element | null, extra: { html?: boolean; leaf?: Element } = {}) =>
    describe(el, { ...extra, captureHtml: config.captureHtml });

  function emit(type: QaEventType, payload: Pick<RawFrameEvent, "target" | "detail"> = {}): RawFrameEvent {
    const event: RawFrameEvent = { id: uid(), ts: Date.now(), type, url: location.href, ...payload };
    options.onEvent(event);
    return event;
  }

  const on = <K extends keyof DocumentEventMap>(
    target: Document | Window,
    type: K,
    handler: (event: DocumentEventMap[K]) => void,
    opts: AddEventListenerOptions = { capture: true, passive: true },
  ) => {
    const listener = (event: Event) => {
      if (options.isOwn(event.composedPath?.()[0] ?? null) || options.isOwn(event.target)) return;
      try {
        handler(event as DocumentEventMap[K]);
      } catch {
        /* Aufnahme darf die Seite nie brechen */
      }
    };
    target.addEventListener(type, listener, opts);
    cleanups.push(() => target.removeEventListener(type, listener, opts));
  };

  /* ----------------------------------------------------------- DOM-Wirkung */

  function observeEffect(eventId: string) {
    const urlBefore = location.href;
    let added = 0;
    let removed = 0;
    let dialogOpened = false;
    let alert: string | undefined;
    const newTexts: string[] = [];
    const attrChanges: NonNullable<DomEffect["attrChanges"]> = [];

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (options.isOwn(mutation.target)) continue;
        if (mutation.type === "childList") {
          for (const node of Array.from(mutation.addedNodes)) {
            if (!(node instanceof Element)) continue;
            added++;
            if (node.matches(DIALOG_SELECTOR) || node.querySelector(DIALOG_SELECTOR)) dialogOpened = true;
            if (!alert && node.matches('[role="alert"],[role="status"],.error,.toast')) {
              alert = truncate(node.textContent, 200);
            }
            if (newTexts.length < 4) {
              const text = truncate(node.textContent, 120);
              if (text) newTexts.push(text);
            }
          }
          removed += mutation.removedNodes.length;
        } else if (mutation.type === "attributes" && attrChanges.length < 5 && mutation.target instanceof Element) {
          const attr = mutation.attributeName ?? "";
          attrChanges.push({
            selector: selectorFor(mutation.target),
            attr,
            value: truncate(mutation.target.getAttribute(attr), 80) ?? null,
          });
        }
      }
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "hidden", "open", "disabled", "aria-expanded", "aria-hidden", "aria-selected", "data-state"],
    });

    window.setTimeout(() => {
      observer.disconnect();
      const effect: DomEffect = {};
      if (location.href !== urlBefore) effect.urlChanged = { from: urlBefore, to: location.href };
      if (added) effect.added = added;
      if (removed) effect.removed = removed;
      if (dialogOpened) effect.dialogOpened = true;
      if (alert) effect.alert = alert;
      if (newTexts.length) effect.newText = truncate(newTexts.join(" | "), 240);
      if (attrChanges.length) effect.attrChanges = attrChanges;
      if (Object.keys(effect).length) options.onEffect(eventId, effect);
    }, 700);
  }

  /* ----------------------------------------------------------- Hover/Cursor */

  let hoverEl: Element | null = null;
  let hoverStart = 0;
  let hoverTimer: number | undefined;
  let hoverReported = false;
  let lastCursor = 0;
  let pointer = { x: 0, y: 0 };
  /** Zuletzt bewusst anvisiertes Element - Ziel fuer Notizen. */
  let focusEl: Element | null = null;

  function closeHover() {
    if (hoverEl && hoverReported) {
      emit("hover", {
        target: describeEl(hoverEl, { html: false }),
        detail: { durationMs: Date.now() - hoverStart, phase: "end" },
      });
    }
    window.clearTimeout(hoverTimer);
    hoverEl = null;
    hoverReported = false;
  }

  on(document, "pointermove", (event) => {
    pointer = { x: Math.round(event.clientX), y: Math.round(event.clientY) };
    const now = Date.now();
    if (now - lastCursor > 120) {
      lastCursor = now;
      options.onCursor({ ts: now, ...pointer });
    }
    const raw = event.target;
    if (!(raw instanceof Element)) return;
    const el = meaningful(raw);
    if (el === hoverEl) return;
    closeHover();
    hoverEl = el;
    hoverStart = now;
    options.onTarget(el);
    hoverTimer = window.setTimeout(() => {
      if (hoverEl !== el) return;
      hoverReported = true;
      focusEl = el;
      emit("hover", {
        target: describeEl(el, { leaf: raw }),
        detail: { phase: "start", x: pointer.x, y: pointer.y },
      });
    }, config.hoverDwellMs);
  });

  on(document, "mouseleave", () => {
    closeHover();
    options.onTarget(null);
  });

  /* ------------------------------------------------------------- Klicks */

  function pointerDetail(event: MouseEvent, el: Element) {
    const rect = el.getBoundingClientRect();
    const detail: Record<string, unknown> = {
      button: event.button,
      x: Math.round(event.clientX),
      y: Math.round(event.clientY),
    };
    if (rect.width && rect.height) {
      detail.offset = {
        x: Math.round(((event.clientX - rect.left) / rect.width) * 100) / 100,
        y: Math.round(((event.clientY - rect.top) / rect.height) * 100) / 100,
      };
    }
    const modifiers = [
      event.ctrlKey && "Ctrl",
      event.metaKey && "Meta",
      event.shiftKey && "Shift",
      event.altKey && "Alt",
    ].filter(Boolean);
    if (modifiers.length) detail.modifiers = modifiers;
    return detail;
  }

  on(document, "click", (event) => {
    const raw = event.target;
    if (!(raw instanceof Element)) return;
    const el = meaningful(raw);
    focusEl = el;
    const qaEvent = emit("click", { target: describeEl(el, { leaf: raw }), detail: pointerDetail(event, el) });
    observeEffect(qaEvent.id);
  });

  on(document, "dblclick", (event) => {
    if (!(event.target instanceof Element)) return;
    const el = meaningful(event.target);
    emit("dblclick", { target: describeEl(el), detail: pointerDetail(event, el) });
  });

  on(document, "contextmenu", (event) => {
    if (!(event.target instanceof Element)) return;
    const el = meaningful(event.target);
    emit("contextmenu", { target: describeEl(el), detail: pointerDetail(event, el) });
  });

  /* ------------------------------------------------------------ Eingaben */

  const inputTimers = new WeakMap<Element, number>();

  on(document, "input", (event) => {
    const el = event.target;
    if (!(el instanceof HTMLElement) || el.tagName === "SELECT") return;
    window.clearTimeout(inputTimers.get(el));
    inputTimers.set(
      el,
      window.setTimeout(() => {
        inputTimers.delete(el);
        const field = el as HTMLInputElement;
        const value = el.isContentEditable ? el.textContent : field.value;
        const detail: Record<string, unknown> = { length: value ? String(value).length : 0 };
        if (isSecret(el)) detail.value = "***";
        else if (config.captureInputValues) detail.value = truncate(value, 200) ?? "";
        if (field.type === "checkbox" || field.type === "radio") detail.checked = field.checked;
        emit("input", { target: describeEl(el, { html: false }), detail });
      }, 450),
    );
  });

  on(document, "change", (event) => {
    const el = event.target;
    if (!(el instanceof HTMLSelectElement)) return;
    const option = el.options[el.selectedIndex];
    emit("change", {
      target: describeEl(el, { html: false }),
      detail: {
        value: isSecret(el) ? "***" : truncate(el.value, 120),
        label: option ? truncate(option.textContent, 120) : undefined,
      },
    });
  });

  on(document, "keydown", (event) => {
    const combo = event.ctrlKey || event.metaKey;
    if (!TRACKED_KEYS.includes(event.key) && !combo) return;
    if (combo && event.key.length > 1 && !TRACKED_KEYS.includes(event.key)) return;
    const keys = [event.ctrlKey && "Ctrl", event.metaKey && "Meta", event.shiftKey && "Shift", event.altKey && "Alt"]
      .filter(Boolean)
      .concat(event.key);
    emit("key", {
      target: event.target instanceof Element ? describeEl(event.target, { html: false }) : undefined,
      detail: { key: keys.join("+") },
    });
  });

  on(document, "submit", (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    const qaEvent = emit("submit", {
      target: describeEl(form, { html: false }),
      detail: {
        action: form.action || location.href,
        method: (form.getAttribute("method") ?? "get").toUpperCase(),
      },
    });
    observeEffect(qaEvent.id);
  });

  /* ------------------------------------------------------ Scroll & Auswahl */

  let scrollTimer: number | undefined;
  on(document, "scroll", (event) => {
    window.clearTimeout(scrollTimer);
    const node = event.target === document || event.target === document.documentElement ? null : event.target;
    scrollTimer = window.setTimeout(() => {
      const element = node instanceof Element ? node : null;
      const detail = element
        ? { scope: "element", top: Math.round(element.scrollTop), left: Math.round(element.scrollLeft) }
        : {
            scope: "page",
            top: Math.round(window.scrollY),
            left: Math.round(window.scrollX),
            percent: Math.round(
              (window.scrollY / Math.max(1, document.documentElement.scrollHeight - window.innerHeight)) * 100,
            ),
          };
      emit("scroll", { target: element ? describeEl(element, { html: false }) : undefined, detail });
    }, 300);
  });

  on(document, "mouseup", () => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;
    const text = truncate(selection.toString(), 240);
    if (!text || text.length < 3) return;
    const anchor = selection.anchorNode;
    const el = anchor instanceof Element ? anchor : anchor?.parentElement ?? null;
    emit("select", { target: el ? describeEl(el, { html: false }) : undefined, detail: { text } });
  });

  on(window, "resize", () => {
    emit("resize", { detail: { width: window.innerWidth, height: window.innerHeight } });
  });

  /* ---------------------------------------------------------- Navigation */

  let lastUrl = location.href;
  function checkNavigation(kind: string) {
    if (location.href === lastUrl) return;
    const from = lastUrl;
    lastUrl = location.href;
    emit("navigate", { detail: { from, to: lastUrl, kind } });
  }

  // Jede (Neu-)Injektion ist ein Seitenaufruf - der Einstieg in die Timeline.
  emit("navigate", { detail: { to: location.href, kind: "load", title: document.title } });

  const onHide = () => closeHover();
  window.addEventListener("pagehide", onHide);
  cleanups.push(() => window.removeEventListener("pagehide", onHide));

  return {
    stop() {
      closeHover();
      window.clearTimeout(scrollTimer);
      for (const cleanup of cleanups.splice(0)) cleanup();
      options.onTarget(null);
    },
    note(text, kind) {
      const target = focusEl?.isConnected ? focusEl : null;
      emit(kind, { target: target ? describeEl(target) : undefined, detail: { text } });
    },
    checkNavigation,
  };
}
