# Cascadia log

Combo tracker and scorecard for Cascadia. Tracks which of the 16,807 (7^5) wildlife
scoring-card combinations you have played, plus a full per-game scorepad.

Four pages:

- **Home** — combos played out of 16,807, the Caleb vs Allison record, single-game
  records with who set them, the best scoring card per animal, and a suggested
  combination you have never played (with a button that carries it into the scorepad).
- **Add game** — the scorecard. Pick the five scoring cards, enter scores, save.
  Habitat majorities are computed for you. Defaults to Caleb and Allison.
- **Stats** — every player's record, all single-game highs, the average score for each
  card (all players, or one), the pairing lattice, and card usage.
- **Log** — every game recorded, newest first. Tap one to see the full sheet.

The two regulars are set by `REGULARS` in `src/App.jsx`. Names are matched
case-insensitively, so "caleb" and "Caleb" count as one person.

Habitat tiles are labelled Mountain, Peas, Grass, Prairie and River, and the tokens are
pinecones. The labels live in `HABITATS`; the underlying storage keys are unchanged
(`forest`, `wetland`, `nature`) so older logs and exports still import cleanly.

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

## Keeping your data

The log lives in `localStorage` under `cascadia:v1`, tied to the origin it was logged on.
Deploying a new build never touches it, so you can keep playing while the app changes.

On first load the app calls `navigator.storage.persist()`. WebKit clears localStorage
after 7 days without a visit unless the origin is persisted, and Chrome grants
persistence readily to installed apps. Two things matter beyond that:

- **Install to the home screen on iOS.** Home-screen web apps sit outside Safari and keep
  their own use-based clock, so ordinary play keeps resetting it.
- **Export now and then anyway.** Persistence is a request, not a guarantee, and storage
  is per-device: your phone and any other device keep separate logs.

## Moving your data

The artifact version and this version use the same JSON format. Hit **Export log** in one
and **Import log** in the other. Import replaces the whole log, so export first if you have
games in both.

## Where things are

| Path | What it holds |
|---|---|
| `src/App.jsx` | Everything: domain constants, scoring, coverage math, stats, UI, CSS |
| `src/store.js` | Storage shim. Swap the two method bodies for IndexedDB or a sync backend |
| `public/sw.js` | Service worker. Network-first, cache fallback |
| `public/manifest.webmanifest` | Install metadata |

### Things you may want to change

- **Card sets.** `CARDS` in `src/App.jsx` is `A`–`G` (base + Landmarks). Add the promo
  card and `TOTAL_COMBOS` recomputes on its own.
- **Who the regulars are.** `REGULARS` — drives the head-to-head panel, the name
  colours, and the per-player filter on the stats page.
- **Landscape majority scoring.** `habitatBonus()` — one function, all player counts.
- **Coverage math.** `buildCoverage()` and `suggestCombo()`.
- **Stats.** `buildStats()` builds one row per player per game; `recordFor()` picks the
  record holders and `cardMeans()` does the per-card averages.
