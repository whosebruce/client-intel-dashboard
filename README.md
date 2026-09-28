# Client Intel Dashboard

A local map and follow-up dashboard built from a small business's own customer records: CRM spreadsheets, CSV or JSON exports, and Android SMS backups.

It's for owner-operated service businesses whose customer list is split across a spreadsheet, a CRM export and a phone full of text threads. The importer merges those files into one list, and the dashboard shows each customer as a map marker with paid, due or lead status and a follow-up queue. The importer and server use only the Python standard library, and the dashboard is plain JavaScript modules with Leaflet and its fonts vendored, so there is no build step. The repo ships with no customer data.

## Quick start

Requires Python 3.

```bash
python3 scripts/ingest.py --json   # build dashboard/clients.json from data/raw/
python3 server.py                  # serve the dashboard and the upload endpoint
```

Open `http://127.0.0.1:8766/`, then click **Import** (or drop files anywhere on the page). Set `PORT` to use a different port. No files yet? **Load demo data** in the import dialog fills the dashboard with 36 synthetic records that are never saved.

`server.py` listens on all interfaces and has no login. Anyone who can reach the port can view the records and upload files, so run it on a trusted LAN only, or set `HOST=127.0.0.1` to keep it on this machine.

## What the dashboard does

The screen is three panels around the map, with flat square panels, mono labels and one yellow action ([`docs/DESIGN.md`](docs/DESIGN.md)).

- **Roster.** Status tiles for All, Paid, Due and Leads show the count and dollar total and double as the status filter. Below them are a ratio bar, search (name, address, notes or phone digits), a sort menu (follow-up, name, value, last contact, city) and **Map area**, which limits the list to what's on screen.
- **Map.** One clickable marker per mapped record, colored by status, with a red corner when the follow-up is overdue. There's no heatmap and no clustering. Zoomed out, markers shrink to small squares; from zoom 12 they show initials. **Fit territory** frames the filtered markers.
- **Record.** Status, follow-up and confidence chips, **Call** and **Text** links, **Route** (Google Maps directions), **Copy sheet** (a plain-text call sheet), last contact and follow-up with days ago or days overdue, notes, the importer's evidence, and the five closest records.
- **Follow-up queue.** Records grouped into Overdue, Today, Next 7 days, Later and No date. Click any card to open it.
- **Import** opens a dialog that says whether the local server is online, takes files by picker or drag and drop, and finishes with an import debrief: files saved, rows read, records on the map, merged duplicates, duplicate groups, records left off the map, and geocoding counts.
- **Export CSV** writes all loaded records in the import schema.
- **Focus map** hides every panel. The Roster, Record and Queue buttons show or hide one panel at a time.
- **Day / Night** switches between the dark theme and a light one for bright rooms or outdoors. The choice is remembered in this browser.
- Keyboard: `/` search, `J`/`K` next and previous record, `F` fit, `M` focus map, `C` copy sheet, `D` directions, `I` import, `T` theme, `?` the full list.

On a tablet the record opens as a drawer over the map. On a phone the map sits on top with Roster, Map, Record and Queue tabs below it, and Export, Fit, theme and demo data move into **Menu**.

The status colors (teal paid, amber due, blue lead) were checked for color-blind separation on both themes, and every status also has a text label.

Map tiles come from OpenStreetMap, so the map background needs an internet connection. Everything else, including the fonts, is served from your machine.

## Importing data

### From the browser

With `server.py` running, **Import** accepts `.csv`, `.xlsx`, `.json`, `.xml` and `.zip`. The server saves each file under `data/raw/`, runs the importer and refreshes the map. The dialog also has **Download CSV template** for the column layout.

If the backend isn't reachable, the page falls back to an in-browser preview for CSV and JSON only. Rows without `lat`/`lng` are skipped, nothing is saved, and the status bar says **Browser preview · not saved** until you reload.

`.zip` uploads are saved to `data/raw/google_takeout/`, but the importer doesn't read that folder yet.

### From the command line

Drop files here, then run `python3 scripts/ingest.py --json`:

```text
data/raw/csv/     CRM or Google Sheets CSV exports
data/raw/sheets/  Excel .xlsx exports (first worksheet)
data/raw/json/    JSON arrays, or objects with a clients, records or rows list
data/raw/sms/     Android "SMS Backup & Restore" XML
```

The importer writes `data/processed/clients.json`, `data/processed/clients.csv` and `dashboard/clients.json`, then prints a summary with record, duplicate, status and geocoding counts.

SMS messages that mention an address, a city, a dollar amount, or payment and lead keywords become review candidates (confidence `low`, or `medium` when a street address is found). SMS rows have no coordinates, so they only reach the map after geocoding.

### Column format

[`docs/IMPORT_FORMAT.md`](docs/IMPORT_FORMAT.md) covers the schema and header mapping. [`templates/client_import_template.csv`](templates/client_import_template.csv) is an empty header template.

```csv
name,address,city,lat,lng,status,phone,last_contact,value,follow_up,notes
```

`status` is `paid`, `unpaid` or `lead`; the UI shows `unpaid` as "due". Common aliases such as `Customer Name`, `Service Address`, `Phone Number` and `Balance` are recognized. Rows without coordinates are left off the map and counted as `records_without_coordinates_dropped`.

## Exact-address markers (optional)

If rows have street addresses but no coordinates, the importer can geocode them with the Google Maps Geocoding API. This sends each address to Google.

```bash
export GOOGLE_MAPS_API_KEY="your-key"              # never commit it
python3 scripts/ingest.py --json --geocode
python3 scripts/ingest.py --json --geocode --refresh-geocodes   # replace existing coordinates
```

The CLI geocodes up to 250 addresses per run (`--geocode-limit`). When `GOOGLE_MAPS_API_KEY` is set, `server.py` also geocodes after each upload, up to `GEOCODE_LIMIT` (default 50), and `GEOCODE_REFRESH=1` adds `--refresh-geocodes`. The server doesn't read `.env` on its own; export these in the shell or service that runs it. [`.env.example`](.env.example) lists them.

Geocoded records are labeled `exact-geocode` for rooftop or interpolated street matches and `approx-geocode` otherwise. The summary reports `geocoded_exact_street`, `geocoded_approximate`, `failed_geocodes` and `kept_existing_coordinates`.

## Map and duplicate behavior

Records that share an exact coordinate are fanned into a small ring (about 15 m) so each marker stays clickable at max zoom, and the popup and the record panel say how many share the spot. **Fit territory** frames the filtered markers, capped at zoom 13. Clicking a record zooms to at least 13 and keeps any closer zoom you've set.

Each importer run also writes counts only (no names, phones or paths) to `data/processed/import_summary.json`. `GET /api/summary` serves it, and the roster shows a notice when records were left off the map for missing coordinates.

The importer reports likely duplicates by normalized phone number, normalized address, or name plus city (`duplicate_groups` in the summary). It merges records that share a phone number, or an address when there's no phone. A `paid` status wins over `unpaid` and `lead` when records merge.

## Privacy

Raw exports and generated datasets stay out of git: `.gitignore` excludes `data/raw/**`, `data/processed/**`, `dashboard/clients.json` and `.env`. The code can live in a public repo while the customer files stay on the machine that runs it.

[`AGENT_README.md`](AGENT_README.md) has copy-paste instructions for an AI agent that runs the import on someone's machine and reports only counts, paths and the dashboard URL.

## Tests

```bash
python3 -m unittest discover -s tests -v   # importer and server
node --test tests/js/                      # dashboard data logic (Node 20+)
```

The Python tests mock the Google geocoder, so they need no key or network. The server tests start the real handler on a random local port. The JS tests cover CSV parsing, header aliases, follow-up buckets, sorting, the same-coordinate fan-out and the demo data, with no browser and no dependencies.

A Playwright suite in [`tests/browser/`](tests/browser/README.md) clicks through every control on desktop, tablet and phone viewports using the synthetic fixture `tests/fixtures/synthetic-clients.csv`. It needs Node and a running server seeded with that fixture; the steps are in its README.

## Layout

```text
server.py                local web server: dashboard, /api/upload, /api/health, /api/summary
scripts/ingest.py        importer: CSV, XLSX, JSON and SMS XML to clients.json
dashboard/index.html     page shell
dashboard/css/           styles and vendored font faces
dashboard/js/main.js     state, layout, keyboard and event wiring
dashboard/js/data.js     pure data logic (parsing, filters, follow-ups, fan-out), unit tested
dashboard/js/map.js      Leaflet markers, selection and fit
dashboard/js/views.js    roster, record and queue rendering
dashboard/js/importer.js import dialog, upload, browser preview, debrief
dashboard/js/demo.js     synthetic demo territory
dashboard/vendor/        Leaflet 1.9.4 and the OFL fonts
docs/                    import format, design system, QA handoff prompt
templates/               empty CSV header template
tests/                   unittest suites, JS unit tests, synthetic fixture, Playwright browser QA
AGENT_README.md          handoff instructions for an AI agent
```

## Status

Working and tested against synthetic data. The dashboard was rebuilt in September 2026. There's no login yet and no license file.

Maintained by Jonathan Bruce ([@whosebruce](https://github.com/whosebruce)).
