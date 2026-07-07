---
name: new-theme
description: >-
  Create, scaffold, or experiment with a CSS/HTML skin for the jovylle-themes
  playground. Use whenever the user wants to add a new theme, make a new "skin",
  restyle the portfolio, clone an existing theme to riff on, or asks for an
  "amazing CSS theme" (e.g. glassmorphism, brutalist, terminal, Y2K, vaporwave,
  neumorphism, retro Mac, etc.). Handles both brand-new themes and tweaks to
  existing ones (default, windows-xp, newspaper, parallax).
---

# new-theme — theme lab for jovylle-themes

A pure HTML/CSS/JS playground (no build step). One shared DOM is re-skinned
entirely with CSS via a `data-theme` attribute on `<html>`.

## The 3 files

| File | Role |
|------|------|
| `index.html` | Static shell + shared structural CSS. **Rarely edited.** |
| `app.js` | `THEMES` array (theme registry) + renders CMS data into the shell. |
| `themes.css` | One `[data-theme='<id>']` block per skin. **This is where 95% of the work is.** |

The active theme is `document.documentElement[data-theme]`, persisted to
`localStorage['jovylle-theme']`. Switching is already wired — never touch the
switcher logic.

## Adding a theme = exactly 2 edits

### 1. Register it in `app.js`

Add one object to the `THEMES` array (top of the file):

```js
{ id: 'my-theme', label: 'My Theme', icon: 'bx-palette' },
```

- `id` — kebab-case, must match the CSS selector.
- `label` — shown in the switcher dropdown.
- `icon` — any [Boxicons](https://boxicons.com) class (`bx-*`), already loaded via CDN. Pick one that fits the vibe (`bx-terminal`, `bx-ghost`, `bx-joystick`, `bx-cube`, `bx-store`…).

### 2. Add a `[data-theme='<id>']` block in `themes.css`

Append a new section at the end. **Each theme is self-contained** — the shared
`[data-theme='default']` rules do NOT cascade to other themes, so you must style
every element the theme should differ on. Use this template as the checklist:

```css
/* ═══════════════════════════════════════════
   MY THEME — one-line vibe description
   ═══════════════════════════════════════════ */
[data-theme='my-theme'] {
  /* theme-local palette (prefix with a short slug, e.g. --mt-) */
  --mt-bg: #...;
  --mt-accent: #...;

  /* required design tokens — wire the palette into these */
  --bg: var(--mt-bg);
  --surface: #...;
  --text: #...;
  --text-muted: #...;
  --accent: var(--mt-accent);
  --border: #...;
  --radius: 12px;         /* 0 for sharp/retro looks */
  --font: 'Inter', system-ui, sans-serif;
  --font-size: 14px;
}

/* base surface */
[data-theme='my-theme'] body,
[data-theme='my-theme'] #app { background: var(--bg); color: var(--text); font-family: var(--font); font-size: var(--font-size); }

/* top bar + title */
[data-theme='my-theme'] #toolbar { /* layout: flex justify-between align-center, or block+center */ }
[data-theme='my-theme'] #toolbar h1 { }

/* section headings */
[data-theme='my-theme'] .section-title { }

/* the 4 card types share one rule */
[data-theme='my-theme'] .project-card,
[data-theme='my-theme'] .highlight-card,
[data-theme='my-theme'] .resume-summary,
[data-theme='my-theme'] .profile-card { }

/* links + tech chips */
[data-theme='my-theme'] a { }
[data-theme='my-theme'] .tech-tag { }

/* OPTIONAL — switcher overrides (shared .ts-* defaults already work) */
[data-theme='my-theme'] .ts-trigger { }
[data-theme='my-theme'] .ts-dropdown { }
[data-theme='my-theme'] .ts-opt:hover { }
[data-theme='my-theme'] .ts-active { }

/* OPTIONAL — polish */
[data-theme='my-theme'] ::selection { }
[data-theme='my-theme'] ::-webkit-scrollbar { }
[data-theme='my-theme'] ::-webkit-scrollbar-thumb { }
```

## Selector checklist (don't leave these unstyled)

`#toolbar` · `#toolbar h1` · `.section-title` · the 4 cards · `a` · `.tech-tag`.
Anything you skip falls back to unstyled/default and looks broken.

## Overriding shared switcher styles

Base `.ts-trigger`, `.ts-dropdown`, `.ts-opt` are unscoped and apply everywhere.
To restyle them per theme you'll usually need `!important` (see how `windows-xp`
and `parallax` do it) because the base rules have equal specificity.

## Preview / verify

No build. Serve the folder and open in a browser:

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

CMS data loads from `https://content.jovylle.com` (needs internet). If offline,
the shell still renders and you can eyeball the toolbar/switcher.

To confirm a new theme end-to-end: open the page, pick it from the switcher,
check every section (profile card, projects grid, highlights, resume, uses,
social links) and the scrollbar/selection colors.

## Tips for "amazing" themes

- **Steal the structure, change the vibe.** Copy the closest existing block
  (`windows-xp` = skeuomorphic/sharp, `newspaper` = editorial/serif,
  `parallax` = dark/glass) and re-palette it.
- **Commit to the concept.** Pick a distinct `--font`, `--radius`, and toolbar
  treatment — those three read as "a different OS/era" more than color alone.
- **`--radius: 0`** instantly reads retro/brutalist; big radius + blur reads modern.
- Fonts beyond system stacks need a `@import`/`<link>` (Google Fonts) — add the
  `<link>` in `index.html <head>` if you go custom.
- Keep contrast readable; test the muted text (`opacity` is used inline in cards).
