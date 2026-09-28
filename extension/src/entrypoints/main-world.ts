/**
 * Laeuft im JavaScript-Kontext der Seite (MAIN world), nicht in der isolierten
 * Welt des Content-Scripts - nur dort sind `console`, `fetch`, `XMLHttpRequest`
 * und `history` die Objekte, die auch die Anwendung benutzt.
 *
 * Wird ausschliesslich waehrend einer Aufnahme injiziert und meldet per
 * window.postMessage an das Content-Script. Die Seite darf dadurch nie brechen:
 * jeder Patch ruft das Original auf und schluckt eigene Fehler.
 */
import { MAIN_WORLD_SOURCE, type MainWorldMessage } from "@/lib/messages";
import type { ConsoleEntry, NetworkEntry } from "@/lib/types";

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
          report({ ts: started, kind: "fetch", method, url, status: response.status, durationMs: Date.now() - started });
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
      report({
        ts: started,
        kind: "xhr",
        method: info.method,
        url: info.url,
        status: this.status,
        durationMs: Date.now() - started,
        error: this.status === 0 ? "Netzwerkfehler oder abgebrochen" : undefined,
      });
    });
    return originalSend.call(this, body);
  };

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
