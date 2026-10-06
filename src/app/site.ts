export const REPO = "https://github.com/jannesrudnick/talkcontext";

/** Canonical origin: an explicit override, else Vercel's production domain (custom domain once one is set). */
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000");

export const TAGLINE = "Point at your UI, say what's wrong – your coding agent gets the context.";

export const DESCRIPTION =
  "Open-source Chrome extension for visual UI feedback to AI coding agents. Click through any web app, right-click elements and talk – Claude Code gets the selector, component, styles, screenshot and errors via a local MCP server.";
