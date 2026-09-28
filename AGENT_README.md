# AGENT_README — Client Intel Dashboard Handoff

This repository is intended for a Hermes/AI agent to clone onto a user's own machine and populate from that user's private CRM/export files.

## Privacy rules

- Treat all files in `data/raw/`, `data/processed/`, and `dashboard/clients.json` as private customer data.
- Do **not** commit private CRM exports, Google Sheets exports, SMS XML, Google Takeout ZIPs, generated `clients.json`, or generated `clients.csv`.
- Do **not** upload raw customer files or message contents to cloud LLMs/API services unless the human explicitly authorizes that exact action.
- Prefer local deterministic parsing first. If AI extraction is needed, send the smallest possible snippet and preserve evidence/confidence.

## Local setup

```bash
git clone <REPO_URL> client-intel-dashboard
cd client-intel-dashboard
python3 scripts/ingest.py --json
python3 server.py
```

Open:

```text
http://127.0.0.1:8766/
```

For LAN access on a bot/Hermes host:

```text
http://<host-ip>:8766/
```

## Data drop zones

Put exported/private files here on the target host:

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

The dashboard reads:

```text
dashboard/clients.json
```

## Browser upload workflow

If `python3 server.py` is running, the dashboard **Import** button (or dropping files on the page) uploads `.csv`, `.xlsx`, `.json`, `.xml`, or `.zip` files to the local backend, runs the importer, refreshes the dashboard, and shows an import debrief with counts only.

Each importer run writes `data/processed/import_summary.json` (counts only, no names or phones), which the dashboard reads from `GET /api/summary`. It is private generated data like `clients.json` and stays out of git.

## Expected import format

See [`docs/IMPORT_FORMAT.md`](docs/IMPORT_FORMAT.md) and [`templates/client_import_template.csv`](templates/client_import_template.csv).

Use any useful subset of these columns:

```csv
name,address,city,lat,lng,status,phone,last_contact,value,follow_up,notes
```

`status` should be one of:

```text
paid
unpaid
lead
```

The UI displays `unpaid` as `due`.

## Google Sheets / CRM handoff

If the user's CRM is in Google Sheets, export/download the sheet as CSV and place it in:

```text
data/raw/csv/crm.csv
```

If the user's CRM is an Excel workbook, place it in:

```text
data/raw/sheets/crm.xlsx
```

The agent may inspect the sheet headers locally and map messy CRM columns into the dashboard schema. Examples: `Customer Name` → `name`, `Service Address` → `address`, `Phone Number` → `phone`, `Balance` → `value`, `Next Call` → `follow_up`. Keep this mapping local unless the human explicitly asks to publish the mapping.

If the agent has Google Sheets API access, it may export the sheet to CSV locally, but it should not print private rows into chat. Report only counts and file paths.

## Exact-address geocoding

If the CRM rows have street addresses but no `lat`/`lng`, use Google Maps Geocoding locally:

```bash
export GOOGLE_MAPS_API_KEY="<local key, never commit>"
python3 scripts/ingest.py --json --geocode
```

Rules:

- The key must stay in the local shell/service environment only.
- Do not paste the key into chat.
- Do not commit `.env` or generated geocoded customer data.
- Confirm the final summary includes `geocoding_enabled: true` and `geocoded: <count>`, and check `geocoded_exact_street` vs `geocoded_approximate`, `failed_geocodes`, and `kept_existing_coordinates` to know whether markers came from exact street addresses or pre-existing coordinates.
- Use `--refresh-geocodes` if imported rows already contain approximate/city-level coordinates that should be replaced with exact Google coordinates.
- If the key is missing, ask the human to add one or require the CRM to include `lat` and `lng` columns.

## Duplicate handling

`scripts/ingest.py --json` reports duplicate detection:

```json
{
  "raw_records": 100,
  "records": 83,
  "merged_duplicates": 17,
  "duplicate_groups": 12,
  "duplicate_records_in_groups": 29
}
```

Duplicates are matched by phone, normalized address, and name+city. The importer merges records before writing dashboard data.

## Map behavior contract

The dashboard shows **one discrete marker per mapped record** — no heatmap, no clustering. Records sharing an exact coordinate are fanned into a small deterministic ring (~15 m) so each stays clickable at max zoom; the popup says how many records share that location. Do not add heatmap tiles, density blobs, or default clustering.

## Verification commands

Run before reporting success:

```bash
python3 scripts/ingest.py --json
python3 -m py_compile server.py scripts/ingest.py
python3 -m unittest discover -s tests -v
node --test tests/js/
python3 server.py
```

For full button/map QA, see `tests/browser/README.md` (Playwright, synthetic data only).

In another terminal:

```bash
curl -s http://127.0.0.1:8766/api/health
curl -s http://127.0.0.1:8766/api/summary
curl -I http://127.0.0.1:8766/
```

## Final report format for agents

Report only:

- repo/path cloned
- files imported by type/count
- raw record count
- final record count
- duplicate group count
- dashboard URL
- any blockers

Do not paste raw customer rows or message contents into chat.
