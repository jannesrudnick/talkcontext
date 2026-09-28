# qey – Browser-Extension

QA-Recorder als Chrome-Extension (Manifest V3). Kein Skript in der Zielanwendung, kein
Proxy, kein iframe: qey legt sich als Overlay über den Tab, du klickst dich durch und
erklärst laut – aufgezeichnet werden **Session-Replay (rrweb)**, das **semantische
DOM-Protokoll** für Agenten, **Konsole**, **Netzwerk** und die **Tonspur**.

```
Toolbar-Symbol / Alt+Shift+Q  →  Overlay  →  Aufnahme starten  →  durchklicken & reden  →  Stopp
                                                                                    ↓
                             Aufnahmen-Seite: Replay wie PostHog/Sentry + Timeline + Transkript + Export
```

| Overlay während der Aufnahme | Replay mit Aktivität & Element-Inspektor |
| --- | --- |
| ![Overlay](docs/overlay.png) | ![Replay](docs/replay.png) |

## Entwicklung

Voraussetzung: **Node ≥ 22** (WXT nutzt `util.parseEnv`), siehe `.nvmrc` – z.B. `nvm use` oder `fnm use`.

```bash
pnpm install            # im Repo-Root oder hier – das Paket ist Teil des pnpm-Workspaces
pnpm --filter qey-extension dev     # startet Chrome mit geladener Extension (HMR)
pnpm --filter qey-extension build   # → extension/.output/chrome-mv3
pnpm --filter qey-extension typecheck
```

Manuell laden: `chrome://extensions` → Entwicklermodus → „Entpackte Erweiterung laden“ →
`extension/.output/chrome-mv3`.

## Bedienung

| | |
| --- | --- |
| Overlay ein/aus | Klick aufs Toolbar-Symbol oder `Alt+Shift+Q` |
| Aufnahme starten/stoppen | Button im Overlay oder `Alt+Shift+R` |
| Notiz / Bug markieren | Buttons im Overlay – hängt am zuletzt anvisierten Element |
| Aufnahmen & Einstellungen | Rechtsklick aufs Symbol, oder Buttons im Overlay |

Die Aufnahme läuft über Seitenwechsel hinweg weiter (das Content-Script meldet sich nach
jedem Laden beim Background und setzt Replay und Protokoll fort).

## Seiten

- **Aufnahmen** – Liste mit Suche und Umgebungs-Filter.
- **Replay** – rrweb-Player mit Zeitleiste (Marker für Klicks, Fehler, Notizen, Navigation,
  Sprache), Tempo, „Inaktivität überspringen“, synchroner Tonspur. Rechts: Aktivität
  (inkl. zugeordneter Sprache und Element-Inspektor mit Hervorhebung im Replay), Konsole,
  Netzwerk, Transkript. „Für Agent kopieren“ legt das Markdown-Protokoll in die Zwischenablage.
- **Einstellungen** – Sprache/Theme, **Umgebungen** (URL-Muster, Notizen für den Agenten,
  Variablen, geheime Werte werden nie exportiert), Aufnahme (Mikrofon-Freigabe, Protokoll,
  Replay-Maskierung), Transkription (Whisper lokal oder OpenAI), Daten.

## Architektur

```
src/entrypoints/
  background.ts          Zustand (storage.session), Ports der Tabs, Schreiben nach IndexedDB,
                         Offscreen-Steuerung, Toolbar/Kürzel/Kontextmenü
  content/               Läuft in jedem Tab (isolierte Welt)
    index.tsx            Bootstrap, Shadow-Root-Overlay (WXT createShadowRootUi)
    controller.ts        rrweb + semantischer Recorder, puffert und sendet Chunks per Port
    overlay.tsx          Die schwebende Leiste (React, Tailwind in px statt rem)
  main-world.ts          Wird nur während einer Aufnahme in die Seite injiziert:
                         console, fetch/XHR, history → postMessage
  offscreen/             Mikrofon (MediaRecorder) + Pegel, schreibt Audio-Chunks nach IndexedDB
  options/               Die App: Aufnahmen, Replay, Einstellungen, Erste Schritte
src/lib/
  recorder/              Semantischer Recorder (Port von public/qa-recorder.js)
  db.ts                  IndexedDB: recordings + chunks (rrweb, events, effects, cursor,
                         console, network, audio)
  transcription/         Whisper-Worker (transformers.js) und OpenAI
src/features/            Seiten der App
```

Datenmodell, Korrelation Sprache↔Event und der Markdown-/JSON-Export kommen aus
`../src/lib/qa` (Alias `@shared`) – Extension und Next-App erzeugen dasselbe
`qa-recording/1`-Artefakt.

### Warum so

- **Offscreen-Dokument fürs Mikrofon**: Im Content-Script würde Chrome die Freigabe für
  jede getestete Seite einzeln abfragen, der Service Worker hat kein `getUserMedia`. Die
  Freigabe wird einmal auf einer Extension-Seite eingeholt (Erste Schritte / Einstellungen).
- **MAIN-world-Script nur während der Aufnahme**: `console`/`fetch` zu patchen verändert
  Stacktraces der Seite – außerhalb einer Aufnahme bleibt die Seite unangetastet.
- **Chunks statt einem großen Objekt**: Jede Spur wird sekundenweise geschrieben. Stirbt der
  Service Worker oder der Browser, fehlt höchstens die letzte Sekunde.
- **Overlay im Shadow Root**, vom Replay (`blockSelector`) und Protokoll ausgenommen.

### Stolpersteine

- rrweb bündelt postcss, das ein literales U+FFFE enthält. Chrome lehnt Content-Scripts mit
  Unicode-Nichtzeichen ab („isn't UTF-8 encoded“) – `wxt.config.ts` escaped sie nach dem Build.
- Tailwind v4 initialisiert `--tw-*` per `@property`; das greift im Shadow DOM nicht.
  `overlay.css` setzt die Defaults selbst.
- Chrome injiziert in Extension-Seiten eigene Schrift-Defaults ohne Layer; `globals.css`
  setzt die Schrift deshalb ungelayert.
- Die ONNX-Runtime für Whisper wird wie in der Next-App aus `node_modules` nach `public/ort/`
  kopiert (nicht im Repo, `scripts/copy-ort-runtime.mjs`).

## Offen / nächste Schritte

- Firefox (kein Offscreen-API → Audio anders lösen)
- Aufnahmen teilen/hochladen (Backend) und direkt als Issue/Agent-Task anlegen
- Live-Transkript während der Aufnahme
- Cross-Origin-iframes im Replay (`recordCrossOriginIframes`)
