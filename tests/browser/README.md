# Browser QA (Playwright)

Automated button/map QA for the dashboard. Uses **synthetic data only** — never run it against real customer data you would not want written into `data/raw/`.

## One-time setup

```bash
cd tests/browser
npm install
npx playwright install chromium
```

If Playwright's own Chromium isn't downloaded, `qa.js` falls back to the installed Google Chrome.

## Run

```bash
# 1. Seed synthetic data + start the server (from repo root)
PORT=8767 python3 server.py &
curl -s -F "files=@tests/fixtures/synthetic-clients.csv" http://127.0.0.1:8767/api/upload

# 2. Run the suite
cd tests/browser
node qa.js http://127.0.0.1:8767/
```

The suite verifies, on desktop (1440×900), tablet (1024×768) and phone (390×844) viewports:

- page load, `clients.json` read, zero console/page errors
- marker count === mapped record count; no heatmap/cluster plugin
- same-coordinate records fanned into distinct clickable markers (≥20 px apart at zoom 18) with an explanatory popup
- zooming in is never overridden back to a compressed view
- search (text and phone digits), status tiles, sort menu, `Map area` toggle
- roster row click, marker click, queue card click, nearby-record click, shared-location note
- `Fit territory`, `Focus map`, the Roster / Record / Queue toggles, per-panel `Hide`
- `Copy sheet` (clipboard content), `Route` (Google Maps URL), `Call` / `Text` links, `Export CSV` (download content)
- keyboard shortcuts (`J`, `/`, `T`, `?`, `Esc`) and the Day / Night switch
- `Load demo data` and `Clear demo`
- browser-only CSV/JSON preview fallback (backend blocked), including skipping rows with blank lat/lng (no Null Island markers) and a clear message for `.xlsx`/`.xml`/`.zip`
- backend upload path through `Import`, the import debrief, and `/api/summary` (counts only)
- tablet record drawer; phone tabs Roster, Map, Record, Queue, the phone Menu, and no sideways scroll

The suite reads app state through `window.cid`, a debug hook in `dashboard/js/main.js`.

## Cleanup

The backend-upload test writes `data/raw/csv/synthetic-upload-ui.csv`. Remove synthetic raw files and re-run `python3 scripts/ingest.py --json` to reset generated data.
