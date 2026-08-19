# Cascadia log

Combo tracker and scorecard for Cascadia. Tracks which of the 16,807 (7^5) wildlife
scoring-card combinations you have played, plus a full per-game scorepad.

Runs entirely in the browser. No account, no backend. Data lives in `localStorage`
under the key `cascadia:v1` and never leaves the device.

## Run locally

```bash
npm install
npm run dev      # http://localhost:5173
```

## Build

```bash
npm run build    # static site in dist/
npm run preview  # serve dist/ locally to check it
```

`dist/` is a plain static folder. `base: "./"` in `vite.config.js` means it works at a
domain root, in a subpath, or opened straight off disk.

## Deploy

Pick one:

- **Netlify / Cloudflare Pages / Vercel** — connect the repo. Build command `npm run build`,
  publish directory `dist`. Or drag `dist/` onto https://app.netlify.com/drop for a
  no-repo deploy.
- **GitHub Pages** — push to `main`. `.github/workflows/deploy.yml` builds and publishes.
  Enable it once under Settings → Pages → Source: GitHub Actions.

Any of these gives you HTTPS, which the service worker requires.

## Install on your phone

Open the deployed URL, then:

- **iOS Safari** — Share → Add to Home Screen
- **Android Chrome** — menu → Install app / Add to Home screen

It launches full screen and works offline after the first load. Fonts come from Google
Fonts, so the very first load needs a connection; after that everything is cached.

## Moving your data

The artifact version and this version use the same JSON format. Hit **Export log** in one
and **Import log** in the other. Import replaces the whole log, so export first if you have
games in both.

## Where things are

| Path | What it holds |
|---|---|
| `src/App.jsx` | Everything: domain constants, scoring, coverage math, UI, CSS |
| `src/store.js` | Storage shim. Swap the two method bodies for IndexedDB or a sync backend |
| `public/sw.js` | Service worker. Network-first, cache fallback |
| `public/manifest.webmanifest` | Install metadata |

### Things you may want to change

- **Card sets.** `CARDS` in `src/App.jsx` is `A`–`G` (base + Landmarks). Add the promo
  card and `TOTAL_COMBOS` recomputes on its own.
- **Corridor majority scoring.** `habitatBonus()` — one function, all player counts.
- **Coverage math.** `buildCoverage()` and `suggestCombo()`.
