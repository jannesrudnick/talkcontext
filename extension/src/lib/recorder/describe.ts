/**
 * Beschreibt ein DOM-Element so, dass ein Agent es ohne Screenshot wiederfindet:
 * stabiler Selektor, XPath, Rolle, Accessible Name, Attribute, gekuerztes HTML.
 *
 * Portiert aus `public/qa-recorder.js` der Next-App (ohne Proxy-Sonderfaelle).
 */
import type { ElementRef } from "@shared/types";

export function truncate(value: unknown, max: number): string | undefined {
  if (value == null) return undefined;
  const text = String(value).replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

const esc = (value: string) => CSS.escape(value);
const attrValue = (value: string) => value.replace(/(["\\])/g, "\\$1");

function isUnique(selector: string): boolean {
  try {
    return document.querySelectorAll(selector).length === 1;
  } catch {
    return false;
  }
}

const TEST_ATTRS = ["data-testid", "data-test-id", "data-test", "data-qa", "data-cy", "data-pw"];

// Klassen aus Utility-Frameworks und Build-Hashes taugen nicht als Identitaet.
const NOISY_CLASS =
  /^(?:[a-z-]+:)?(?:flex|grid|block|inline|hidden|contents|table|absolute|relative|fixed|sticky|static|isolate|container|p[xytrbl]?-|m[xytrbl]?-|-m|w-|h-|min-|max-|size-|text-|bg-|from-|via-|to-|border|rounded|gap-|space-|items-|justify-|self-|place-|content-|order-|col-|row-|shadow|ring|opacity-|font-|leading-|tracking-|whitespace|truncate|overflow|object-|z-|top-|left-|right-|bottom-|inset-|translate|rotate|scale-|transform|transition|duration-|ease-|delay-|animate-|cursor-|select-|pointer-events|outline|underline|uppercase|lowercase|capitalize|antialiased|backdrop|filter|blur|list-|divide-|aspect-|basis-|grow|shrink|float-|clear-|align-|sr-only|group|peer)/;
const HASHED_CLASS = /(?:^|[_-])[a-z0-9]{5,}$/i;

export function stableClasses(el: Element): string[] {
  const list: string[] = [];
  for (const name of (el.getAttribute("class") ?? "").split(/\s+/)) {
    if (list.length >= 2) break;
    if (!name || name.length > 40) continue;
    if (/[[\]:/%()]/.test(name)) continue;
    if (NOISY_CLASS.test(name)) continue;
    if (HASHED_CLASS.test(name) && !/^[a-z-]+$/i.test(name)) continue;
    list.push(name);
  }
  return list;
}

export function selectorFor(el: Element | null): string {
  if (!el || el.nodeType !== 1) return "";
  if (el === document.body) return "body";
  if (el === document.documentElement) return "html";

  for (const attr of TEST_ATTRS) {
    const value = el.getAttribute(attr);
    if (value) {
      const selector = `[${attr}="${attrValue(value)}"]`;
      if (isUnique(selector)) return selector;
    }
  }
  if (el.id && isUnique(`#${esc(el.id)}`)) return `#${esc(el.id)}`;

  const tag = el.tagName.toLowerCase();
  const label = el.getAttribute("aria-label");
  if (label) {
    const selector = `${tag}[aria-label="${attrValue(label)}"]`;
    if (isUnique(selector)) return selector;
  }
  const name = el.getAttribute("name");
  if (name) {
    const selector = `${tag}[name="${attrValue(name)}"]`;
    if (isUnique(selector)) return selector;
  }

  const parts: string[] = [];
  let node: Element | null = el;
  while (node && node.nodeType === 1 && parts.length < 6) {
    if (node.id && isUnique(`#${esc(node.id)}`)) {
      parts.unshift(`#${esc(node.id)}`);
      break;
    }
    let part = node.tagName.toLowerCase();
    const classes = stableClasses(node);
    if (classes.length) part += `.${classes.map(esc).join(".")}`;
    const parent: Element | null = node.parentElement;
    if (parent) {
      const current: Element = node;
      const siblings = Array.from(parent.children).filter((child) => child.tagName === current.tagName);
      if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
    }
    parts.unshift(part);
    if (node === document.body) break;
    node = parent;
  }
  return parts.join(" > ");
}

export function xpathFor(el: Element | null): string {
  if (!el || el.nodeType !== 1) return "";
  if (el.id) return `//*[@id="${el.id}"]`;
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && node.nodeType === 1 && node !== document.documentElement) {
    let index = 1;
    let sibling = node.previousElementSibling;
    while (sibling) {
      if (sibling.tagName === node.tagName) index++;
      sibling = sibling.previousElementSibling;
    }
    parts.unshift(`${node.tagName.toLowerCase()}[${index}]`);
    node = node.parentElement;
  }
  return `/html/${parts.join("/")}`;
}

function accessibleName(el: Element): string | undefined {
  const label = el.getAttribute("aria-label");
  if (label) return truncate(label, 120);
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const referenced = document.getElementById(labelledBy.split(/\s+/)[0] ?? "");
    if (referenced) return truncate(referenced.textContent, 120);
  }
  if (el.id) {
    const forLabel = document.querySelector(`label[for="${attrValue(el.id)}"]`);
    if (forLabel) return truncate(forLabel.textContent, 120);
  }
  const closestLabel = el.closest("label");
  if (closestLabel) return truncate(closestLabel.textContent, 120);
  for (const attr of ["alt", "title", "placeholder"]) {
    const value = el.getAttribute(attr);
    if (value) return truncate(value, 120);
  }
  // Bei Formularfeldern waere der Textinhalt (z.B. alle <option>) irrefuehrend.
  if (/^(select|input|textarea)$/i.test(el.tagName)) return undefined;
  return truncate(el.textContent, 120);
}

function implicitRole(el: Element): string | undefined {
  const tag = el.tagName.toLowerCase();
  if (tag === "a") return el.hasAttribute("href") ? "link" : undefined;
  if (tag === "button") return "button";
  if (tag === "input") {
    const type = (el.getAttribute("type") ?? "text").toLowerCase();
    if (type === "checkbox") return "checkbox";
    if (type === "radio") return "radio";
    if (type === "submit" || type === "button") return "button";
    return "textbox";
  }
  const map: Record<string, string> = {
    select: "combobox",
    textarea: "textbox",
    img: "img",
    nav: "navigation",
    main: "main",
    header: "banner",
    footer: "contentinfo",
    dialog: "dialog",
  };
  if (map[tag]) return map[tag];
  if (/^h[1-6]$/.test(tag)) return "heading";
  return undefined;
}

const KEEP_ATTRS = [
  "data-testid",
  "data-test-id",
  "data-qa",
  "data-cy",
  "aria-label",
  "aria-expanded",
  "aria-selected",
  "aria-checked",
  "aria-disabled",
  "role",
  "href",
  "type",
  "name",
  "placeholder",
  "value",
  "alt",
  "title",
  "disabled",
  "checked",
];

export function isSecret(el: Element | null): boolean {
  if (!el?.getAttribute) return false;
  const type = (el.getAttribute("type") ?? "").toLowerCase();
  if (type === "password") return true;
  if (el.hasAttribute("data-qa-secret")) return true;
  const name = `${el.getAttribute("name") ?? ""} ${el.getAttribute("autocomplete") ?? ""}`;
  return /pass|secret|token|otp|cvc|card/i.test(name);
}

const subtreeSize = (el: Element) => el.getElementsByTagName("*").length;

export interface DescribeOptions {
  html?: boolean;
  leaf?: Element;
  captureHtml: boolean;
}

export function describe(el: Element | null, options: DescribeOptions): ElementRef | undefined {
  if (!el || el.nodeType !== 1) return undefined;
  const size = subtreeSize(el);
  const rect = el.getBoundingClientRect();

  const attrs: Record<string, string> = {};
  for (const key of KEEP_ATTRS) {
    if (!el.hasAttribute(key)) continue;
    let raw = el.getAttribute(key);
    if (key === "value" && isSecret(el)) raw = "***";
    attrs[key] = truncate(raw, 200) ?? "";
  }

  const path: string[] = [];
  let parent = el.parentElement;
  while (parent && parent !== document.body && path.length < 4) {
    let label = parent.tagName.toLowerCase();
    if (parent.id) label += `#${parent.id}`;
    else {
      const role = parent.getAttribute("role");
      if (role) label += `[role=${role}]`;
      else {
        const classes = stableClasses(parent);
        if (classes.length) label += `.${classes[0]}`;
      }
    }
    path.unshift(label);
    parent = parent.parentElement;
  }

  const ref: ElementRef = { selector: selectorFor(el), xpath: xpathFor(el), tag: el.tagName.toLowerCase(), path };
  if (el.id) ref.id = el.id;
  const classes = stableClasses(el);
  if (classes.length) ref.classes = classes;
  const role = el.getAttribute("role") ?? implicitRole(el);
  if (role) ref.role = role;
  const name = accessibleName(el);
  if (name) ref.name = name;
  const text = /^(select|input|textarea)$/i.test(el.tagName) || size > 200 ? undefined : truncate(el.textContent, 160);
  if (text && text !== name) ref.text = text;
  if (Object.keys(attrs).length) ref.attrs = attrs;
  ref.rect = { x: Math.round(rect.left), y: Math.round(rect.top), w: Math.round(rect.width), h: Math.round(rect.height) };
  // outerHTML grosser Container kostet mehr, als das Snippet je wert waere.
  if (options.captureHtml && options.html !== false && size <= 60) {
    const html = el.outerHTML;
    if (html) ref.html = html.length > 600 ? `${html.slice(0, 600)}…` : html;
  }
  if (options.leaf && options.leaf !== el) {
    ref.leaf = options.leaf.tagName.toLowerCase() + (options.leaf.id ? `#${options.leaf.id}` : "");
  }
  return ref;
}

const INTERACTIVE =
  'a,button,input,select,textarea,summary,label,[role],[onclick],[tabindex],[contenteditable="true"],[data-testid],[data-qa],[data-cy]';

/** Hover auf einem <span> im Button soll den Button melden, nicht den Span. */
export function meaningful(el: Element): Element {
  const candidate = el.closest(INTERACTIVE);
  if (!candidate) return el;
  let node: Element | null = el;
  let depth = 0;
  while (node && node !== candidate && depth <= 4) {
    node = node.parentElement;
    depth++;
  }
  return node === candidate ? candidate : el;
}
