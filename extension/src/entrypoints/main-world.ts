/**
 * Laeuft im JavaScript-Kontext der Seite (MAIN world), nicht in der isolierten
 * Welt des Content-Scripts - nur dort sind `console`, `fetch`, `XMLHttpRequest`
 * und `history` die Objekte, die auch die Anwendung benutzt.
 *
 * Wird ausschliesslich waehrend einer Aufnahme injiziert und meldet per
 * window.postMessage an das Content-Script. Die Seite darf dadurch nie brechen:
 * jeder Patch ruft das Original auf und schluckt eigene Fehler.
 */
import { COMPONENT_PROBE_EVENT, MAIN_WORLD_SOURCE, type MainWorldMessage } from "@/lib/messages";
import type { ComponentInfo, ConsoleEntry, NetworkEntry } from "@/lib/types";

declare global {
  interface Window {
    __qeyMainWorld?: boolean;
  }
}

export default defineUnlistedScript(() => {
  if (window.__qeyMainWorld) return;
  window.__qeyMainWorld = true;

  let seq = 0;
  const uid = (prefix: string) => `${prefix}${Date.now().toString(36)}${(seq++).toString(36)}`;

  type WithoutSource<T> = T extends unknown ? Omit<T, "source"> : never;
  const post = (message: WithoutSource<MainWorldMessage>) => {
    try {
      window.postMessage({ source: MAIN_WORLD_SOURCE, ...message }, "*");
    } catch {
      /* nicht klonbar - dann eben nicht */
    }
  };

  const truncate = (value: string, max: number) => (value.length > max ? `${value.slice(0, max)}…` : value);

  const stringify = (arg: unknown): string => {
    if (typeof arg === "string") return arg;
    if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
    if (arg instanceof Element) return `<${arg.tagName.toLowerCase()}${arg.id ? `#${arg.id}` : ""}>`;
    try {
      return JSON.stringify(arg);
    } catch {
      return String(arg);
    }
  };

  /* ------------------------------------------------------------- Konsole */

  const levels: ConsoleEntry["level"][] = ["log", "info", "warn", "error", "debug"];
  for (const level of levels) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      try {
        const error = args.find((arg): arg is Error => arg instanceof Error);
        post({
          type: "console",
          entry: {
            id: uid("c"),
            ts: Date.now(),
            level,
            message: truncate(args.slice(0, 6).map(stringify).join(" "), 2000),
            stack: error?.stack ? truncate(error.stack, 2000) : undefined,
          },
        });
      } catch {
        /* ignorieren */
      }
      original(...args);
    };
  }

  window.addEventListener("error", (event) => {
    post({
      type: "console",
      entry: {
        id: uid("c"),
        ts: Date.now(),
        level: "error",
        message: truncate(String(event.message || "Unbekannter Fehler"), 2000),
        source: event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : undefined,
        stack: event.error instanceof Error && event.error.stack ? truncate(event.error.stack, 2000) : undefined,
      },
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason as unknown;
    post({
      type: "console",
      entry: {
        id: uid("c"),
        ts: Date.now(),
        level: "error",
        message: truncate(`Unhandled rejection: ${stringify(reason instanceof Error ? reason.message : reason)}`, 2000),
        source: "unhandledrejection",
        stack: reason instanceof Error && reason.stack ? truncate(reason.stack, 2000) : undefined,
      },
    });
  });

  /* ------------------------------------------------------------ Netzwerk */

  const report = (entry: Omit<NetworkEntry, "id">) => post({ type: "network", entry: { id: uid("n"), ...entry } });

  // Bei fehlgeschlagenen Requests hilft dem Agenten der Body mehr als der Statuscode.
  const SECRET_KEYS = /("(?:[^"]*(?:pass|token|secret|authorization|api[_-]?key|cookie)[^"]*)"\s*:\s*)"[^"]*"/gi;
  const mask = (text: string) => text.replace(SECRET_KEYS, '$1"***"');
  const bodyPreview = (body: unknown, max: number): string | undefined => {
    if (typeof body === "string") return truncate(mask(body), max);
    if (body instanceof URLSearchParams) return truncate(mask(body.toString()), max);
    if (body instanceof FormData) return "[FormData]";
    if (body instanceof Blob) return `[Blob ${body.size} B]`;
    return undefined;
  };
  const failed = (status: number) => status === 0 || status >= 400;

  const absolute = (url: string) => {
    try {
      return new URL(url, location.href).href;
    } catch {
      return url;
    }
  };

  const originalFetch = window.fetch;
  if (typeof originalFetch === "function") {
    window.fetch = function patchedFetch(this: unknown, input: RequestInfo | URL, init?: RequestInit) {
      const started = Date.now();
      const url = absolute(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
      return originalFetch.call(this, input, init).then(
        (response) => {
          const entry = { ts: started, kind: "fetch" as const, method, url, status: response.status, durationMs: Date.now() - started };
          if (!failed(response.status)) {
            report(entry);
            return response;
          }
          response
            .clone()
            .text()
            .then(
              (text) => report({ ...entry, requestBody: bodyPreview(init?.body, 1000), responseBody: truncate(mask(text), 2000) }),
              () => report({ ...entry, requestBody: bodyPreview(init?.body, 1000) }),
            );
          return response;
        },
        (error: unknown) => {
          report({
            ts: started,
            kind: "fetch",
            method,
            url,
            status: 0,
            durationMs: Date.now() - started,
            error: error instanceof Error ? error.message : String(error),
            requestBody: bodyPreview(init?.body, 1000),
          });
          throw error;
        },
      );
    } as typeof window.fetch;
  }

  type TrackedXhr = XMLHttpRequest & { __qey?: { method: string; url: string } };
  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function patchedOpen(this: TrackedXhr, method: string, url: string | URL) {
    this.__qey = { method: String(method).toUpperCase(), url: absolute(String(url)) };
    // eslint-disable-next-line prefer-rest-params
    return originalOpen.apply(this, arguments as unknown as Parameters<typeof originalOpen>);
  } as typeof XMLHttpRequest.prototype.open;

  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function patchedSend(this: TrackedXhr, body?: XMLHttpRequestBodyInit | null) {
    const started = Date.now();
    this.addEventListener("loadend", () => {
      const info = this.__qey;
      if (!info) return;
      let responseBody: string | undefined;
      if (failed(this.status)) {
        try {
          const raw = this.responseType === "" || this.responseType === "text" ? this.responseText : JSON.stringify(this.response);
          responseBody = raw ? truncate(mask(raw), 2000) : undefined;
        } catch {
          responseBody = undefined;
        }
      }
      report({
        ts: started,
        kind: "xhr",
        method: info.method,
        url: info.url,
        status: this.status,
        durationMs: Date.now() - started,
        error: this.status === 0 ? "Netzwerkfehler oder abgebrochen" : undefined,
        requestBody: failed(this.status) ? bodyPreview(body, 1000) : undefined,
        responseBody,
      });
    });
    return originalSend.call(this, body);
  };

  /* ---------------------------------------------------------- Komponenten */

  /**
   * Komponentenkette eines Elements aus React- bzw. Vue-Dev-Builds. Die Daten
   * haengen als Expandos am DOM-Knoten und sind nur hier in der MAIN world
   * sichtbar - das Content-Script fragt per CustomEvent auf dem Element an.
   */
  type Fiber = {
    type?: unknown;
    return?: Fiber | null;
    _debugSource?: { fileName?: string; lineNumber?: number };
  };

  const nameOf = (type: unknown): string | undefined => {
    if (!type) return undefined;
    if (typeof type === "function") {
      const fn = type as { displayName?: string; name?: string };
      return fn.displayName || fn.name || undefined;
    }
    if (typeof type === "object") {
      const obj = type as { displayName?: string; render?: unknown; type?: unknown };
      return obj.displayName || nameOf(obj.render) || nameOf(obj.type);
    }
    return undefined;
  };

  const reactInfo = (el: Element): ComponentInfo | null => {
    let node: Element | null = el;
    let fiber: Fiber | undefined;
    while (node && !fiber) {
      const key = Object.keys(node).find((k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"));
      if (key) fiber = (node as unknown as Record<string, Fiber>)[key];
      node = node.parentElement;
    }
    if (!fiber) return null;
    const chain: string[] = [];
    let file: string | undefined;
    for (let current: Fiber | null | undefined = fiber; current && chain.length < 12; current = current.return) {
      if (typeof current.type === "string" || !current.type) continue;
      const name = nameOf(current.type);
      // Interne/anonyme Wrapper (Provider, Router-Internas) helfen niemandem.
      if (!name || name.length < 2 || /^(Anonymous|_c\d*|Fragment|Suspense|StrictMode)$/.test(name)) continue;
      if (chain[0] === name) continue;
      chain.unshift(name);
      if (!file && current._debugSource?.fileName) {
        file = `${current._debugSource.fileName}${current._debugSource.lineNumber ? `:${current._debugSource.lineNumber}` : ""}`;
      }
    }
    return chain.length ? { framework: "react", chain: chain.slice(-8), file } : null;
  };

  type VueInstance = { type?: { name?: string; __name?: string; __file?: string }; parent?: VueInstance | null };

  const vueInfo = (el: Element): ComponentInfo | null => {
    let node: Element | null = el;
    let instance: VueInstance | undefined;
    while (node && !instance) {
      instance = (node as unknown as { __vueParentComponent?: VueInstance }).__vueParentComponent;
      node = node.parentElement;
    }
    if (!instance) return null;
    const chain: string[] = [];
    const file = instance.type?.__file;
    for (let current: VueInstance | null | undefined = instance; current && chain.length < 12; current = current.parent) {
      const name = current.type?.name || current.type?.__name;
      if (name && chain[0] !== name) chain.unshift(name);
    }
    return chain.length ? { framework: "vue", chain: chain.slice(-8), file } : null;
  };

  document.addEventListener(
    COMPONENT_PROBE_EVENT,
    (event) => {
      const requestId = String((event as CustomEvent<string>).detail ?? "");
      const target = event.target;
      let info: ComponentInfo | null = null;
      try {
        if (target instanceof Element) info = reactInfo(target) ?? vueInfo(target);
      } catch {
        info = null;
      }
      post({ type: "component", requestId, info });
    },
    true,
  );

  /* ---------------------------------------------------------- Navigation */

  for (const name of ["pushState", "replaceState"] as const) {
    const original = history[name];
    history[name] = function patchedHistory(this: History, ...args: Parameters<History["pushState"]>) {
      const result = original.apply(this, args);
      post({ type: "navigation", kind: name === "pushState" ? "push" : "replace" });
      return result;
    };
  }
  window.addEventListener("popstate", () => post({ type: "navigation", kind: "popstate" }));
  window.addEventListener("hashchange", () => post({ type: "navigation", kind: "hash" }));
});
