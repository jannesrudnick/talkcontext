# QA-Aufnahme: 127.0.0.1:4321

> Maschinenlesbares Protokoll einer manuellen QA-Session. Statt eines Videos enthaelt es
> die DOM-Elemente, auf denen die Maus stand bzw. geklickt wurde, samt gesprochener Erklaerung.

## Kontext

- Ziel: http://127.0.0.1:4321/
- Start: 2026-09-05T22:19:22.465Z
- Dauer: 6s
- Viewport: 1030x776 @1x
- Aufnahmemodus: proxy
- Umfang: 1 Klicks, 2 Hovers, 3 Eingaben, 2 Navigationen, 2 Fehler, 1 Notizen

## Markierte Befunde

- **[00:04.3]** Speichern zeigt nur Fehler, kein Feedback
  - Element: `[data-testid="save-btn"]` (button "Speichern")

## Timeline

- **[00:00.0]** START auf http://127.0.0.1:4321/
- **[00:00.9]** HOVER auf button "Speichern"
  - Selektor: `[data-testid="save-btn"]`
- **[00:01.4]** KLICK auf button "Speichern"
  - Selektor: `[data-testid="save-btn"]`
  - Wirkung: Attribute: #result[hidden=null]
- **[00:01.4]** KONSOLE ERROR: Speichern fehlgeschlagen: 500
- **[00:01.4]** REQUEST POST http://127.0.0.1:4321/api/save -> 501
- **[00:02.9]** EINGABE in textbox "E-Mail": "qa@example.com"
  - Selektor: `#email`
- **[00:03.6]** EINGABE in textbox "Passwort": "***"
  - Selektor: `#pw`
- **[00:03.9]** AUSWAHL in combobox `#plan`: "Pro"
  - Selektor: `#plan`
- **[00:04.3]** HOVER-ENDE button "Speichern" (3.8s)
  - Selektor: `[data-testid="save-btn"]`
- **[00:04.3]** NOTIZ: Speichern zeigt nur Fehler, kein Feedback
  - Selektor: `[data-testid="save-btn"]`
- **[00:04.8]** HOVER auf link "Ueber uns"
  - Selektor: `#about-link`
- **[00:05.2]** NAVIGATION http://127.0.0.1:4321/ -> http://127.0.0.1:4321/about.html

## Beruehrte Elemente

### `[data-testid="save-btn"]`

- Tag: `button` / Rolle: `button`
- Name: "Speichern"
- Pfad: main > form#checkout
- XPath: `/html/body[1]/main[1]/form[1]/button[1]`
- Attribute: `data-testid="save-btn"`, `type="button"`

```html
<button type="button" data-testid="save-btn" class="primary rounded-md px-4">Speichern</button>
```

### `#email`

- Tag: `input` / Rolle: `textbox`
- Name: "E-Mail"
- Pfad: main > form#checkout
- XPath: `//*[@id="email"]`
- Attribute: `type="email"`, `name="email"`, `placeholder="du@example.com"`

### `#pw`

- Tag: `input` / Rolle: `textbox`
- Name: "Passwort"
- Pfad: main > form#checkout
- XPath: `//*[@id="pw"]`
- Attribute: `type="password"`, `name="password"`

### `#plan`

- Tag: `select` / Rolle: `combobox`
- Pfad: main > form#checkout
- XPath: `//*[@id="plan"]`
- Attribute: `name="plan"`

### `#about-link`

- Tag: `a` / Rolle: `link`
- Name: "Ueber uns"
- Pfad: nav
- XPath: `//*[@id="about-link"]`
- Attribute: `href="http://127.0.0.1:4321/about.html"`

```html
<a href="http://127.0.0.1:4321/about.html" id="about-link">Ueber uns</a>
```
