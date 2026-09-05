/**
 * Frame-Proxy: liefert eine fremde Seite unter unserer Origin aus und injiziert
 * den QA-Recorder. Nur dadurch darf der Recorder das DOM der Zielseite lesen -
 * ein normaler Cross-Origin-iframe ist fuer JavaScript eine Blackbox.
 */
import { NextRequest, NextResponse } from "next/server";
import { decodeOrigin, PROXY_PREFIX, toProxyPath } from "@/lib/qa/proxy-url";
import { requestHost, requestOrigin } from "@/lib/qa/request-origin";
import { rewriteCss, rewriteHtml } from "@/lib/qa/rewrite";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Header, die nie weitergereicht werden duerfen. */
const DROP_REQUEST_HEADERS = new Set([
  "host",
  "connection",
  "keep-alive",
  "proxy-authorization",
  "transfer-encoding",
  "upgrade",
  "accept-encoding",
  "content-length",
  "x-forwarded-host",
  "x-forwarded-proto",
]);

/** Header, die die Einbettung oder das Rewriting kaputt machen wuerden. */
const DROP_RESPONSE_HEADERS = new Set([
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "connection",
  "keep-alive",
  "x-frame-options",
  "content-security-policy",
  "content-security-policy-report-only",
  "cross-origin-opener-policy",
  "cross-origin-embedder-policy",
  "cross-origin-resource-policy",
  "permissions-policy",
  "referrer-policy",
  "strict-transport-security",
  "clear-site-data",
  "set-cookie",
  "report-to",
  "nel",
]);

function buildTargetUrl(request: NextRequest): { url: string; origin: string } | null {
  const pathname = request.nextUrl.pathname;
  if (!pathname.startsWith(`${PROXY_PREFIX}/`)) return null;
  const rest = pathname.slice(PROXY_PREFIX.length + 1);
  const slash = rest.indexOf("/");
  const token = slash === -1 ? rest : rest.slice(0, slash);
  const path = slash === -1 ? "/" : rest.slice(slash);
  const origin = decodeOrigin(token);
  if (!origin) return null;
  return { url: `${origin}${path}${request.nextUrl.search}`, origin };
}

function forwardRequestHeaders(request: NextRequest, targetUrl: string): Headers {
  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (DROP_REQUEST_HEADERS.has(key.toLowerCase())) return;
    headers.set(key, value);
  });
  // Referer auf die reale Ziel-URL umschreiben - manche Apps pruefen ihn.
  const referer = request.headers.get("referer");
  if (referer) {
    try {
      const asProxy = new URL(referer);
      const realReferer = asProxy.pathname.startsWith(`${PROXY_PREFIX}/`)
        ? decodeProxyHref(asProxy)
        : null;
      if (realReferer) headers.set("referer", realReferer);
      else headers.delete("referer");
    } catch {
      headers.delete("referer");
    }
  }
  headers.set("accept-encoding", "identity");
  try {
    headers.set("origin", new URL(targetUrl).origin);
  } catch {
    headers.delete("origin");
  }
  return headers;
}

function decodeProxyHref(url: URL): string | null {
  const rest = url.pathname.slice(PROXY_PREFIX.length + 1);
  const slash = rest.indexOf("/");
  const token = slash === -1 ? rest : rest.slice(0, slash);
  const path = slash === -1 ? "/" : rest.slice(slash);
  const origin = decodeOrigin(token);
  return origin ? `${origin}${path}${url.search}` : null;
}

/** Cookies der Zielseite auf unsere Origin ummuenzen, damit Logins funktionieren. */
function rewriteSetCookie(value: string, secureContext: boolean): string {
  return value
    .split(";")
    .map((part) => part.trim())
    .filter((part) => {
      const lower = part.toLowerCase();
      if (lower.startsWith("domain=")) return false;
      if (lower.startsWith("path=")) return false;
      if (lower === "secure" && !secureContext) return false;
      if (lower.startsWith("samesite=")) return false;
      return true;
    })
    .concat(["Path=/", secureContext ? "SameSite=None; Secure" : "SameSite=Lax"])
    .join("; ");
}

function errorPage(title: string, message: string, status: number): NextResponse {
  const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>${title}</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0a0a0a;color:#e5e5e5;
       font:14px/1.6 ui-sans-serif,system-ui,-apple-system,sans-serif}
  .card{max-width:38rem;padding:2rem;border:1px solid #262626;border-radius:12px;background:#111}
  h1{margin:0 0 .5rem;font-size:1rem;color:#fafafa}
  p{margin:0;color:#a3a3a3}
  code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#38bdf8;word-break:break-all}
</style></head>
<body><div class="card"><h1>${title}</h1><p>${message}</p></div></body></html>`;
  return new NextResponse(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

async function handle(request: NextRequest): Promise<NextResponse> {
  const target = buildTargetUrl(request);
  if (!target) return errorPage("Ungueltiger Proxy-Pfad", "Die Ziel-URL konnte nicht dekodiert werden.", 400);

  // Schleifen ueber die eigene Origin verhindern.
  if (new URL(target.url).host === requestHost(request)) {
    return errorPage("Proxy-Schleife", "Das QA-Tool kann sich nicht selbst proxien.", 400);
  }

  const secureContext = request.nextUrl.protocol === "https:";
  let upstream: Response;
  try {
    upstream = await fetch(target.url, {
      method: request.method,
      headers: forwardRequestHeaders(request, target.url),
      body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer(),
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return errorPage(
      "Ziel nicht erreichbar",
      `<code>${target.url}</code> konnte nicht geladen werden: ${reason}. Laeuft der Dev-Server?`,
      502,
    );
  }

  const headers = new Headers();
  upstream.headers.forEach((value, key) => {
    if (DROP_RESPONSE_HEADERS.has(key.toLowerCase())) return;
    headers.set(key, value);
  });
  for (const cookie of upstream.headers.getSetCookie?.() ?? []) {
    headers.append("set-cookie", rewriteSetCookie(cookie, secureContext));
  }
  headers.set("cache-control", "no-store");
  // Fuer den Referer-Fallback in der Middleware brauchen wir den vollen Pfad.
  headers.set("referrer-policy", "same-origin");

  // Redirects im Proxy halten.
  if (upstream.status >= 300 && upstream.status < 400) {
    const location = upstream.headers.get("location");
    if (location) {
      const absolute = new URL(location, target.url).toString();
      headers.set("location", toProxyPath(absolute));
      return new NextResponse(null, { status: upstream.status, headers });
    }
  }

  const contentType = upstream.headers.get("content-type") ?? "";

  if (/text\/html|application\/xhtml\+xml/i.test(contentType)) {
    const html = await upstream.text();
    const injection =
      `<meta name="referrer" content="same-origin">` +
      `<script src="/qa-recorder.js" data-qa-mode="proxy" data-qa-origin="${requestOrigin(request)}"></script>`;
    const rewritten = rewriteHtml(html, { baseUrl: target.url, injection });
    headers.set("content-type", "text/html; charset=utf-8");
    return new NextResponse(rewritten, { status: upstream.status, headers });
  }

  if (/text\/css/i.test(contentType)) {
    const css = await upstream.text();
    return new NextResponse(rewriteCss(css, target.url), { status: upstream.status, headers });
  }

  return new NextResponse(upstream.body, { status: upstream.status, headers });
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const HEAD = handle;
export const OPTIONS = handle;
