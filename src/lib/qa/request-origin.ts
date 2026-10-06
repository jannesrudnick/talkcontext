import type { NextRequest } from "next/server";

/**
 * Actual origin of the incoming request.
 *
 * `request.nextUrl.origin` returns the configured origin in the dev server
 * (localhost) - even if the browser comes via 127.0.0.1. For the referer
 * check and postMessage it has to be the host actually used.
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
