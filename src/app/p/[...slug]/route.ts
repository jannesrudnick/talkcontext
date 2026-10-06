/**
 * Frame proxy: serves a foreign page under our origin and injects the QA
 * recorder. Only this lets the recorder read the target page's DOM - a normal
 * cross-origin iframe is a black box to JavaScript.
 */
import { NextRequest, NextResponse } from "next/server";
import { decodeOrigin, PROXY_PREFIX, toProxyPath } from "@/lib/qa/proxy-url";
import { requestHost, requestOrigin } from "@/lib/qa/request-origin";
import { rewriteCss, rewriteHtml } from "@/lib/qa/rewrite";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Headers that must never be forwarded. */
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

/** Headers that would break embedding or rewriting. */
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
  // Rewrite the referer to the real target URL - some apps check it.
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

/** Rebind the target page's cookies to our origin so logins work. */
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
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>
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
  if (!target) return errorPage("Invalid proxy path", "The target URL could not be decoded.", 400);

  // Prevent loops through our own origin.
  if (new URL(target.url).host === requestHost(request)) {
    return errorPage("Proxy loop", "The QA tool cannot proxy itself.", 400);
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
      "Target unreachable",
      `<code>${target.url}</code> could not be loaded: ${reason}. Is the dev server running?`,
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
  // The referer fallback in the middleware needs the full path.
  headers.set("referrer-policy", "same-origin");

  // Keep redirects inside the proxy.
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
