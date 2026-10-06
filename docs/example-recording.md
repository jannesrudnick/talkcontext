# QA recording: 127.0.0.1:4321

> Machine-readable log of a manual QA session. Instead of a video it contains
> the DOM elements the mouse was on or clicked, together with the spoken explanation.

## Context

- Target: http://127.0.0.1:4321/
- Start: 2026-09-05T22:19:22.465Z
- Duration: 6s
- Viewport: 1030x776 @1x
- Recording mode: proxy
- Scope: 1 clicks, 2 hovers, 3 inputs, 2 navigations, 2 errors, 1 notes

## Marked findings

- **[00:04.3]** Save only shows errors, no feedback
  - Element: `[data-testid="save-btn"]` (button "Save")

## Timeline

- **[00:00.0]** START on http://127.0.0.1:4321/
- **[00:00.9]** HOVER on button "Save"
  - Selector: `[data-testid="save-btn"]`
- **[00:01.4]** CLICK on button "Save"
  - Selector: `[data-testid="save-btn"]`
  - Effect: Attributes: #result[hidden=null]
- **[00:01.4]** CONSOLE ERROR: Save failed: 500
- **[00:01.4]** REQUEST POST http://127.0.0.1:4321/api/save -> 501
- **[00:02.9]** INPUT in textbox "Email": "qa@example.com"
  - Selector: `#email`
- **[00:03.6]** INPUT in textbox "Password": "***"
  - Selector: `#pw`
- **[00:03.9]** SELECTION in combobox `#plan`: "Pro"
  - Selector: `#plan`
- **[00:04.3]** HOVER END button "Save" (3.8s)
  - Selector: `[data-testid="save-btn"]`
- **[00:04.3]** NOTE: Save only shows errors, no feedback
  - Selector: `[data-testid="save-btn"]`
- **[00:04.8]** HOVER on link "About us"
  - Selector: `#about-link`
- **[00:05.2]** NAVIGATION http://127.0.0.1:4321/ -> http://127.0.0.1:4321/about.html

## Touched elements

### `[data-testid="save-btn"]`

- Tag: `button` / Role: `button`
- Name: "Save"
- Path: main > form#checkout
- XPath: `/html/body[1]/main[1]/form[1]/button[1]`
- Attributes: `data-testid="save-btn"`, `type="button"`

```html
<button type="button" data-testid="save-btn" class="primary rounded-md px-4">Save</button>
```

### `#email`

- Tag: `input` / Role: `textbox`
- Name: "Email"
- Path: main > form#checkout
- XPath: `//*[@id="email"]`
- Attributes: `type="email"`, `name="email"`, `placeholder="you@example.com"`

### `#pw`

- Tag: `input` / Role: `textbox`
- Name: "Password"
- Path: main > form#checkout
- XPath: `//*[@id="pw"]`
- Attributes: `type="password"`, `name="password"`

### `#plan`

- Tag: `select` / Role: `combobox`
- Path: main > form#checkout
- XPath: `//*[@id="plan"]`
- Attributes: `name="plan"`

### `#about-link`

- Tag: `a` / Role: `link`
- Name: "About us"
- Path: nav
- XPath: `//*[@id="about-link"]`
- Attributes: `href="http://127.0.0.1:4321/about.html"`

```html
<a href="http://127.0.0.1:4321/about.html" id="about-link">About us</a>
```
