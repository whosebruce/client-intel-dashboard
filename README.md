# Client Intel Dashboard

Local-first dashboard for turning CRM spreadsheets, SMS exports, and other customer records into a browsable map + follow-up cockpit for a small/local business.

The current UI is a warm charcoal/sand, responsive map dashboard with:

- territory map (Leaflet vendored in `dashboard/vendor/` — no CDN needed)
- paid / due / lead status
- client search and filters
- selected-record details
- follow-up queue
- local upload/import endpoint
- duplicate detection in the importer
- CSV/JSON/XLSX browser preview fallback
- polished import-format docs for AI-agent handoff

## Quick start

```bash
python3 scripts/ingest.py --json
python3 server.py
```

Open:

```text
http://127.0.0.1:8766/
```

On a LAN host/bot machine:

```text
http://<host-ip>:8766/
```

## Data import

### Browser

Run `python3 server.py`, open the dashboard, and click **Load data**. Supported file types:

```text
.csv
.xlsx
.json
.xml
.zip
```

The local backend saves files into the appropriate `data/raw/` folder, runs `scripts/ingest.py`, and refreshes `dashboard/clients.json`.

### CLI

Place files in:

```text
data/raw/csv/            CRM / Google Sheets CSV exports
data/raw/sheets/         Excel/XLSX CRM exports
data/raw/sms/            Android SMS Backup & Restore XML exports
data/raw/json/           JSON arrays or {clients|records|rows:[...]} exports
```

Then run:

```bash
python3 scripts/ingest.py --json
```

## CSV / XLSX / JSON format

See [`docs/IMPORT_FORMAT.md`](docs/IMPORT_FORMAT.md) for a clean import schema, messy-header mapping examples, and agent handoff rules. A no-data header template is available at [`templates/client_import_template.csv`](templates/client_import_template.csv).

Preferred columns:

```csv
name,address,city,lat,lng,status,phone,last_contact,value,follow_up,notes
```

Statuses:

```text
paid
unpaid
lead
```

The UI displays `unpaid` as `due`.

## Exact-address markers with Google Maps Geocoding

If CRM rows do not already include `lat` and `lng`, the importer can use the Google Maps Geocoding API to convert street addresses into exact marker coordinates.

1. Create a Google Maps Platform API key with the **Geocoding API** enabled.
2. Do **not** commit the key. Set it locally:

```bash
export GOOGLE_MAPS_API_KEY="your-key-here"
```

3. Run:

```bash
python3 scripts/ingest.py --json --geocode
```

If the current CRM already has approximate/city-level coordinates and you want Google to replace them with exact street-address coordinates, run:

```bash
python3 scripts/ingest.py --json --geocode --refresh-geocodes
```

When `GOOGLE_MAPS_API_KEY` is present, `python3 server.py` also geocodes uploaded files automatically after **Load data**. The importer stores Google’s formatted address, `lat`, `lng`, and an `exact-geocode` confidence label in the generated local files only (`approx-geocode` when Google could only resolve a centroid rather than a rooftop/street address).

The importer summary reports the geocoding outcome explicitly:

```json
{
  "geocoding_enabled": true,
  "geocoded": 12,
  "geocoded_exact_street": 10,
  "geocoded_approximate": 2,
  "failed_geocodes": 1,
  "kept_existing_coordinates": 30,
  "records_without_coordinates_dropped": 1
}
```

- `geocoded_exact_street` — coordinates came from an exact street-address match (ROOFTOP / RANGE_INTERPOLATED).
- `kept_existing_coordinates` — rows that already had usable coordinates and were left alone (use `--refresh-geocodes` to replace them).
- `records_without_coordinates_dropped` — rows that could not be mapped at all and were left out of the dashboard.

## Map behavior: individual markers, never a heatmap

The map intentionally has **no heatmap layer and no marker clustering**. Every mapped record is a discrete, clickable marker, so you can zoom in and inspect individual customers.

When several records share the same exact coordinate (for example, two contacts at one address), the dashboard fans them into a small deterministic ring (~15 m offsets) so each marker stays individually visible and clickable at max zoom, and the marker popup notes how many records share that exact location. Nothing is silently collapsed.

`Fit territory` frames the currently filtered markers (capped at zoom 13 so a single record doesn’t over-zoom); it never overrides a zoom level you set yourself — selecting rows keeps your zoom once you’re zoomed past 13.

## Duplicate detection

The importer reports and merges likely duplicates by:

- normalized phone number
- normalized address
- name + city

Example summary:

```json
{
  "raw_records": 100,
  "records": 83,
  "merged_duplicates": 17,
  "duplicate_groups": 12
}
```

## AI-agent field mapping

This repo is designed for an AI agent to help adapt messy CRM spreadsheets into the dashboard schema. The agent should inspect headers locally, map equivalent fields such as `Customer Name` → `name`, `Service Address` → `address`, `Phone Number` → `phone`, `Balance` → `value`, and export a normalized CSV/XLSX into `data/raw/csv/` or `data/raw/sheets/`.

The private CRM file can stay on the user's machine; the dashboard code itself can live in a public GitHub repo.

## Privacy

Do not commit raw customer exports or generated customer datasets. `.gitignore` excludes:

```text
data/raw/**
data/processed/**
dashboard/clients.json
```

The repository intentionally ships with no customer/example rows. Add private CRM exports locally after cloning.

## Testing

Deterministic Python tests (the Google geocoder is mocked — no network, no key needed):

```bash
python3 -m unittest discover -s tests -v
```

Automated browser QA (Playwright, synthetic data only) covering every button, marker behavior, exports, and mobile tabs — see [`tests/browser/README.md`](tests/browser/README.md):

```bash
cd tests/browser && npm install && npx playwright install chromium && node qa.js http://127.0.0.1:8766/
```

A sanitized fixture for seeding QA data lives at `tests/fixtures/synthetic-clients.csv` (fake names/addresses only).

## AI-agent handoff

See [`AGENT_README.md`](AGENT_README.md) for copy/paste-safe instructions for another Hermes/AI agent to clone the repo, export a Google Sheet/CRM CSV locally, import it, and report only counts/paths/dashboard URL.

For a high-effort Claude Code/Fable-style QA and geocoding pass, use [`docs/CLAUDE_CODE_FABLE5_HIGH_EFFORT_HANDOFF.md`](docs/CLAUDE_CODE_FABLE5_HIGH_EFFORT_HANDOFF.md).
