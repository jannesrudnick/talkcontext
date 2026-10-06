/**
 * HTML/CSS rewriting for the frame proxy.
 *
 * Goal: the document is served from *our* origin so the recorder script has
 * full DOM access. So that the page still loads, all URLs are redirected
 * to the proxy.
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

/** Rewrite attributes within a single tag. */
function rewriteTag(tag: string, baseUrl: string): string {
  let result = tag
    // Subresource integrity no longer matches after rewriting.
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

  // Inline styles can contain url(...).
  result = result.replace(/(\sstyle\s*=\s*)("[^"]*"|'[^']*')/gi, (match, prefix: string, quoted: string) => {
    const quote = quoted[0];
    const value = quoted.slice(1, -1);
    return `${prefix}${quote}${rewriteCss(value, baseUrl)}${quote}`;
  });

  return result;
}

interface RewriteOptions {
  /** Real URL of the document - base for relative URLs. */
  baseUrl: string;
  /** Markup that is injected into the <head> as early as possible. */
  injection: string;
}

export function rewriteHtml(html: string, options: RewriteOptions): string {
  const { baseUrl, injection } = options;

  // An existing <base href> changes how relative URLs resolve.
  const baseMatch = html.match(/<base[^>]+href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
  let effectiveBase = baseUrl;
  if (baseMatch) {
    const raw = baseMatch[1] ?? baseMatch[2] ?? baseMatch[3];
    try {
      effectiveBase = new URL(raw, baseUrl).toString();
    } catch {
      /* invalid base - keep the document URL */
    }
  }

  // Take out script and style blocks so the tag scan doesn't run into
  // JavaScript source code.
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
    // Remove <base>: the proxy path already mirrors the target path.
    .replace(/<base\b[^>]*>/gi, "")
    // CSP and referrer policy would break injection and the referer fallback, respectively.
    .replace(/<meta\b[^>]*http-equiv\s*=\s*["']?content-security-policy["']?[^>]*>/gi, "")
    .replace(/<meta\b[^>]*name\s*=\s*["']?referrer["']?[^>]*>/gi, "");

  working = working.replace(/<[a-zA-Z!/][^>]*>/g, (tag) => rewriteTag(tag, effectiveBase));

  // Redirect meta refresh to the proxy.
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

  // Inject as early as possible so patches take effect before app code.
  if (/<head[^>]*>/i.test(working)) {
    return working.replace(/<head[^>]*>/i, (tag) => `${tag}\n${injection}`);
  }
  if (/<html[^>]*>/i.test(working)) {
    return working.replace(/<html[^>]*>/i, (tag) => `${tag}\n<head>${injection}</head>`);
  }
  return `${injection}\n${working}`;
}
