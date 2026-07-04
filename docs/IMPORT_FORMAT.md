# Import format guide

This dashboard works best when an agent or human normalizes messy CRM exports into one clean table before importing. Keep real customer files local; do **not** commit them.

## Preferred CSV/XLSX columns

| Column | Required? | Meaning | Examples / notes |
|---|---:|---|---|
| `name` | yes | Customer/contact name | `Jane Customer`, `ABC Electric` |
| `address` | recommended | Service/job address | Use the full street address when possible. |
| `city` | recommended | City/territory label | Helps grouping and dashboard focus labels. |
| `lat` | required unless geocoding | Latitude | Decimal number, e.g. `32.7157`. |
| `lng` | required unless geocoding | Longitude | Decimal number, e.g. `-117.1611`. |
| `status` | optional | Payment/lead status | Use `paid`, `unpaid`, or `lead`. The UI displays `unpaid` as `due`. |
| `phone` | recommended | Best callback number | Any common phone format is OK. |
| `last_contact` | optional | Last touch date | Prefer `YYYY-MM-DD`. |
| `value` | optional | Balance, invoice, or opportunity value | Keep as display text, e.g. `$450`, `Quote pending`. |
| `follow_up` | optional | Next call / appointment date | Prefer `YYYY-MM-DD` or a short label. |
| `notes` | optional | Human-readable evidence/context | Keep concise; private notes stay local. |

## Header mapping examples

If a CRM/Google Sheet has messy headers, map them before import:

| Messy header | Dashboard field |
|---|---|
| `Customer Name`, `Client`, `Contact` | `name` |
| `Service Address`, `Job Address`, `Location` | `address` |
| `Phone Number`, `Mobile`, `Telephone` | `phone` |
| `Balance`, `Amount Due`, `Invoice Total` | `value` |
| `Next Call`, `Next Contact`, `Follow Up` | `follow_up` |
| `Notes`, `Description`, `Summary` | `notes` |

The importer already recognizes many of those aliases, but a clean normalized file makes the dashboard easier to trust.

## Minimal clean CSV

```csv
name,address,city,lat,lng,status,phone,last_contact,value,follow_up,notes
```

Use `templates/client_import_template.csv` as a copy/paste header template. It intentionally contains no example customer rows.

## No coordinates yet?

Option A: add `lat` and `lng` in the CRM export.

Option B: set a local Google Maps geocoding key and let the importer geocode street addresses:

```bash
export GOOGLE_MAPS_API_KEY="<local key, never commit>"
python3 scripts/ingest.py --json --geocode
```

Generated geocoded files are private and ignored by git.

The summary distinguishes where coordinates came from:

- `geocoded_exact_street` — exact street-address matches (ROOFTOP / RANGE_INTERPOLATED)
- `geocoded_approximate` — Google could only resolve a centroid/approximate point
- `kept_existing_coordinates` — rows already had usable lat/lng (replace with `--refresh-geocodes`)
- `failed_geocodes` — rows Google could not resolve
- `records_without_coordinates_dropped` — rows left off the map entirely

## What the other agent should report

After import, report only counts/paths/URL/blockers — never raw customer rows:

- files imported by type/count
- raw record count
- final mapped record count
- duplicate group count
- geocoding outcome (`geocoding_enabled`, `geocoded`, `geocoded_exact_street`, `geocoded_approximate`, `failed_geocodes`, `kept_existing_coordinates`, `records_without_coordinates_dropped`)
- dashboard URL
- blockers such as missing `lat/lng` or missing geocoding key
