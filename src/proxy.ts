import { NextRequest, NextResponse } from "next/server";
import { PROXY_PREFIX } from "@/lib/qa/proxy-url";
import { requestHost } from "@/lib/qa/request-origin";

/**
 * Safety net for the frame proxy.
 *
 * Root-relative URLs (`/_next/...`, `/assets/logo.svg`) that the target page
 * only creates at runtime would otherwise hit our origin and go nowhere. If such
 * a request arrives with a proxy referer, we send it back into the proxy of the
 * same target page.
 */
export default function proxy(request: NextRequest) {
  const referer = request.headers.get("referer");
  if (!referer) return NextResponse.next();

  let token: string | null = null;
  try {
    const refererUrl = new URL(referer);
    if (refererUrl.host !== requestHost(request)) return NextResponse.next();
    const match = refererUrl.pathname.match(/^\/p\/([^/]+)/);
    token = match ? match[1] : null;
  } catch {
    return NextResponse.next();
  }
  if (!token) return NextResponse.next();

  const { pathname, search } = request.nextUrl;
  const redirectTo = new URL(`${PROXY_PREFIX}/${token}${pathname}${search}`, request.nextUrl.origin);
  return NextResponse.redirect(redirectTo, 307);
}

export const config = {
  matcher: ["/((?!p/|qa-recorder\\.js|api/qa).*)"],
};
