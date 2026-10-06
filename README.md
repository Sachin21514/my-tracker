# My Tracker

A mobile-first personal tracker you can install on your phone (PWA). It works offline.

**Open it:** https://sachin21514.github.io/my-tracker/

- **Checklists**: reusable named lists (packing, things I don't eat, chores…)
- **Avoid**: daily "Did I avoid it?" per habit, with streaks and a calendar
- **Grocery**
  - Master item list, plus a fresh list every month with the last price prefilled.
  - Month totals in ₹, and a yearly view with price history.
  - **📷 Add from photo**: snap a handwritten/typed list or a shop bill. Text is read on the phone, then you review and add the items.
  - **Price by store** (Mall, BigBasket, Blinkit, Zepto, JioMart, Amazon Fresh, Local kirana, or your own): shows the cheapest store per item, how much you'd save versus where you last bought, and a *Best store* summary in the Year view.
  - **Compare**: one tap opens the item's search on BigBasket, Blinkit, Zepto, JioMart and Amazon Fresh.
- **Goals**: counted goals like "96 Fridays", with progress, remaining count and estimated finish. They can start on a future date.
- **Settings**: Export / Import a JSON backup

## Install on your phone
- **iPhone (Safari):** Share → *Add to Home Screen*
- **Android (Chrome):** ⋮ menu → *Install app* / *Add to Home screen*

## Privacy
This repository contains only the app code. All your data stays in your phone's browser storage (localStorage) and is never uploaded.
Photos for "Add from photo" are read on the device and are not uploaded either.
Use **Settings → Export** now and then to keep a backup.

## Photo import notes
- OCR uses [Tesseract.js](https://github.com/naptha/tesseract.js) 7.0.0 (Apache-2.0), vendored in `vendor/tesseract/` with the English `best_int` model.
- The first photo downloads about 7 MB. After that it is cached and works offline.
- Printed lists and bills work well. Real handwriting is hit-and-miss: write clearly in print letters, use good light and hold the phone flat. Always check the review screen.

## Development
Pure static files (`index.html`, `styles.css`, `app.js`, `manifest.json`, `sw.js`, `icons/`, `vendor/`), no build step.
Run locally with `python3 -m http.server` and open http://localhost:8000/.
When shipping changes, bump `CACHE` in `sw.js` so installed copies update.
