# QA Recorder (web app)

Loom for coding agents. You load a website into an iframe, click through it and explain
out loud what you see. What comes out is **not a video** but a structured protocol: which
DOM element the mouse rested on, what was clicked, what changed in the DOM as a result —
plus the transcript of your explanation, on the same timeline.

So an agent doesn't have to interpret screenshots. It reads selectors.

```
- **[00:01.4]** CLICK on button "Save"
  - Selector: `[data-testid="save-btn"]`
  - Effect: Attributes: #result[hidden=null]
- **[00:01.4]** CONSOLE ERROR: Save failed: 500
- **[00:01.4]** REQUEST POST http://localhost:4321/api/save -> 501
- **[00:03.5]** SPOKEN: "all I get here is an error message without any context"
```

A complete example is in [`example-recording.md`](example-recording.md).

> **Note:** This is the predecessor of the [browser extension](../extension/README.md) and lives
> as a Next.js app in the repo root. For new work the extension is the way to go – no proxy, no
> script in the target project, plus replay, feedback points and handoff to Claude Code.
> This page only describes the web app.

## Getting started

```bash
npm install
npm run dev          # http://localhost:3000
```

Enter a URL (`localhost:3000`, `https://staging.example.com`), **Load**, **Record**,
click through, **Stop**, export.

> The *live* transcript during recording needs Chrome or Edge (Web Speech API).
> Independently of that, the audio track can be transcribed locally with Whisper in any
> browser after recording — see below.

## Why two modes

A normal cross-origin iframe is a black box to JavaScript: you learn neither where the
mouse is nor which element is underneath it. That's why there are two ways to get the
recorder *into* the target page:

| Mode       | Effort                          | When                                                       |
| ---------- | ------------------------------- | ---------------------------------------------------------- |
| **Proxy**  | none                            | Third-party sites, staging, anything you have no access to |
| **Bridge** | one `<script>` in the target project | Your own project — more accurate and without HTML rewriting |

### Proxy mode

The target page is served by this app via `/p/<base64url(origin)><path>`. All URLs are
rewritten to point at the proxy and `public/qa-recorder.js` is injected into the `<head>`.
Because the document then lives on *our* origin, the recorder has full DOM access.

What the proxy does for this:

- The target page's `X-Frame-Options`, CSP and `Referrer-Policy` are removed (otherwise no embedding)
- HTML attributes (`src`, `href`, `action`, `srcset`, …) and CSS `url()` are redirected to the proxy
- Cookies are rebound to our origin so logged-in flows work
- Root-relative URLs created only at runtime (`/_next/...`) are caught by `src/proxy.ts`
  via the referer and routed back into the proxy

Limits: pages with aggressive origin checks, service workers or WebSockets to their own
API may behave differently in the proxy than in the original. Use bridge mode then.

### Bridge mode

One line in your own dev build, after which the iframe loads the page directly:

```html
<script src="http://localhost:3000/qa-recorder.js" data-qa-mode="bridge"></script>
```

No rewriting, no cookie tricks, exactly the app as it is. The only requirement is that
the page may be embedded at all (dev servers usually allow that).

## Transcription

Two ways, both without an API key:

| | Live transcript | Local Whisper |
| --- | --- | --- |
| When | during recording | after stopping, on demand |
| Technology | Web Speech API | `@huggingface/transformers` + ONNX, WebGPU with WASM fallback |
| Browser | Chrome, Edge | any with WebGPU or WASM |
| Quality | usable | much better, real timestamps per segment |
| Cost | Chrome sends audio to Google | nothing leaves your machine |

Whisper runs in a web worker so neither the model download nor inference blocks the UI.
Models (one-time download, then cached by the browser):

| Model | Download | Use for |
| --- | --- | --- |
| Tiny | 96 MB | quick check, keywords |
| Base | 146 MB | default, good compromise |
| Small | 325 MB | when every word matters |

On quantization: the `_quantized` and `int8` decoders from `onnx-community` can't be loaded
with the bundled onnxruntime-web (`Missing required scale ... MatMulNBits`).
Hence a q8 encoder plus q4 decoder — tested, works on WebGPU and WASM.

transformers.js would fetch the onnxruntime-web WASM runtime from a CDN at runtime.
For a tool that explicitly works locally that's the wrong dependency, so
`scripts/copy-ort-runtime.mjs` copies it from `node_modules` to `public/ort/` on
`install`/`dev`/`build` (around 74 MB, hence not in the repo).

## What gets recorded

| Event      | Content                                                                        |
| ---------- | ------------------------------------------------------------------------------ |
| `hover`    | Element after 400 ms dwell time, with the dwell time on leave                  |
| `click`    | Element, mouse button, hit point relative to the element, modifiers            |
| `input`    | Field and value (passwords and `data-qa-secret` always masked)                 |
| `change`   | Selection in `<select>` incl. label                                            |
| `key`      | Enter, Escape, Tab, arrows, Ctrl/Cmd combinations                              |
| `scroll`   | Page (in percent) or scrollable element                                        |
| `navigate` | Page changes incl. `pushState`/`popstate`                                      |
| `submit`   | Form, method, target                                                           |
| `console`  | `console.error`/`warn`, unhandled errors and promise rejections                |
| `network`  | Requests with status ≥ 400 or network errors                                   |
| `note`     | Manually added finding, attached to the last targeted element                  |

After each click the recorder watches the DOM for 700 ms and attaches the **effect** to
the event: added/removed nodes, opened dialogs, alert texts, changed attributes,
URL changes. That's the part that answers "what happened" for an agent.

Each element is described by: a stable selector (preferring `data-testid`, `#id`,
`[aria-label]`), XPath, role, accessible name, attributes, bounding box, ancestor chain
and truncated `outerHTML`. The mouse path is sampled separately at ~8 Hz so the
event log stays semantic.

What does **not** happen: no screenshots, no pixels. Everything is text.

## Export

- **Markdown** — the timeline above, ready to paste into an agent prompt
- **JSON** — complete data (`qa-recording/1`), including cursor path and transcript
- **Audio** — the audio track as `.webm`, in case it's needed
- **Save to `./qa-sessions`** — writes JSON + Markdown into the project directory
  so an agent can read the file straight from the file system

## Architecture

```
src/app/p/[...slug]/route.ts   Frame proxy: fetch, clean headers, rewrite HTML/CSS, inject
src/proxy.ts                   Referer fallback for root-relative requests from the frame
public/qa-recorder.js          Runs in the target page, reports events via postMessage
src/hooks/use-recorder.ts      Receives events, converts timestamps relative to session start
src/hooks/use-narration.ts     Microphone (MediaRecorder) + live transcript (Web Speech API)
src/lib/qa/whisper.worker.ts   Local Whisper transcription in a web worker
src/hooks/use-transcription.ts Audio decode to 16 kHz mono, progress, worker control
src/lib/qa/export.ts           Markdown and JSON artifact
src/components/qa/studio.tsx   UI
```

## Privacy

The proxy rebinds the target page's cookies to this app's origin — handy for logged-in
QA, but this is a local tool: don't deploy it publicly. Input values can be turned off
entirely in the Setup tab; password fields and anything with `data-qa-secret` are always
masked anyway.
