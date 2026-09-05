/**
 * HTML/CSS-Rewriting fuer den Frame-Proxy.
 *
 * Ziel: Das Dokument wird von *unserer* Origin ausgeliefert, damit das
 * Recorder-Skript vollen DOM-Zugriff hat. Damit die Seite trotzdem laedt,
 * werden alle URLs auf den Proxy umgebogen.
 */
import { toProxyPath } from "./proxy-url";

const SKIP_URL = /^(?:data:|blob:|javascript:|mailto:|tel:|about:|#|\{|\$\{)/i;

export function resolveToProxy(rawUrl: string, baseUrl: string): string {
  const value = rawUrl.trim();
  if (!value || SKIP_URL.test(value)) return rawUrl;
  try {
    const absolute = new URL(value, baseUrl);
    if (absolute.protocol !== "http:" && absolute.protocol !== "https:") return rawUrl;
    return toProxyPath(absolute.toString());
  } catch {
    return rawUrl;
  }
}

function rewriteSrcset(value: string, baseUrl: string): string {
  return value
    .split(",")
    .map((candidate) => {
      const trimmed = candidate.trim();
      if (!trimmed) return trimmed;
      const [url, ...descriptors] = trimmed.split(/\s+/);
      return [resolveToProxy(url, baseUrl), ...descriptors].join(" ");
    })
    .join(", ");
}

export function rewriteCss(css: string, baseUrl: string): string {
  return css
    .replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (match, quote: string, url: string) => {
      return `url(${quote}${resolveToProxy(url, baseUrl)}${quote})`;
    })
    .replace(/@import\s+(['"])([^'"]+)\1/gi, (match, quote: string, url: string) => {
      return `@import ${quote}${resolveToProxy(url, baseUrl)}${quote}`;
    });
}

const URL_ATTRS = new Set(["src", "href", "action", "formaction", "poster", "data-src", "data-href"]);

/** Attribute innerhalb eines einzelnen Tags umschreiben. */
function rewriteTag(tag: string, baseUrl: string): string {
  let result = tag
    // Subresource Integrity passt nach dem Rewriting nicht mehr.
    .replace(/\s+integrity\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s+crossorigin\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s+crossorigin(?=[\s>])/gi, "");

  result = result.replace(
    /(\s)(src|href|action|formaction|poster|data-src|data-href|srcset|imagesrcset)(\s*=\s*)("[^"]*"|'[^']*'|[^\s"'>]+)/gi,
    (match, space: string, attr: string, eq: string, quoted: string) => {
      const quote = quoted.startsWith('"') ? '"' : quoted.startsWith("'") ? "'" : "";
      const value = quote ? quoted.slice(1, -1) : quoted;
      const lower = attr.toLowerCase();
      const rewritten =
        lower === "srcset" || lower === "imagesrcset"
          ? rewriteSrcset(value, baseUrl)
          : URL_ATTRS.has(lower)
            ? resolveToProxy(value, baseUrl)
            : value;
      const wrap = quote || '"';
      return `${space}${attr}${eq}${wrap}${rewritten}${wrap}`;
    },
  );

  // Inline-Styles koennen url(...) enthalten.
  result = result.replace(/(\sstyle\s*=\s*)("[^"]*"|'[^']*')/gi, (match, prefix: string, quoted: string) => {
    const quote = quoted[0];
    const value = quoted.slice(1, -1);
    return `${prefix}${quote}${rewriteCss(value, baseUrl)}${quote}`;
  });

  return result;
}

interface RewriteOptions {
  /** Reale URL des Dokuments - Basis fuer relative URLs. */
  baseUrl: string;
  /** Markup, das so frueh wie moeglich in den <head> injiziert wird. */
  injection: string;
}

export function rewriteHtml(html: string, options: RewriteOptions): string {
  const { baseUrl, injection } = options;

  // Ein vorhandenes <base href> aendert die Aufloesung relativer URLs.
  const baseMatch = html.match(/<base[^>]+href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
  let effectiveBase = baseUrl;
  if (baseMatch) {
    const raw = baseMatch[1] ?? baseMatch[2] ?? baseMatch[3];
    try {
      effectiveBase = new URL(raw, baseUrl).toString();
    } catch {
      /* ungueltige base - Dokument-URL behalten */
    }
  }

  // Script- und Style-Bloecke herausnehmen, damit der Tag-Scan nicht in
  // JavaScript-Quelltext hineinlaeuft.
  const blocks: string[] = [];
  let working = html.replace(
    /<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>/gi,
    (block) => {
      const isStyle = /^<style/i.test(block);
      const openTagMatch = block.match(/^<[^>]*>/);
      const openTag = openTagMatch ? rewriteTag(openTagMatch[0], effectiveBase) : "";
      const closeIndex = block.lastIndexOf("<");
      const body = openTagMatch ? block.slice(openTagMatch[0].length, closeIndex) : "";
      const close = block.slice(closeIndex);
      const rebuilt = isStyle
        ? `${openTag}${rewriteCss(body, effectiveBase)}${close}`
        : `${openTag}${body}${close}`;
      blocks.push(rebuilt);
      return ` QABLOCK${blocks.length - 1}QABLOCK `;
    },
  );

  working = working
    // <base> entfernen: Der Proxy-Pfad spiegelt den Zielpfad bereits.
    .replace(/<base\b[^>]*>/gi, "")
    // CSP und Referrer-Policy wuerden Injection bzw. Referer-Fallback brechen.
    .replace(/<meta\b[^>]*http-equiv\s*=\s*["']?content-security-policy["']?[^>]*>/gi, "")
    .replace(/<meta\b[^>]*name\s*=\s*["']?referrer["']?[^>]*>/gi, "");

  working = working.replace(/<[a-zA-Z!/][^>]*>/g, (tag) => rewriteTag(tag, effectiveBase));

  // Meta-Refresh auf den Proxy umbiegen.
  working = working.replace(
    /(<meta\b[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*content\s*=\s*")([^"]*)(")/gi,
    (match, prefix: string, content: string, suffix: string) => {
      const rewritten = content.replace(
        /url\s*=\s*(.+)$/i,
        (m, url: string) => `url=${resolveToProxy(url.trim(), effectiveBase)}`,
      );
      return `${prefix}${rewritten}${suffix}`;
    },
  );

  working = working.replace(/ QABLOCK(\d+)QABLOCK /g, (match, index: string) => blocks[Number(index)]);

  // So frueh wie moeglich injizieren, damit Patches vor App-Code greifen.
  if (/<head[^>]*>/i.test(working)) {
    return working.replace(/<head[^>]*>/i, (tag) => `${tag}\n${injection}`);
  }
  if (/<html[^>]*>/i.test(working)) {
    return working.replace(/<html[^>]*>/i, (tag) => `${tag}\n<head>${injection}</head>`);
  }
  return `${injection}\n${working}`;
}
