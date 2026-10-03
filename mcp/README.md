# qey-MCP

MCP-Server, über den **Claude Code** die QA-Aufnahmen der qey-Extension liest: Feedback-Punkte
mit Aussage, Element, Komponentenkette, **Screenshots als Bilder**, DOM-Ausschnitt, Konsole und
Netzwerk (inkl. Bodies fehlgeschlagener Requests).

```
Extension ──POST /sessions──▶ qey-MCP (127.0.0.1:4777) ──▶ ~/.qey/sessions/<id>/
                                   │
Claude Code ◀──── stdio/MCP ───────┘   qey_get_session, qey_get_feedback, …
```

## Einrichtung

```bash
pnpm install                      # baut den Server (prepare → dist/)
claude mcp add qey -- node "$(pwd)/mcp/dist/index.js"
```

Solange Claude Code läuft, nimmt der Server auf `http://127.0.0.1:4777` Aufnahmen entgegen. In der
Extension „An Claude senden“ klicken – oder unter *Einstellungen → Claude Code* automatisch senden
lassen. Dann in Claude Code z.B.:

> Fix das letzte qey-Feedback

oder den mitgelieferten Prompt `/mcp__qey__fix_feedback`.

## Werkzeuge

| Tool | Zweck |
| --- | --- |
| `qey_list_sessions` | Zuletzt empfangene Aufnahmen |
| `qey_get_session` | Kompletter Handoff als Markdown (Kontext, alle Punkte, Ablauf, Transkript) |
| `qey_get_feedback` | Ein Punkt (`F3`) oder alle – mit Screenshots als Bild und DOM-Ausschnitt |
| `qey_get_screenshot` | Einzelner Screenshot per Pfad |
| `qey_get_logs` | Konsole oder Netzwerk, standardmäßig nur Fehler |

`session` ist überall optional und steht standardmäßig auf `latest`.

## Konfiguration

| Variable | Standard | |
| --- | --- | --- |
| `QEY_PORT` | `4777` | Port für den Empfang (muss zum Endpunkt in der Extension passen) |
| `QEY_DIR` | `~/.qey` | Ablageort der Aufnahmen |

Mehrere Claude-Code-Sitzungen gleichzeitig sind kein Problem: Die erste hält den Port, alle lesen
denselben Ordner.

## Sicherheit

Lauscht ausschließlich auf `127.0.0.1`. Anfragen mit einem `Origin` außer `chrome-extension://…`
werden abgelehnt, und `application/json` erzwingt bei Web-Seiten einen CORS-Preflight, den der
Server nie beantwortet. Pfade aus dem Handoff werden auf den Session-Ordner beschränkt.

## Testen

```bash
pnpm --filter qey-mcp build
node mcp/scripts/smoke.mjs        # listet Tools und ruft sie gegen die vorhandenen Aufnahmen auf
```
