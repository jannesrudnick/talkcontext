/**
 * URL scheme of the frame proxy: /p/<base64url(origin)>/<path><query>
 *
 * The target page's path is kept 1:1 so relative URLs in the document
 * (images, ES module imports, fetch) still resolve correctly.
 */

export const PROXY_PREFIX = "/p";

/** base64url without Buffer, so the helpers also run in the browser. */
function b64urlEncode(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(value: string): string {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeOrigin(origin: string): string {
  return b64urlEncode(origin);
}

export function decodeOrigin(token: string): string | null {
  try {
    const origin = b64urlDecode(token);
    const url = new URL(origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Absolute target URL -> proxy path. Non-http(s) URLs stay unchanged. */
export function toProxyPath(absoluteUrl: string): string {
  let url: URL;
  try {
    url = new URL(absoluteUrl);
  } catch {
    return absoluteUrl;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return absoluteUrl;
  return `${PROXY_PREFIX}/${encodeOrigin(url.origin)}${url.pathname}${url.search}${url.hash}`;
}

/** Proxy path (or URL) -> real target URL. Returns null if it is not a proxy path. */
export function fromProxyPath(pathnameOrUrl: string, search = ""): string | null {
  let pathname = pathnameOrUrl;
  let query = search;
  let hash = "";
  if (/^https?:\/\//i.test(pathnameOrUrl)) {
    try {
      const u = new URL(pathnameOrUrl);
      pathname = u.pathname;
      query = u.search;
      hash = u.hash;
    } catch {
      return null;
    }
  }
  if (!pathname.startsWith(`${PROXY_PREFIX}/`)) return null;
  const rest = pathname.slice(PROXY_PREFIX.length + 1);
  const slash = rest.indexOf("/");
  const token = slash === -1 ? rest : rest.slice(0, slash);
  const path = slash === -1 ? "/" : rest.slice(slash);
  const origin = decodeOrigin(token);
  if (!origin) return null;
  return `${origin}${path}${query}${hash}`;
}

/** Normalizes user input like "localhost:3000" to a full URL. */
export function normalizeTargetUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `${/^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?(\/|$)/i.test(trimmed) ? "http" : "https"}://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}
