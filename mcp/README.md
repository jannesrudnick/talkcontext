# qey MCP

MCP server through which **Claude Code** reads the QA recordings of the qey extension: feedback points
with statement, element, component chain, **screenshots as images**, DOM snippet, console and
network (including bodies of failed requests).

```
Extension ──POST /sessions──▶ qey MCP (127.0.0.1:4777) ──▶ ~/.qey/sessions/<id>/
                                   │
Claude Code ◀──── stdio/MCP ───────┘   qey_get_session, qey_get_feedback, …
```

## Setup

```bash
pnpm install                      # builds the server (prepare → dist/)
claude mcp add qey -- node "$(pwd)/mcp/dist/index.js"
```

As long as Claude Code is running, the server accepts recordings on `http://127.0.0.1:4777`. In the
extension, click "Send to Claude" – or enable automatic sending under *Settings → Claude Code*.
Then, in Claude Code, e.g.:

> Fix the latest qey feedback

or use the bundled prompt `/mcp__qey__fix_feedback`.

## Tools

| Tool | Purpose |
| --- | --- |
| `qey_list_sessions` | Most recently received recordings |
| `qey_get_session` | Full handoff as Markdown (context, all points, flow, transcript) |
| `qey_get_feedback` | One point (`F3`) or all – with screenshots as images and DOM snippet |
| `qey_get_screenshot` | A single screenshot by path |
| `qey_get_logs` | Console or network, errors only by default |

`session` is optional everywhere and defaults to `latest`.

## Configuration

| Variable | Default | |
| --- | --- | --- |
| `QEY_PORT` | `4777` | Port for receiving (must match the endpoint in the extension) |
| `QEY_DIR` | `~/.qey` | Where recordings are stored |

Multiple Claude Code sessions at the same time are fine: the first one holds the port, all of them read
the same folder.

## Security

Listens on `127.0.0.1` only. Requests with an `Origin` other than `chrome-extension://…`
are rejected, and `application/json` forces a CORS preflight for web pages that the
server never answers. Paths from the handoff are confined to the session folder.

## Testing

```bash
pnpm --filter qey-mcp build
node mcp/scripts/smoke.mjs        # lists the tools and calls them against the existing recordings
```
