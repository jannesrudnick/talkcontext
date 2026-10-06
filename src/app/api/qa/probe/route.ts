/**
 * Checks whether a target URL is reachable and directly embeddable. The studio
 * derives its proxy vs. bridge mode recommendation from this.
 */
import { NextRequest, NextResponse } from "next/server";
import { normalizeTargetUrl } from "@/lib/qa/proxy-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("url");
  const target = raw ? normalizeTargetUrl(raw) : null;
  if (!target) return NextResponse.json({ error: "url is missing or invalid" }, { status: 400 });

  try {
    const response = await fetch(target, {
      method: "GET",
      redirect: "follow",
      cache: "no-store",
      headers: { accept: "text/html,*/*" },
      signal: AbortSignal.timeout(10_000),
    });
    const xfo = response.headers.get("x-frame-options");
    const csp = response.headers.get("content-security-policy") ?? "";
    const frameAncestors = /frame-ancestors\s+([^;]+)/i.exec(csp)?.[1]?.trim() ?? null;
    const blocksEmbedding =
      !!xfo || (!!frameAncestors && !/\*/.test(frameAncestors) && !/\bself\b/i.test(frameAncestors));

    return NextResponse.json({
      url: response.url,
      status: response.status,
      reachable: true,
      contentType: response.headers.get("content-type"),
      xFrameOptions: xfo,
      frameAncestors,
      /** Direct embedding (bridge mode) possible? */
      embeddable: !blocksEmbedding,
      recommendedMode: blocksEmbedding ? "proxy" : "bridge",
    });
  } catch (error) {
    return NextResponse.json({
      url: target,
      reachable: false,
      error: error instanceof Error ? error.message : String(error),
      recommendedMode: "proxy",
    });
  }
}
