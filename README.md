# Client Intel Dashboard

Local-first dashboard for turning CRM spreadsheets, SMS exports, and other customer records into a browsable map + follow-up cockpit for a small/local business.

The current UI is a dark, responsive map dashboard with:

- territory map
- paid / due / lead status
- client search and filters
- selected-record details
- follow-up queue
- local upload/import endpoint
- duplicate detection in the importer

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
data/raw/google_takeout/ Google Takeout ZIP/JSON/MBox files for later parser support
```

Then run:

```bash
python3 scripts/ingest.py --json
```

## CSV format

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

## AI-agent handoff

See [`AGENT_README.md`](AGENT_README.md) for copy/paste-safe instructions for another Hermes/AI agent to clone the repo, export a Google Sheet/CRM CSV locally, import it, and report only counts/paths/dashboard URL.
