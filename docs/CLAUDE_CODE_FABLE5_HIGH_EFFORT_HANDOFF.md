# Claude Code / Fable 5 High-Effort Handoff Prompt

Copy/paste this into Claude Code or another high-effort coding agent after cloning this repository.

---

You are working in the `client-intel-dashboard` repository.

## Mission

Make the Client Intel Dashboard reliable enough for a nontechnical small-business owner to import customer/contact data, verify all UI buttons work, and see **accurate individual address markers** on a map.

This is **not** supposed to be a heat map and **not** supposed to compress customers into broad territory blobs. The user wants to zoom in and see as many individual customers/addresses as possible.

Repo goals:

- Keep the app local-first and privacy-safe.
- Keep private CRM/customer data out of git.
- Keep generated `dashboard/clients.json` and geocoded outputs ignored.
- Prefer deterministic local code/tests over “trust me” manual claims.

## Human requirements / acceptance criteria

1. **Button QA**
   - Verify every visible button/control actually does something useful and does not throw console errors.
   - Test desktop and mobile layouts.
   - Controls to verify:
     - `Load data`
     - browser-only CSV/JSON import path
     - backend upload import path when `python3 server.py` is running
     - `Export CSV`
     - `Fit territory`
     - `Hide panels` / `Show panels`
     - individual panel `Hide` buttons
     - left rail map/client/follow-up buttons
     - mobile tabs: Clients, Map, Details, Queue
     - client row click
     - marker click
     - `Copy call sheet`
     - `Directions`
     - search box
     - status filter
   - Add automated Playwright or equivalent browser checks if practical. If not practical, document exact manual QA steps and results.

2. **Exact address geocoding**
   - If rows include full street addresses but no `lat`/`lng`, support Google Maps Geocoding through a local environment variable:

     ```bash
     export GOOGLE_MAPS_API_KEY="<local key, never commit>"
     python3 scripts/ingest.py --json --geocode
     ```

   - If rows already have approximate/city-level coordinates, support replacing them with exact street-address coordinates:

     ```bash
     python3 scripts/ingest.py --json --geocode --refresh-geocodes
     ```

   - Do not expose or commit the API key.
   - Do not commit private customer rows, generated `clients.json`, `.env`, or geocoded output files.
   - The final importer summary should clearly report:
     - `geocoding_enabled`
     - `geocoded`
     - `failed_geocodes`
     - whether geocodes came from exact street addresses or existing coordinates.

3. **Map behavior: no heatmap, no broad compression**
   - Do **not** implement heatmap tiles, density blobs, or marker clustering that hides individual customers by default.
   - Keep individual customer markers visible as discrete markers.
   - If many customers share the same exact coordinate or are extremely close:
     - Prefer a spiderfy/overlapping-marker solution, small deterministic offsets at max zoom, or an expanded popup/list for same-coordinate records.
     - Do **not** silently collapse them into one marker with no way to inspect each customer.
   - When zooming in, the user should be able to distinguish and select individual customers in the area whenever possible.
   - `Fit territory` should show all current filtered markers but should not force a city-level “compressed” view after the user zooms in.

4. **Import/schema clarity**
   - Keep docs easy for another AI agent or small-business owner to follow.
   - `docs/IMPORT_FORMAT.md` and `AGENT_README.md` should explain:
     - supported file types
     - required/recommended fields
     - Google Maps geocoding setup
     - privacy rules
     - what final report should include without leaking customer rows.

5. **Visual polish without breaking function**
   - Preserve the current warm dark dashboard direction unless there is a clear reason to adjust.
   - Mobile should remain usable.
   - Map should not sit behind panels in a way that makes controls feel broken.

## Suggested technical approach

1. Inspect current implementation:

   ```bash
   git status -sb
   find . -maxdepth 3 -type f | sort
   sed -n '1,220p' README.md
   sed -n '1,240p' AGENT_README.md
   sed -n '1,220p' docs/IMPORT_FORMAT.md
   sed -n '1,260p' scripts/ingest.py
   sed -n '1,260p' server.py
   sed -n '1,260p' dashboard/index.html
   ```

2. Run baseline checks:

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

3. Add a temporary local fixture only if needed. Keep it synthetic and delete it before commit unless it belongs under a clearly sanitized test fixture path.

4. Test browser behavior with Playwright if available. At minimum:
   - load page
   - watch console errors
   - click all controls
   - upload a synthetic CSV/JSON
   - verify marker count matches mapped records
   - verify selecting a row/marker opens details
   - verify export produces a CSV
   - verify directions button opens a Google Maps URL based on address or lat/lng
   - verify mobile viewport tabs work.

5. If implementing overlapping-marker behavior, document it in README/AGENT_README:
   - exactly what happens for same-coordinate customers
   - how to select each one
   - why it is not a heatmap or cluster.

## Privacy / safety constraints

- Never commit:
  - private CRM exports
  - SMS XML dumps
  - Google Sheets exports with real rows
  - `dashboard/clients.json`
  - generated geocoded files
  - `.env`
  - API keys
- Do not paste raw private customer data into chat, issues, commit messages, or PR bodies.
- Use counts and file paths in final reports, not rows.

## Final response required from the coding agent

Return a concise report with:

- commit SHA(s)
- what changed
- exact test commands run and real outputs/statuses
- button/control QA summary
- geocoding status
- map behavior status, explicitly confirming: `no heatmap`, `no default marker clustering`, and how overlapping/same-address records are handled
- blockers or credentials needed, if any

Do not claim success without actual command/browser test evidence.
