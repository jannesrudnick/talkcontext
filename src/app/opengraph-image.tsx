import { ImageResponse } from "next/og";
import { TAGLINE } from "./site";

export const alt = `TalkContext – ${TAGLINE}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 80,
          background: "linear-gradient(135deg, #18181b 0%, #27272a 55%, #4c1d95 100%)",
          color: "white",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 18,
              background: "linear-gradient(135deg, #6d5dfc, #d946ef)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 36,
              fontWeight: 700,
            }}
          >
            T
          </div>
          <div style={{ fontSize: 40, fontWeight: 700 }}>TalkContext</div>
        </div>
        <div style={{ display: "flex", fontSize: 64, fontWeight: 700, lineHeight: 1.1, maxWidth: 980 }}>{TAGLINE}</div>
        <div style={{ display: "flex", fontSize: 28, color: "#a1a1aa" }}>
          Open source · Chrome extension · MCP for Claude Code
        </div>
      </div>
    ),
    size,
  );
}
