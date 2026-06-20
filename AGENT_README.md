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
data/raw/google_takeout/ Google Takeout ZIP/JSON/MBox files for later parser support
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

If `python3 server.py` is running, the dashboard **Load data** button uploads `.csv`, `.xlsx`, `.json`, `.xml`, or `.zip` files to the local backend, runs the importer, and refreshes the dashboard.

## Expected CSV columns

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

## Verification commands

Run before reporting success:

```bash
python3 scripts/ingest.py --json
python3 -m py_compile server.py scripts/ingest.py
python3 server.py
```

In another terminal:

```bash
curl -s http://127.0.0.1:8766/api/health
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
