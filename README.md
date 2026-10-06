# My Tracker

A mobile-first personal tracker you can install on your phone (PWA). It works offline.

**Open it:** https://sachin21514.github.io/my-tracker/

- **Checklists**: reusable named lists (packing, things I don't eat, chores…)
- **Avoid**: daily "Did I avoid it?" per habit, with streaks and a calendar
- **Grocery**: master item list, a fresh list every month (last price prefilled), month totals in ₹, yearly view with price history
- **Goals**: counted goals like "96 Fridays" with progress, remaining count and estimated finish
- **Settings**: Export / Import a JSON backup

## Install on your phone
- **iPhone (Safari):** Share → *Add to Home Screen*
- **Android (Chrome):** ⋮ menu → *Install app* / *Add to Home screen*

## Privacy
This repository contains only the app code. All your data stays in your phone's browser storage (localStorage) and is never uploaded.
Use **Settings → Export** now and then to keep a backup.

## Development
Pure static files (`index.html`, `styles.css`, `app.js`, `manifest.json`, `sw.js`, `icons/`), no build step.
Run locally with `python3 -m http.server` and open http://localhost:8000/.
When shipping changes, bump `CACHE` in `sw.js` so installed copies update.
