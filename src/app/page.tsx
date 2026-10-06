import Image, { type StaticImageData } from "next/image";
import feedbackBubble from "../../extension/docs/feedback-bubble.png";
import feedbackTab from "../../extension/docs/feedback-tab.png";
import liveCaptions from "../../extension/docs/live-captions.png";
import pen from "../../extension/docs/pen.png";
import replay from "../../extension/docs/replay.png";

const REPO = "https://github.com/jannesrudnick/qey";

const STEPS = [
  {
    title: "Click through and talk",
    text: "Use the app like you normally would and say what's good or bad. qey transcribes you live and records every hover, click, input, console error and failed request on the same timeline.",
  },
  {
    title: "Right-click what's wrong",
    text: "The element gets highlighted and a bubble opens – everything you say streams into it. Each feedback point keeps the selector, the React/Vue component chain, computed styles, a DOM snippet and a screenshot.",
  },
  {
    title: "Claude fetches the feedback",
    text: "When you stop, the recording goes to a local MCP server. In Claude Code you just say “Fix the latest qey feedback” – screenshots included, as images.",
  },
];

const SHOTS: Array<{ src: StaticImageData; title: string; text: string }> = [
  { src: liveCaptions, title: "Live captions", text: "Talking without a target lands as general context." },
  { src: pen, title: "Pen", text: "Circle something – the element underneath becomes the point." },
  { src: feedbackTab, title: "Feedback points", text: "Every finding with screenshot, selector and component." },
  { src: replay, title: "Replay", text: "Activity, speech, console and network next to the session replay." },
];

const FEATURES = [
  ["No script in your app", "A Chrome extension that sits on top of any page – localhost, staging or production."],
  ["Session replay", "Full rrweb replay with a timeline of clicks, errors, notes and speech."],
  ["Component-aware", "Reads the React fiber or Vue instance, including source files in dev builds."],
  ["Local first", "Recordings stay in your browser. Audio only leaves your machine if you add an OpenAI key."],
  ["Whisper or realtime", "Live transcript via OpenAI Realtime, or local Whisper in the browser after recording."],
  ["English or German", "Pick the language you speak – both work for live and post-recording transcription."],
];

const HANDOFF = `## F1 · [00:16.5] button "Place order" – /

> "This button looks disabled even though you can click it.
>  Grey text on a dark background is hard to read."

- Element: [data-testid="place-order"] · role button
- Component (react): CheckoutPage › CheckoutForm › SubmitButton
- Captured via: right-click

Errors in this window
- [00:21.4] POST /api/orders → 404 · 12 ms
- [00:21.4] console.error: Order failed: 404

Computed styles
  color: rgb(168, 162, 158);
  background-color: rgb(41, 37, 36);`;

export default function Home() {
  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6">
      <header className="flex items-center justify-between py-5">
        <a href="#" className="flex items-center gap-2.5 font-semibold tracking-tight">
          <Image src="/icon.svg" alt="" width={28} height={28} />
          qey
        </a>
        <a href={REPO} className="text-sm text-zinc-600 hover:text-zinc-900">
          GitHub →
        </a>
      </header>

      <section className="pt-12 pb-10 text-center sm:pt-20">
        <p className="text-sm font-medium text-brand">Open source · Chrome extension · MCP server for Claude Code</p>
        <h1 className="mx-auto mt-4 max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
          QA feedback your coding agent can actually read
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg text-pretty text-zinc-600">
          Click through a web app, say out loud what bugs you – and Claude Code gets structured findings
          instead of a video: the element, its component, the errors and your words.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <a
            href={`${REPO}#installation-without-the-chrome-web-store`}
            className="rounded-full bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-zinc-700"
          >
            Install from GitHub
          </a>
          <a
            href="#how-it-works"
            className="rounded-full border border-zinc-300 bg-white px-5 py-2.5 text-sm font-medium hover:border-zinc-400"
          >
            How it works
          </a>
        </div>
      </section>

      <Image
        src={feedbackBubble}
        alt="A right-click on the “Place order” button opens a feedback bubble that fills with what the tester says"
        priority
        sizes="(min-width: 1152px) 1104px, 100vw"
        className="rounded-xl border border-zinc-200 shadow-2xl shadow-zinc-900/10"
      />

      <section id="how-it-works" className="scroll-mt-8 py-20 sm:py-28">
        <h2 className="text-3xl font-semibold tracking-tight">How it works</h2>
        <ol className="mt-10 grid gap-8 sm:grid-cols-3">
          {STEPS.map((step, index) => (
            <li key={step.title}>
              <span className="flex size-8 items-center justify-center rounded-full bg-brand/10 font-mono text-sm font-semibold text-brand">
                {index + 1}
              </span>
              <h3 className="mt-4 font-semibold">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-600">{step.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="grid gap-8 sm:grid-cols-2">
        {SHOTS.map((shot) => (
          <figure key={shot.title}>
            <Image
              src={shot.src}
              alt={shot.title}
              sizes="(min-width: 640px) 50vw, 100vw"
              className="rounded-lg border border-zinc-200 shadow-lg shadow-zinc-900/5"
            />
            <figcaption className="mt-3 text-sm">
              <span className="font-medium">{shot.title}</span>
              <span className="text-zinc-600"> – {shot.text}</span>
            </figcaption>
          </figure>
        ))}
      </section>

      <section className="grid items-center gap-10 py-20 sm:py-28 lg:grid-cols-2">
        <div>
          <h2 className="text-3xl font-semibold tracking-tight">What Claude receives</h2>
          <p className="mt-4 leading-relaxed text-zinc-600">
            No screenshots to interpret, no guessing which button you meant. The qey MCP server hands Claude Code
            each feedback point as text – your comment, a stable selector, the component chain, the steps before
            and the errors in that time window – plus the screenshots as images.
          </p>
        </div>
        <pre className="overflow-x-auto rounded-xl bg-zinc-950 p-5 font-mono text-[13px] leading-relaxed text-zinc-300">
          {HANDOFF}
        </pre>
      </section>

      <section className="border-t border-zinc-200 py-20 sm:py-28">
        <dl className="grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(([title, text]) => (
            <div key={title}>
              <dt className="font-semibold">{title}</dt>
              <dd className="mt-2 text-sm leading-relaxed text-zinc-600">{text}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="rounded-2xl bg-zinc-900 px-6 py-12 text-center text-white sm:px-12">
        <h2 className="text-3xl font-semibold tracking-tight">Try it in five minutes</h2>
        <p className="mx-auto mt-4 max-w-xl text-zinc-300">
          qey isn&apos;t in the Chrome Web Store yet. Build it, load it unpacked in developer mode and connect
          Claude Code with one command.
        </p>
        <pre className="mx-auto mt-8 max-w-xl overflow-x-auto rounded-lg bg-black/40 p-4 text-left font-mono text-[13px] text-zinc-200">
          {`git clone ${REPO}.git && cd qey
pnpm install && pnpm --filter qey-extension build
claude mcp add qey -- node "$(pwd)/mcp/dist/index.js"`}
        </pre>
        <a
          href={`${REPO}#installation-without-the-chrome-web-store`}
          className="mt-8 inline-block rounded-full bg-white px-5 py-2.5 text-sm font-medium text-zinc-900 hover:bg-zinc-200"
        >
          Full setup guide
        </a>
      </section>

      <footer className="flex flex-wrap items-center justify-between gap-4 py-10 text-sm text-zinc-500">
        <span>qey – open source QA recorder for coding agents</span>
        <a href={REPO} className="hover:text-zinc-900">
          github.com/jannesrudnick/qey
        </a>
      </footer>
    </div>
  );
}
