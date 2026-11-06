import ReactDOM from "react-dom/client";
import type { ContentScriptContext } from "wxt/utils/content-script-context";
import type { TabMessage } from "@/lib/messages";
import { RecordingController, OVERLAY_TAG } from "./controller";
import { Overlay } from "./overlay";
import { overlayStore } from "./store";
import { hello } from "./api";
import { openThread } from "./comments";
import "./overlay.css";

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_start",
  cssInjectionMode: "ui",

  async main(ctx) {
    const controller = new RecordingController();

    // Ask early: is a recording running in this tab (e.g. after navigation)?
    const initial = await hello();
    if (!initial) return;
    if (initial.recording) controller.injectMainWorld();
    overlayStore.setState({ tab: initial });

    await domReady();

    const ui = await createShadowRootUi(ctx, {
      name: OVERLAY_TAG,
      position: "overlay",
      zIndex: 2147483647,
      anchor: "html",
      append: "last",
      isolateEvents: ["keydown", "keyup", "keypress", "input", "beforeinput"],
      onMount(container) {
        const root = ReactDOM.createRoot(container);
        root.render(<Overlay controller={controller} />);
        return root;
      },
      onRemove(root) {
        root?.unmount();
      },
    });
    ui.mount();
    keepOnTop(ui.shadowHost, ctx);

    const sync = () => {
      const { tab } = overlayStore.getState();
      if (!tab) return;
      if (tab.recording && !tab.recording.stopping && !controller.isRunning) controller.start(tab.settings);
      if (!tab.recording && controller.isRunning) controller.stop();
    };
    overlayStore.subscribe(sync);
    sync();

    browser.runtime.onMessage.addListener((message: TabMessage) => {
      switch (message.type) {
        case "talkcontext:state":
          overlayStore.setState({ tab: message.state });
          break;
        case "talkcontext:toggle-overlay":
          overlayStore.getState().actions.toggleOverlay();
          break;
        case "talkcontext:toggle-recording":
          overlayStore.getState().actions.toggleRecording();
          break;
        case "talkcontext:audio-level":
          overlayStore.setState({ audioLevel: message.level });
          break;
        case "talkcontext:saved":
          overlayStore.setState({ savedId: message.recordingId });
          break;
        case "talkcontext:live":
          controller.onLive(message.event);
          break;
        case "talkcontext:open-thread": {
          const { tab, actions } = overlayStore.getState();
          if (tab && !tab.overlayVisible) actions.toggleOverlay();
          openThread(message.threadId);
          break;
        }
      }
      return undefined;
    });

    ctx.onInvalidated(() => controller.stop());
  },
});

/**
 * Page dialogs (showModal), popovers and fullscreen sit in the browser's top layer, above any z-index.
 * So the host is a manual popover itself and is re-shown on top whenever something else enters
 * the top layer. A modal dialog makes everything outside it inert -> while one is open, the host
 * moves into it (top-layer layout keeps the panel fixed to the viewport anyway).
 */
function keepOnTop(host: HTMLElement, ctx: ContentScriptContext) {
  if (!("showPopover" in host)) return;
  host.setAttribute("popover", "manual");

  const raise = () => {
    if (ctx.isInvalid) return;
    // ponytail: document order, not top-layer order - fine unless modals are stacked in reverse DOM order.
    const modal = Array.from(document.querySelectorAll("dialog:modal")).pop();
    const parent = modal ?? document.documentElement;
    if (host.parentNode !== parent) parent.append(host);
    try {
      if (host.matches(":popover-open")) host.hidePopover();
      host.showPopover();
    } catch {
      // Not connected or popover unsupported - stays a plain overlay.
    }
  };
  raise();

  ctx.addEventListener(window, "toggle", (event: Event) => {
    if (event.target !== host) queueMicrotask(raise);
  }, { capture: true });
  ctx.addEventListener(document, "fullscreenchange", raise);
  // Dialogs don't always fire "toggle"; a removed dialog would take the host with it.
  const observer = new MutationObserver((mutations) => {
    if (!host.isConnected || mutations.some((m) => m.type === "attributes")) raise();
  });
  observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["open"] });
  ctx.onInvalidated(() => observer.disconnect());
}

function domReady() {
  if (document.readyState !== "loading") return Promise.resolve();
  return new Promise<void>((resolve) => document.addEventListener("DOMContentLoaded", () => resolve(), { once: true }));
}
