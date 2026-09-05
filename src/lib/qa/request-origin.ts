import type { NextRequest } from "next/server";

/**
 * Tatsaechliche Origin des eingehenden Requests.
 *
 * `request.nextUrl.origin` liefert im Dev-Server die konfigurierte Origin
 * (localhost) - auch wenn der Browser ueber 127.0.0.1 kommt. Fuer den
 * Referer-Abgleich und postMessage muss es aber der real genutzte Host sein.
 */
export function requestOrigin(request: NextRequest): string {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!host) return request.nextUrl.origin;
  const protocol = request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "");
  return `${protocol}://${host}`;
}

export function requestHost(request: NextRequest): string {
  return request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? request.nextUrl.host;
}
