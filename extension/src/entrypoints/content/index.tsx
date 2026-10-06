import ReactDOM from "react-dom/client";
import type { TabMessage } from "@/lib/messages";
import { RecordingController, OVERLAY_TAG } from "./controller";
import { Overlay } from "./overlay";
import { overlayStore } from "./store";
import { hello } from "./api";
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
      }
      return undefined;
    });

    ctx.onInvalidated(() => controller.stop());
  },
});

function domReady() {
  if (document.readyState !== "loading") return Promise.resolve();
  return new Promise<void>((resolve) => document.addEventListener("DOMContentLoaded", () => resolve(), { once: true }));
}
