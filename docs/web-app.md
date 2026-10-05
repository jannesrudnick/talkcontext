# QA-Recorder (Web-App)

Loom für Coding-Agenten. Du lädst eine Website in einen iframe, klickst dich durch und
erklärst dabei laut, was du siehst. Heraus kommt **kein Video**, sondern ein strukturiertes
Protokoll: auf welchem DOM-Element die Maus stand, was geklickt wurde, was sich daraufhin
im DOM geändert hat — dazu das Transkript deiner Erklärung, auf der gleichen Zeitachse.

Ein Agent muss also keine Screenshots interpretieren. Er liest Selektoren.

```
- **[00:01.4]** KLICK auf button "Speichern"
  - Selektor: `[data-testid="save-btn"]`
  - Wirkung: Attribute: #result[hidden=null]
- **[00:01.4]** KONSOLE ERROR: Speichern fehlgeschlagen: 500
- **[00:01.4]** REQUEST POST http://localhost:4321/api/save -> 501
- **[00:03.5]** GESPROCHEN: "hier kommt nur eine Fehlermeldung ohne jeden Kontext"
```

Ein vollständiges Beispiel liegt in [`beispiel-aufnahme.md`](beispiel-aufnahme.md).

> **Hinweis:** Das ist der Vorgänger der [Browser-Extension](../extension/README.md) und liegt
> als Next.js-App im Repo-Root. Für neue Arbeit ist die Extension der Weg – kein Proxy, kein
> Skript im Zielprojekt, dazu Replay, Feedback-Punkte und Handoff an Claude Code.
> Diese Seite beschreibt nur die Web-App.

## Starten

```bash
npm install
npm run dev          # http://localhost:3000
```

URL eintragen (`localhost:3000`, `https://staging.example.com`), **Laden**, **Aufnahme**,
durchklicken, **Stop**, exportieren.

> Das *Live*-Transkript während der Aufnahme braucht Chrome oder Edge (Web Speech API).
> Unabhängig davon lässt sich die Tonspur nach der Aufnahme in jedem Browser lokal mit
> Whisper transkribieren — siehe unten.

## Warum zwei Modi

Ein normaler Cross-Origin-iframe ist für JavaScript eine Blackbox: Man erfährt weder,
wo die Maus steht, noch welches Element darunter liegt. Deshalb gibt es zwei Wege,
den Recorder *in* die Zielseite zu bekommen:

| Modus      | Aufwand                     | Wann                                                        |
| ---------- | --------------------------- | ----------------------------------------------------------- |
| **Proxy**  | keiner                      | Fremde Seiten, Staging, alles worauf du keinen Zugriff hast |
| **Bridge** | ein `<script>` im Zielprojekt | Dein eigenes Projekt — exakter und ohne HTML-Rewriting      |

### Proxy-Modus

Die Zielseite wird über `/p/<base64url(origin)><pfad>` von dieser App ausgeliefert. Dabei
werden alle URLs auf den Proxy umgeschrieben und `public/qa-recorder.js` in den `<head>`
injiziert. Weil das Dokument damit auf *unserer* Origin liegt, hat der Recorder vollen
DOM-Zugriff.

Was der Proxy dafür tut:

- `X-Frame-Options`, CSP und `Referrer-Policy` der Zielseite werden entfernt (sonst keine Einbettung)
- HTML-Attribute (`src`, `href`, `action`, `srcset`, …) und CSS-`url()` werden auf den Proxy gebogen
- Cookies werden auf unsere Origin ummünzt, damit eingeloggte Flows funktionieren
- Wurzel-relative URLs, die erst zur Laufzeit entstehen (`/_next/...`), fängt `src/proxy.ts`
  über den Referer ab und leitet sie in den Proxy zurück

Grenzen: Seiten mit aggressivem Origin-Check, Service Workern oder WebSockets zur eigenen
API können im Proxy anders laufen als im Original. Dann Bridge-Modus nehmen.

### Bridge-Modus

Ein Zeile im eigenen Dev-Build, danach lädt der iframe die Seite direkt:

```html
<script src="http://localhost:3000/qa-recorder.js" data-qa-mode="bridge"></script>
```

Kein Rewriting, keine Cookie-Tricks, exakt die App wie sie ist. Voraussetzung ist nur,
dass die Seite überhaupt eingebettet werden darf (Dev-Server tun das in der Regel).

## Transkription

Zwei Wege, beide ohne API-Key:

| | Live-Transkript | Whisper lokal |
| --- | --- | --- |
| Wann | während der Aufnahme | nach dem Stoppen, auf Knopfdruck |
| Technik | Web Speech API | `@huggingface/transformers` + ONNX, WebGPU mit WASM-Fallback |
| Browser | Chrome, Edge | alle mit WebGPU oder WASM |
| Qualität | brauchbar | deutlich besser, echte Zeitstempel pro Abschnitt |
| Preis | Chrome schickt Audio an Google | nichts verlässt den Rechner |

Whisper läuft in einem Web Worker, damit weder Modell-Download noch Inferenz die Oberfläche
blockiert. Modelle (einmaliger Download, danach im Browser-Cache):

| Modell | Download | wofür |
| --- | --- | --- |
| Tiny | 96 MB | schnelle Kontrolle, Stichworte |
| Base | 146 MB | Standard, guter Kompromiss |
| Small | 325 MB | wenn es auf jedes Wort ankommt |

Zur Quantisierung: die `_quantized`- und `int8`-Decoder von `onnx-community` lassen sich mit
der mitgelieferten onnxruntime-web nicht laden (`Missing required scale ... MatMulNBits`).
Deshalb q8-Encoder plus q4-Decoder — getestet, funktioniert auf WebGPU und WASM.

Die WASM-Runtime von onnxruntime-web würde transformers.js zur Laufzeit von einem CDN holen.
Für ein Werkzeug, das ausdrücklich lokal arbeitet, ist das die falsche Abhängigkeit, also
kopiert `scripts/copy-ort-runtime.mjs` sie bei `install`/`dev`/`build` aus `node_modules`
nach `public/ort/` (rund 74 MB, deshalb nicht im Repo).

## Was aufgezeichnet wird

| Event      | Inhalt                                                                        |
| ---------- | ----------------------------------------------------------------------------- |
| `hover`    | Element ab 400 ms Verweildauer, mit Verweildauer beim Verlassen                |
| `click`    | Element, Maustaste, Trefferpunkt relativ zum Element, Modifier                 |
| `input`    | Feld und Wert (Passwörter und `data-qa-secret` immer maskiert)                 |
| `change`   | Auswahl in `<select>` inkl. Label                                             |
| `key`      | Enter, Escape, Tab, Pfeile, Ctrl/Cmd-Kombinationen                            |
| `scroll`   | Seite (in Prozent) oder scrollbares Element                                   |
| `navigate` | Seitenwechsel inkl. `pushState`/`popstate`                                    |
| `submit`   | Formular, Methode, Ziel                                                        |
| `console`  | `console.error`/`warn`, unbehandelte Fehler und Promise-Rejections            |
| `network`  | Requests mit Status ≥ 400 oder Netzwerkfehler                                  |
| `note`     | Manuell gesetzter Befund, hängt am zuletzt anvisierten Element                 |

Nach jedem Klick beobachtet der Recorder 700 ms lang das DOM und hängt die **Wirkung** an
das Event: neue/entfernte Knoten, geöffnete Dialoge, Alert-Texte, geänderte Attribute,
URL-Wechsel. Das ist der Teil, der einem Agenten „was ist passiert" beantwortet.

Jedes Element wird beschrieben als: stabiler Selektor (bevorzugt `data-testid`, `#id`,
`[aria-label]`), XPath, Rolle, Accessible Name, Attribute, Bounding-Box, Vorfahrenkette
und gekürztes `outerHTML`. Die Maus-Bahn wird separat mit ~8 Hz abgetastet, damit der
Event-Log semantisch bleibt.

Was **nicht** passiert: keine Screenshots, keine Pixel. Alles ist Text.

## Export

- **Markdown** — die Timeline oben, direkt in einen Agenten-Prompt kopierbar
- **JSON** — vollständige Daten (`qa-recording/1`), inklusive Cursor-Bahn und Transkript
- **Audio** — die Tonspur als `.webm`, falls sie gebraucht wird
- **In `./qa-sessions` ablegen** — schreibt JSON + Markdown ins Projektverzeichnis,
  damit ein Agent die Datei direkt vom Dateisystem lesen kann

## Architektur

```
src/app/p/[...slug]/route.ts   Frame-Proxy: fetch, Header bereinigen, HTML/CSS umschreiben, injizieren
src/proxy.ts                   Referer-Fallback für wurzel-relative Requests aus dem Frame
public/qa-recorder.js          Läuft in der Zielseite, meldet Events per postMessage
src/hooks/use-recorder.ts      Empfängt Events, rechnet Zeitstempel auf den Sessionstart um
src/hooks/use-narration.ts     Mikrofon (MediaRecorder) + Live-Transkript (Web Speech API)
src/lib/qa/whisper.worker.ts   Lokale Whisper-Transkription im Web Worker
src/hooks/use-transcription.ts Audio-Decode zu 16 kHz Mono, Fortschritt, Worker-Steuerung
src/lib/qa/export.ts           Markdown- und JSON-Artefakt
src/components/qa/studio.tsx   Oberfläche
```

## Datenschutz

Der Proxy leitet Cookies der Zielseite auf die Origin dieser App um — praktisch für
eingeloggte QA, aber ein lokales Werkzeug: nicht öffentlich deployen. Eingabewerte lassen
sich im Setup-Tab komplett abschalten; Passwortfelder und alles mit `data-qa-secret`
werden ohnehin immer maskiert.
