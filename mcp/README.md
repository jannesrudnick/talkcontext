# TalkContext MCP

MCP server through which **Claude Code** reads the QA recordings of the TalkContext extension: feedback points
with statement, element, component chain, **screenshots as images**, DOM snippet, console and
network (including bodies of failed requests).

```
Extension ──POST /sessions──▶ TalkContext MCP (127.0.0.1:4777) ──▶ ~/.talkcontext/sessions/<id>/
                                   │
Claude Code ◀──── stdio/MCP ───────┘   talkcontext_get_session, talkcontext_get_feedback, …
```

## Setup

```bash
pnpm install                      # builds the server (prepare → dist/)
claude mcp add talkcontext -- node "$(pwd)/mcp/dist/index.js"
```

As long as Claude Code is running, the server accepts recordings on `http://127.0.0.1:4777`. In the
extension, click "Send to Claude" – or enable automatic sending under *Settings → Claude Code*.
Then, in Claude Code, e.g.:

> Fix the latest TalkContext feedback

or use the bundled prompt `/mcp__talkcontext__fix_feedback`.

## Tools

| Tool | Purpose |
| --- | --- |
| `talkcontext_list_sessions` | Most recently received recordings |
| `talkcontext_get_session` | Full handoff as Markdown (context, all points, flow, transcript) |
| `talkcontext_get_feedback` | One point (`F3`) or all – with screenshots as images and DOM snippet |
| `talkcontext_get_screenshot` | A single screenshot by path |
| `talkcontext_get_logs` | Console or network, errors only by default |
| `talkcontext_list_comments` | On-page comment threads of the team (per feature, open by default) with conversation, page, element label and selector |
| `talkcontext_reply_comment` | Reply in a thread – shows up as “Claude, for <you>” |
| `talkcontext_resolve_comment` | Resolve (or reopen) a thread, optionally with a closing reply |
| `talkcontext_get_spec` | The collaborative spec text of a feature; without a feature, all features with open comment counts |

`session` is optional everywhere and defaults to `latest`.

## Configuration

| Variable | Default | |
| --- | --- | --- |
| `TALKCONTEXT_PORT` | `4777` | Port for receiving (must match the endpoint in the extension) |
| `TALKCONTEXT_DIR` | `~/.talkcontext` | Where recordings are stored |

Multiple Claude Code sessions at the same time are fine: the first one holds the port, all of them read
the same folder.

The comment tools need team sharing (see [supabase/README.md](../supabase/README.md)): once you are
connected in the extension (Settings → Team sharing), it hands your access token to this server (`POST /team-session`,
memory only, refreshed every 20 minutes while Chrome runs). Claude then acts with your rights –
RLS applies exactly as for you.

## Updating the extension

*Settings → Claude Code → Update* in the extension calls `POST /update`: the server runs
`git pull --ff-only` in the checkout it runs from (current branch), `pnpm install` if the
lockfile changed, rebuilds the extension (and itself if `mcp/` changed), and the extension
reloads itself from the fresh build. If the server changed, restart Claude Code to load it.
Needs `git` and `pnpm` on the `PATH` Claude Code starts the server with.

## Security

Listens on `127.0.0.1` only. Requests with an `Origin` other than `chrome-extension://…`
are rejected, and `application/json` forces a CORS preflight for web pages that the
server never answers. `POST /update` additionally requires an extension `Origin` (requests
without one are rejected too) and only ever pulls and builds this repo. Paths from the handoff are confined to the session folder.

## Testing

```bash
pnpm --filter talkcontext-mcp build
node mcp/scripts/smoke.mjs        # lists the tools and calls them against the existing recordings
```
