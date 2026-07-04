# Browser QA (Playwright)

Automated button/map QA for the dashboard. Uses **synthetic data only** — never run it against real customer data you would not want written into `data/raw/`.

## One-time setup

```bash
cd tests/browser
npm install
npx playwright install chromium
```

## Run

```bash
# 1. Seed synthetic data + start the server (from repo root)
PORT=8767 python3 server.py &
curl -s -F "files=@tests/fixtures/synthetic-clients.csv" http://127.0.0.1:8767/api/upload

# 2. Run the suite
cd tests/browser
node qa.js http://127.0.0.1:8767/
```

The suite verifies, on desktop (1440×900) and mobile (390×844) viewports:

- page load, `clients.json` read, zero console/page errors
- marker count === mapped record count; no heatmap/cluster plugin
- same-coordinate records fanned into distinct clickable markers (≥20 px apart at zoom 18) with an explanatory popup
- zooming in is never overridden back to a compressed view
- search box, status filter, client row click, marker click
- `Fit territory`, `Hide/Show panels`, per-panel `Hide`, rail buttons
- `Copy call sheet` (clipboard content), `Directions` (Google Maps URL), `Export CSV` (download content)
- browser-only CSV/JSON preview fallback (backend blocked), including skipping rows with blank lat/lng (no Null Island markers) and a clear message for `.xlsx`/`.xml`/`.zip`
- backend upload path through `Load data`
- mobile tabs: Clients, Map, Details, Queue

## Cleanup

The backend-upload test writes `data/raw/csv/synthetic-upload-ui.csv`. Remove synthetic raw files and re-run `python3 scripts/ingest.py --json` to reset generated data.
