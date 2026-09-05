/**
 * QA-Recorder - laeuft im Dokument der Zielseite und meldet semantische
 * Interaktionen (Hover, Klick, Eingabe, Navigation, DOM-Wirkung) per
 * postMessage an das QA-Studio im Parent-Fenster.
 *
 * Zwei Betriebsarten:
 *   proxy  - vom Frame-Proxy in die Seite injiziert (kein Eingriff im Zielprojekt)
 *   bridge - vom Zielprojekt selbst eingebunden: <script src=".../qa-recorder.js"></script>
 */
(function () {
  "use strict";

  if (window.__qaRecorderLoaded) return;
  window.__qaRecorderLoaded = true;
  if (window.parent === window) {
    // Ohne Parent-Fenster gibt es niemanden, der zuhoert.
    return;
  }

  var script = document.currentScript;
  var dataset = (script && script.dataset) || {};
  var MODE = dataset.qaMode || "bridge";
  // Im Proxy-Modus liegt das Dokument auf der Origin des Studios - die ist
  // damit auch das exakte Ziel fuer postMessage.
  var PARENT_ORIGIN = MODE === "proxy" ? location.origin : dataset.qaOrigin || "*";
  var PROXY_PREFIX = "/p/";

  var config = {
    highlight: true,
    hoverDwellMs: 400,
    captureHtml: true,
    captureInputValues: true,
    captureConsole: true,
    captureNetwork: true,
  };

  var recording = MODE === "proxy" || dataset.qaAutostart === "true";
  var queue = [];
  var cursorQueue = [];
  var flushTimer = null;
  var seq = 0;

  /* ---------------------------------------------------------------- Utils */

  function uid() {
    seq += 1;
    return "e" + Date.now().toString(36) + "-" + seq.toString(36);
  }

  function post(message) {
    try {
      window.parent.postMessage(message, PARENT_ORIGIN);
    } catch (err) {
      /* Parent weg oder Origin-Mismatch - Aufnahme darf die Seite nie brechen. */
    }
  }

  function b64urlDecode(value) {
    try {
      var padded = value.replace(/-/g, "+").replace(/_/g, "/");
      return atob(padded + "===".slice((padded.length + 3) % 4));
    } catch (err) {
      return null;
    }
  }

  /** Loest ausschliesslich /p/<token>/... auf. */
  function deproxyStrict(rawUrl) {
    if (!rawUrl) return rawUrl;
    var url;
    try {
      url = new URL(rawUrl, location.href);
    } catch (err) {
      return rawUrl;
    }
    if (url.origin !== location.origin || url.pathname.indexOf(PROXY_PREFIX) !== 0) {
      return url.href;
    }
    var rest = url.pathname.slice(PROXY_PREFIX.length);
    var slash = rest.indexOf("/");
    var token = slash === -1 ? rest : rest.slice(0, slash);
    var path = slash === -1 ? "/" : rest.slice(slash);
    var origin = b64urlDecode(token);
    if (!origin) return url.href;
    return origin + path + url.search + url.hash;
  }

  function currentUrl() {
    return MODE === "proxy" ? deproxyStrict(location.href) : location.href;
  }

  /** Reale Origin des aktuellen Dokuments (im Proxy-Modus die des Ziels). */
  function documentOrigin() {
    try {
      return new URL(currentUrl()).origin;
    } catch (err) {
      return location.origin;
    }
  }

  /**
   * Proxy-URL -> reale Ziel-URL. Wurzel-relative Requests der Zielseite landen
   * ohne Token auf unserer Origin (der Referer-Fallback biegt sie serverseitig
   * um) - fuer das Protokoll rechnen wir sie auf die Zielorigin zurueck.
   */
  function deproxy(rawUrl) {
    var resolved = deproxyStrict(rawUrl);
    if (MODE !== "proxy" || !resolved) return resolved;
    var url;
    try {
      url = new URL(resolved, location.href);
    } catch (err) {
      return resolved;
    }
    if (url.origin !== location.origin) return url.href;
    return documentOrigin() + url.pathname + url.search + url.hash;
  }

  function truncate(value, max) {
    if (value == null) return undefined;
    var text = String(value).replace(/\s+/g, " ").trim();
    if (!text) return undefined;
    return text.length > max ? text.slice(0, max) + "\u2026" : text;
  }

  function esc(value) {
    if (window.CSS && CSS.escape) return CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  function attrValue(value) {
    return String(value).replace(/(["\\])/g, "\\$1");
  }

  function isUnique(selector) {
    try {
      return document.querySelectorAll(selector).length === 1;
    } catch (err) {
      return false;
    }
  }

  /* --------------------------------------------------- Element-Beschreibung */

  var TEST_ATTRS = ["data-testid", "data-test-id", "data-test", "data-qa", "data-cy", "data-pw"];

  // Klassen aus Utility-Frameworks und Build-Hashes taugen nicht als Identitaet.
  var NOISY_CLASS =
    /^(?:[a-z-]+:)?(?:flex|grid|block|inline|hidden|contents|table|absolute|relative|fixed|sticky|static|isolate|container|p[xytrbl]?-|m[xytrbl]?-|-m|w-|h-|min-|max-|size-|text-|bg-|from-|via-|to-|border|rounded|gap-|space-|items-|justify-|self-|place-|content-|order-|col-|row-|shadow|ring|opacity-|font-|leading-|tracking-|whitespace|truncate|overflow|object-|z-|top-|left-|right-|bottom-|inset-|translate|rotate|scale-|transform|transition|duration-|ease-|delay-|animate-|cursor-|select-|pointer-events|outline|underline|uppercase|lowercase|capitalize|antialiased|backdrop|filter|blur|list-|divide-|aspect-|basis-|grow|shrink|float-|clear-|align-|sr-only|group|peer)/;
  var HASHED_CLASS = /(?:^|[_-])[a-z0-9]{5,}$/i;

  function stableClasses(el) {
    var list = [];
    var classes = (el.getAttribute("class") || "").split(/\s+/);
    for (var i = 0; i < classes.length && list.length < 2; i++) {
      var name = classes[i];
      if (!name || name.length > 40) continue;
      if (NOISY_CLASS.test(name)) continue;
      if (HASHED_CLASS.test(name) && !/^[a-z-]+$/i.test(name)) continue;
      list.push(name);
    }
    return list;
  }

  function selectorFor(el) {
    if (!el || el.nodeType !== 1) return "";
    if (el === document.body) return "body";
    if (el === document.documentElement) return "html";

    for (var i = 0; i < TEST_ATTRS.length; i++) {
      var value = el.getAttribute(TEST_ATTRS[i]);
      if (value) {
        var testSel = "[" + TEST_ATTRS[i] + '="' + attrValue(value) + '"]';
        if (isUnique(testSel)) return testSel;
      }
    }
    if (el.id && isUnique("#" + esc(el.id))) return "#" + esc(el.id);

    var tag = el.tagName.toLowerCase();
    var label = el.getAttribute("aria-label");
    if (label) {
      var labelSel = tag + '[aria-label="' + attrValue(label) + '"]';
      if (isUnique(labelSel)) return labelSel;
    }
    var nameAttr = el.getAttribute("name");
    if (nameAttr) {
      var nameSel = tag + '[name="' + attrValue(nameAttr) + '"]';
      if (isUnique(nameSel)) return nameSel;
    }

    var parts = [];
    var node = el;
    while (node && node.nodeType === 1 && parts.length < 6) {
      if (node.id && isUnique("#" + esc(node.id))) {
        parts.unshift("#" + esc(node.id));
        break;
      }
      var part = node.tagName.toLowerCase();
      var classes = stableClasses(node);
      if (classes.length) part += "." + classes.map(esc).join(".");
      var parent = node.parentElement;
      if (parent) {
        var siblings = [];
        for (var c = 0; c < parent.children.length; c++) {
          if (parent.children[c].tagName === node.tagName) siblings.push(parent.children[c]);
        }
        if (siblings.length > 1) part += ":nth-of-type(" + (siblings.indexOf(node) + 1) + ")";
      }
      parts.unshift(part);
      if (node === document.body) break;
      node = node.parentElement;
    }
    return parts.join(" > ");
  }

  function xpathFor(el) {
    if (!el || el.nodeType !== 1) return "";
    if (el.id) return '//*[@id="' + el.id + '"]';
    var parts = [];
    var node = el;
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      var index = 1;
      var sibling = node.previousElementSibling;
      while (sibling) {
        if (sibling.tagName === node.tagName) index++;
        sibling = sibling.previousElementSibling;
      }
      parts.unshift(node.tagName.toLowerCase() + "[" + index + "]");
      node = node.parentElement;
    }
    return "/html/" + parts.join("/");
  }

  function accessibleName(el) {
    var label = el.getAttribute("aria-label");
    if (label) return truncate(label, 120);
    var labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      var referenced = document.getElementById(labelledBy.split(/\s+/)[0]);
      if (referenced) return truncate(referenced.textContent, 120);
    }
    if (el.id) {
      var forLabel = document.querySelector('label[for="' + attrValue(el.id) + '"]');
      if (forLabel) return truncate(forLabel.textContent, 120);
    }
    var closestLabel = el.closest && el.closest("label");
    if (closestLabel) return truncate(closestLabel.textContent, 120);
    var alt = el.getAttribute("alt");
    if (alt) return truncate(alt, 120);
    var title = el.getAttribute("title");
    if (title) return truncate(title, 120);
    var placeholder = el.getAttribute("placeholder");
    if (placeholder) return truncate(placeholder, 120);
    // Bei Formularfeldern waere der Textinhalt (z.B. alle <option>) irrefuehrend.
    if (/^(select|input|textarea)$/i.test(el.tagName)) return undefined;
    return truncate(el.textContent, 120);
  }

  var KEEP_ATTRS = [
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

  function describe(el, options) {
    if (!el || el.nodeType !== 1) return undefined;
    var opts = options || {};
    var rect = null;
    try {
      rect = el.getBoundingClientRect();
    } catch (err) {
      rect = null;
    }

    var attrs = {};
    for (var i = 0; i < KEEP_ATTRS.length; i++) {
      var key = KEEP_ATTRS[i];
      if (el.hasAttribute && el.hasAttribute(key)) {
        var raw = el.getAttribute(key);
        if (key === "value" && isSecret(el)) raw = "***";
        if (key === "href") raw = deproxy(raw);
        attrs[key] = truncate(raw, 200) || "";
      }
    }

    var ancestors = [];
    var parent = el.parentElement;
    while (parent && parent !== document.body && ancestors.length < 4) {
      var label = parent.tagName.toLowerCase();
      if (parent.id) label += "#" + parent.id;
      else {
        var role = parent.getAttribute("role");
        if (role) label += "[role=" + role + "]";
        else {
          var classes = stableClasses(parent);
          if (classes.length) label += "." + classes[0];
        }
      }
      ancestors.unshift(label);
      parent = parent.parentElement;
    }

    var ref = {
      selector: selectorFor(el),
      xpath: xpathFor(el),
      tag: el.tagName.toLowerCase(),
      path: ancestors,
    };
    if (el.id) ref.id = el.id;
    var classes = stableClasses(el);
    if (classes.length) ref.classes = classes;
    var explicitRole = el.getAttribute("role");
    if (explicitRole) ref.role = explicitRole;
    else {
      var implicit = implicitRole(el);
      if (implicit) ref.role = implicit;
    }
    var name = accessibleName(el);
    if (name) ref.name = name;
    // Bei Formularfeldern ist der Textinhalt (alle <option>) kein Label.
    var text = /^(select|input|textarea)$/i.test(el.tagName) ? undefined : truncate(el.textContent, 160);
    if (text && text !== name) ref.text = text;
    if (Object.keys(attrs).length) ref.attrs = attrs;
    if (rect) {
      ref.rect = {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
      };
    }
    if (config.captureHtml && opts.html !== false) {
      var html = el.outerHTML;
      if (html) {
        if (MODE === "proxy") {
          html = html.replace(/(["'(])\/p\/[A-Za-z0-9_-]+(\/[^"')\s]*)/g, function (match, quote, path) {
            return quote + documentOrigin() + path;
          });
        }
        ref.html = html.length > 600 ? html.slice(0, 600) + "\u2026" : html;
      }
    }
    if (opts.leaf && opts.leaf !== el) {
      ref.leaf = opts.leaf.tagName.toLowerCase() + (opts.leaf.id ? "#" + opts.leaf.id : "");
    }
    return ref;
  }

  function implicitRole(el) {
    var tag = el.tagName.toLowerCase();
    if (tag === "a") return el.hasAttribute("href") ? "link" : undefined;
    if (tag === "button") return "button";
    if (tag === "input") {
      var type = (el.getAttribute("type") || "text").toLowerCase();
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (type === "submit" || type === "button") return "button";
      return "textbox";
    }
    if (tag === "select") return "combobox";
    if (tag === "textarea") return "textbox";
    if (tag === "img") return "img";
    if (tag === "nav") return "navigation";
    if (tag === "main") return "main";
    if (tag === "header") return "banner";
    if (tag === "footer") return "contentinfo";
    if (tag === "dialog") return "dialog";
    if (/^h[1-6]$/.test(tag)) return "heading";
    return undefined;
  }

  var INTERACTIVE =
    'a,button,input,select,textarea,summary,label,[role],[onclick],[tabindex],[contenteditable="true"],[data-testid],[data-qa],[data-cy]';

  /** Hover auf einem <span> im Button soll den Button melden, nicht den Span. */
  function meaningful(el) {
    if (!el || el.nodeType !== 1) return el;
    var candidate = el.closest && el.closest(INTERACTIVE);
    if (!candidate) return el;
    var depth = 0;
    var node = el;
    while (node && node !== candidate && depth <= 4) {
      node = node.parentElement;
      depth++;
    }
    return node === candidate ? candidate : el;
  }

  function isSecret(el) {
    if (!el || !el.getAttribute) return false;
    var type = (el.getAttribute("type") || "").toLowerCase();
    if (type === "password") return true;
    if (el.hasAttribute("data-qa-secret")) return true;
    var name = (el.getAttribute("name") || "") + " " + (el.getAttribute("autocomplete") || "");
    return /pass|secret|token|otp|cvc|card/i.test(name);
  }

  /* ------------------------------------------------------------- Reporting */

  function emit(type, payload) {
    if (!recording) return null;
    var event = {
      id: uid(),
      ts: Date.now(),
      type: type,
      url: currentUrl(),
    };
    if (payload) {
      if (payload.target) event.target = payload.target;
      if (payload.detail) event.detail = payload.detail;
    }
    queue.push(event);
    scheduleFlush();
    return event;
  }

  function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(flush, 250);
  }

  function flush() {
    flushTimer = null;
    if (queue.length) {
      post({ source: "qa-recorder", type: "events", events: queue });
      queue = [];
    }
    if (cursorQueue.length) {
      post({ source: "qa-recorder", type: "cursor", samples: cursorQueue });
      cursorQueue = [];
    }
  }

  /* --------------------------------------------------------- DOM-Wirkung */

  var DIALOG_SELECTOR = '[role="dialog"],[role="alertdialog"],dialog[open],[aria-modal="true"]';

  /** Beobachtet 700ms nach einer Interaktion, was sich im DOM getan hat. */
  function observeEffect(eventId) {
    var urlBefore = currentUrl();
    var added = 0;
    var removed = 0;
    var dialogOpened = false;
    var alertText;
    var newTexts = [];
    var attrChanges = [];

    var observer = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var mutation = mutations[i];
        if (mutation.type === "childList") {
          for (var a = 0; a < mutation.addedNodes.length; a++) {
            var node = mutation.addedNodes[a];
            if (node.nodeType !== 1) continue;
            added++;
            if (node.matches && node.matches(DIALOG_SELECTOR)) dialogOpened = true;
            else if (node.querySelector && node.querySelector(DIALOG_SELECTOR)) dialogOpened = true;
            if (!alertText && node.matches && node.matches('[role="alert"],[role="status"],.error,.toast')) {
              alertText = truncate(node.textContent, 200);
            }
            if (newTexts.length < 4) {
              var text = truncate(node.textContent, 120);
              if (text) newTexts.push(text);
            }
          }
          removed += mutation.removedNodes.length;
        } else if (mutation.type === "attributes" && attrChanges.length < 5 && mutation.target.nodeType === 1) {
          attrChanges.push({
            selector: selectorFor(mutation.target),
            attr: mutation.attributeName,
            value: truncate(mutation.target.getAttribute(mutation.attributeName), 80) || null,
          });
        }
      }
    });

    try {
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class", "hidden", "open", "disabled", "aria-expanded", "aria-hidden", "aria-selected", "data-state"],
      });
    } catch (err) {
      return;
    }

    setTimeout(function () {
      observer.disconnect();
      var effect = {};
      var urlAfter = currentUrl();
      if (urlAfter !== urlBefore) effect.urlChanged = { from: urlBefore, to: urlAfter };
      if (added) effect.added = added;
      if (removed) effect.removed = removed;
      if (dialogOpened) effect.dialogOpened = true;
      if (alertText) effect.alert = alertText;
      if (newTexts.length) effect.newText = truncate(newTexts.join(" | "), 240);
      if (attrChanges.length) effect.attrChanges = attrChanges;
      if (Object.keys(effect).length) {
        post({ source: "qa-recorder", type: "effect", id: eventId, effect: effect });
      }
    }, 700);
  }

  /* ---------------------------------------------------------------- Overlay */

  var overlay = null;
  var overlayLabel = null;

  function ensureOverlay() {
    if (overlay || !document.body) return overlay;
    overlay = document.createElement("div");
    overlay.setAttribute("data-qa-overlay", "");
    overlay.style.cssText = [
      "position:fixed",
      "z-index:2147483646",
      "pointer-events:none",
      "border:2px solid rgba(56,189,248,.9)",
      "border-radius:4px",
      "background:rgba(56,189,248,.12)",
      "transition:all .06s linear",
      "display:none",
    ].join(";");
    overlayLabel = document.createElement("div");
    overlayLabel.style.cssText = [
      "position:absolute",
      "top:-20px",
      "left:-2px",
      "font:11px/16px ui-monospace,SFMono-Regular,Menlo,monospace",
      "color:#0b1220",
      "background:rgba(56,189,248,.95)",
      "padding:1px 5px",
      "border-radius:3px",
      "white-space:nowrap",
      "max-width:60vw",
      "overflow:hidden",
      "text-overflow:ellipsis",
    ].join(";");
    overlay.appendChild(overlayLabel);
    document.body.appendChild(overlay);
    return overlay;
  }

  function paintOverlay(el) {
    if (!config.highlight || !recording) {
      if (overlay) overlay.style.display = "none";
      return;
    }
    var box = ensureOverlay();
    if (!box || !el || !el.getBoundingClientRect) return;
    var rect = el.getBoundingClientRect();
    if (!rect.width && !rect.height) {
      box.style.display = "none";
      return;
    }
    box.style.display = "block";
    box.style.left = rect.left + "px";
    box.style.top = rect.top + "px";
    box.style.width = rect.width + "px";
    box.style.height = rect.height + "px";
    overlayLabel.textContent = el.tagName.toLowerCase() + (el.id ? "#" + el.id : "");
  }

  /* ----------------------------------------------------------- Interaktion */

  var hoverEl = null;
  var hoverStart = 0;
  var hoverTimer = null;
  var hoverReported = false;
  var lastCursorSample = 0;
  var lastPointer = { x: 0, y: 0 };

  function closeHover() {
    if (hoverEl && hoverReported) {
      var duration = Date.now() - hoverStart;
      emit("hover", {
        target: describe(hoverEl, { html: false }),
        detail: { durationMs: duration, phase: "end" },
      });
    }
    if (hoverTimer) clearTimeout(hoverTimer);
    hoverTimer = null;
    hoverEl = null;
    hoverReported = false;
  }

  function onPointerMove(event) {
    lastPointer = { x: Math.round(event.clientX), y: Math.round(event.clientY) };
    var now = Date.now();
    if (recording && now - lastCursorSample > 120) {
      lastCursorSample = now;
      cursorQueue.push({ ts: now, x: lastPointer.x, y: lastPointer.y });
      if (cursorQueue.length > 40) flush();
      else scheduleFlush();
    }

    var raw = event.target;
    if (!raw || raw.nodeType !== 1 || raw.hasAttribute("data-qa-overlay")) return;
    var el = meaningful(raw);
    if (el === hoverEl) return;

    closeHover();
    hoverEl = el;
    hoverStart = now;
    paintOverlay(el);
    hoverTimer = setTimeout(function () {
      if (hoverEl !== el) return;
      hoverReported = true;
      emit("hover", {
        target: describe(el, { leaf: raw }),
        detail: { phase: "start", x: lastPointer.x, y: lastPointer.y },
      });
    }, config.hoverDwellMs);
  }

  function pointerDetail(event, el) {
    var rect = el && el.getBoundingClientRect ? el.getBoundingClientRect() : null;
    var detail = {
      button: event.button,
      x: Math.round(event.clientX),
      y: Math.round(event.clientY),
    };
    if (rect && rect.width && rect.height) {
      detail.offset = {
        x: Math.round(((event.clientX - rect.left) / rect.width) * 100) / 100,
        y: Math.round(((event.clientY - rect.top) / rect.height) * 100) / 100,
      };
    }
    var modifiers = [];
    if (event.ctrlKey) modifiers.push("Ctrl");
    if (event.metaKey) modifiers.push("Meta");
    if (event.shiftKey) modifiers.push("Shift");
    if (event.altKey) modifiers.push("Alt");
    if (modifiers.length) detail.modifiers = modifiers;
    return detail;
  }

  function onClick(event) {
    var raw = event.target;
    if (!raw || raw.nodeType !== 1) return;
    var el = meaningful(raw);
    var qaEvent = emit("click", {
      target: describe(el, { leaf: raw }),
      detail: pointerDetail(event, el),
    });
    if (qaEvent) observeEffect(qaEvent.id);
  }

  function onDoubleClick(event) {
    var el = meaningful(event.target);
    emit("dblclick", { target: describe(el), detail: pointerDetail(event, el) });
  }

  function onContextMenu(event) {
    var el = meaningful(event.target);
    emit("contextmenu", { target: describe(el), detail: pointerDetail(event, el) });
  }

  var inputTimers = new WeakMap();

  function onInput(event) {
    var el = event.target;
    if (!el || el.nodeType !== 1) return;
    // Auswahlfelder meldet onChange - sonst stuende jede Auswahl doppelt im Log.
    if (el.tagName === "SELECT") return;
    var pending = inputTimers.get(el);
    if (pending) clearTimeout(pending);
    inputTimers.set(
      el,
      setTimeout(function () {
        inputTimers.delete(el);
        var secret = isSecret(el);
        var value = el.isContentEditable ? el.textContent : el.value;
        var detail = { length: value ? String(value).length : 0 };
        if (secret) detail.value = "***";
        else if (config.captureInputValues) detail.value = truncate(value, 200) || "";
        if (el.type === "checkbox" || el.type === "radio") detail.checked = !!el.checked;
        emit("input", { target: describe(el, { html: false }), detail: detail });
      }, 450)
    );
  }

  function onChange(event) {
    var el = event.target;
    if (!el || el.tagName !== "SELECT") return;
    var option = el.options && el.options[el.selectedIndex];
    emit("change", {
      target: describe(el, { html: false }),
      detail: {
        value: isSecret(el) ? "***" : truncate(el.value, 120),
        label: option ? truncate(option.textContent, 120) : undefined,
      },
    });
  }

  var TRACKED_KEYS = ["Enter", "Escape", "Tab", "Backspace", "Delete", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];

  function onKeyDown(event) {
    var combo = event.ctrlKey || event.metaKey;
    if (TRACKED_KEYS.indexOf(event.key) === -1 && !combo) return;
    if (combo && event.key.length > 1 && TRACKED_KEYS.indexOf(event.key) === -1) return;
    var keys = [];
    if (event.ctrlKey) keys.push("Ctrl");
    if (event.metaKey) keys.push("Meta");
    if (event.shiftKey) keys.push("Shift");
    if (event.altKey) keys.push("Alt");
    keys.push(event.key);
    emit("key", {
      target: describe(event.target, { html: false }),
      detail: { key: keys.join("+") },
    });
  }

  function onSubmit(event) {
    var form = event.target;
    var qaEvent = emit("submit", {
      target: describe(form, { html: false }),
      detail: { action: deproxy(form.getAttribute("action") || location.href), method: (form.getAttribute("method") || "get").toUpperCase() },
    });
    if (qaEvent) observeEffect(qaEvent.id);
  }

  var scrollTimer = null;

  function onScroll(event) {
    if (scrollTimer) clearTimeout(scrollTimer);
    var node = event.target === document || event.target === document.documentElement ? null : event.target;
    scrollTimer = setTimeout(function () {
      scrollTimer = null;
      var detail = node
        ? { scope: "element", top: Math.round(node.scrollTop), left: Math.round(node.scrollLeft) }
        : {
            scope: "page",
            top: Math.round(window.scrollY),
            left: Math.round(window.scrollX),
            percent: Math.round(
              (window.scrollY / Math.max(1, document.documentElement.scrollHeight - window.innerHeight)) * 100
            ),
          };
      emit("scroll", {
        target: node ? describe(node, { html: false }) : undefined,
        detail: detail,
      });
    }, 300);
  }

  function onSelection() {
    var selection = window.getSelection && window.getSelection();
    if (!selection || selection.isCollapsed) return;
    var text = truncate(selection.toString(), 240);
    if (!text || text.length < 3) return;
    var anchor = selection.anchorNode;
    var el = anchor && anchor.nodeType === 1 ? anchor : anchor && anchor.parentElement;
    emit("select", { target: el ? describe(el, { html: false }) : undefined, detail: { text: text } });
  }

  function onResize() {
    emit("resize", { detail: { width: window.innerWidth, height: window.innerHeight } });
  }

  /* -------------------------------------------------- Navigation & Diagnose */

  var lastUrl = currentUrl();

  function checkNavigation(kind) {
    var next = currentUrl();
    if (next === lastUrl) return;
    var from = lastUrl;
    lastUrl = next;
    emit("navigate", { detail: { from: from, to: next, kind: kind } });
  }

  function patchHistory() {
    ["pushState", "replaceState"].forEach(function (name) {
      var original = history[name];
      if (typeof original !== "function") return;
      history[name] = function () {
        var result = original.apply(this, arguments);
        setTimeout(function () {
          checkNavigation(name === "pushState" ? "push" : "replace");
        }, 0);
        return result;
      };
    });
    window.addEventListener("popstate", function () {
      checkNavigation("popstate");
    });
    window.addEventListener("hashchange", function () {
      checkNavigation("hash");
    });
  }

  function patchConsole() {
    ["error", "warn"].forEach(function (level) {
      var original = console[level];
      console[level] = function () {
        if (config.captureConsole) {
          var parts = [];
          for (var i = 0; i < arguments.length && i < 4; i++) {
            var arg = arguments[i];
            try {
              parts.push(typeof arg === "string" ? arg : arg && arg.message ? arg.message : JSON.stringify(arg));
            } catch (err) {
              parts.push(String(arg));
            }
          }
          emit("console", { detail: { level: level, message: truncate(parts.join(" "), 300) } });
        }
        return original.apply(console, arguments);
      };
    });
    window.addEventListener("error", function (event) {
      if (!config.captureConsole) return;
      emit("console", {
        detail: { level: "error", message: truncate(event.message, 300), source: deproxy(event.filename || ""), line: event.lineno },
      });
    });
    window.addEventListener("unhandledrejection", function (event) {
      if (!config.captureConsole) return;
      var reason = event.reason;
      emit("console", {
        detail: { level: "error", message: truncate(reason && reason.message ? reason.message : String(reason), 300), source: "unhandledrejection" },
      });
    });
  }

  function patchNetwork() {
    var originalFetch = window.fetch;
    if (typeof originalFetch === "function") {
      window.fetch = function (input, init) {
        var started = Date.now();
        var url = typeof input === "string" ? input : input && input.url;
        var method = (init && init.method) || (input && input.method) || "GET";
        return originalFetch.apply(this, arguments).then(
          function (response) {
            if (config.captureNetwork && response && response.status >= 400) {
              emit("network", {
                detail: {
                  method: String(method).toUpperCase(),
                  url: deproxy(url),
                  status: response.status,
                  durationMs: Date.now() - started,
                },
              });
            }
            return response;
          },
          function (error) {
            if (config.captureNetwork) {
              emit("network", {
                detail: {
                  method: String(method).toUpperCase(),
                  url: deproxy(url),
                  status: 0,
                  error: truncate(error && error.message, 200),
                  durationMs: Date.now() - started,
                },
              });
            }
            throw error;
          }
        );
      };
    }

    var open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
      this.__qaMethod = method;
      this.__qaUrl = url;
      return open.apply(this, arguments);
    };
    var send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function () {
      var xhr = this;
      var started = Date.now();
      xhr.addEventListener("loadend", function () {
        if (!config.captureNetwork) return;
        if (xhr.status && xhr.status < 400) return;
        emit("network", {
          detail: {
            method: String(xhr.__qaMethod || "GET").toUpperCase(),
            url: deproxy(xhr.__qaUrl),
            status: xhr.status,
            durationMs: Date.now() - started,
          },
        });
      });
      return send.apply(this, arguments);
    };
  }

  /* ------------------------------------------------------------- Steuerung */

  function applyConfig(next) {
    if (!next) return;
    Object.keys(next).forEach(function (key) {
      if (key in config) config[key] = next[key];
    });
    if (!config.highlight && overlay) overlay.style.display = "none";
  }

  window.addEventListener("message", function (event) {
    var data = event.data;
    if (!data || data.source !== "qa-studio") return;
    if (data.type === "start") {
      recording = true;
      lastUrl = currentUrl();
    } else if (data.type === "stop") {
      closeHover();
      recording = false;
      flush();
      if (overlay) overlay.style.display = "none";
    } else if (data.type === "config") {
      applyConfig(data.config);
    } else if (data.type === "highlight") {
      if (!data.selector) {
        if (overlay) overlay.style.display = "none";
        return;
      }
      try {
        var el = document.querySelector(data.selector);
        if (el) {
          el.scrollIntoView({ block: "center", behavior: "smooth" });
          paintOverlay(el);
        }
      } catch (err) {
        /* ungueltiger Selektor - ignorieren */
      }
    }
  });

  /* ------------------------------------------------------------------ Setup */

  function listen() {
    var opts = { capture: true, passive: true };
    document.addEventListener("pointermove", onPointerMove, opts);
    document.addEventListener("click", onClick, { capture: true });
    document.addEventListener("dblclick", onDoubleClick, opts);
    document.addEventListener("contextmenu", onContextMenu, opts);
    document.addEventListener("input", onInput, opts);
    document.addEventListener("change", onChange, opts);
    document.addEventListener("keydown", onKeyDown, opts);
    document.addEventListener("submit", onSubmit, { capture: true });
    document.addEventListener("scroll", onScroll, opts);
    document.addEventListener("mouseup", onSelection, opts);
    document.addEventListener("mouseleave", closeHover, opts);
    window.addEventListener("resize", onResize, { passive: true });
    window.addEventListener("pagehide", function () {
      closeHover();
      flush();
    });
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) {
        closeHover();
        flush();
      }
    });
  }

  patchHistory();
  patchConsole();
  patchNetwork();
  listen();

  function announce() {
    post({ source: "qa-recorder", type: "ready", url: currentUrl(), ts: Date.now(), mode: MODE });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", announce);
  } else {
    announce();
  }
})();
