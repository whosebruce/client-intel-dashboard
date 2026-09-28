// Import dialog: server upload first, browser-only preview (CSV/JSON) as the
// fallback, then a debrief of what came in.
import * as D from './data.js';

const $ = (id) => document.getElementById(id);
const { esc } = D;
const ACCEPT = '.csv,.xlsx,.json,.xml,.zip';

export function createImporter({ isServerOnline, onServerImported, onPreview, onDemo, onDone, toast }) {
  const dialog = $('importDialog');
  const body = $('importBody');
  const input = $('fileInput');
  input.accept = ACCEPT;
  input.addEventListener('change', () => { const files = [...input.files]; input.value = ''; handleFiles(files); });
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog || e.target.closest('[data-close]')) dialog.close();
    const act = e.target.closest('[data-imp]')?.dataset.imp;
    if (act === 'choose') input.click();
    if (act === 'template') downloadTemplate();
    if (act === 'demo') { dialog.close(); onDemo(); }
    if (act === 'done') { dialog.close(); onDone(); }
    if (act === 'again') showPick();
  });
  dialog.addEventListener('dragover', (e) => { e.preventDefault(); dialog.querySelector('.drop')?.classList.add('is-over'); });
  dialog.addEventListener('dragleave', (e) => { if (!dialog.contains(e.relatedTarget)) dialog.querySelector('.drop')?.classList.remove('is-over'); });
  dialog.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); handleFiles([...(e.dataTransfer?.files || [])]); });

  function open() {
    showPick();
    if (!dialog.open) dialog.showModal();
  }

  function showPick() {
    const online = isServerOnline();
    body.innerHTML = `
      <p class="mode-note" data-tone="${online ? 'ok' : 'warn'}">${online
        ? '<b>Local server online.</b> Files are saved to <code>data/raw/</code> on this machine, the importer merges duplicates, and the map refreshes.'
        : '<b>Preview mode.</b> The local server is not running, so CSV and JSON load in this browser only and nothing is saved. Start <code>python3 server.py</code> to keep imports and read XLSX or SMS backups.'}</p>
      <div class="drop">
        <b>Drop files here</b>
        <p>or pick them from this computer</p>
        <button class="btn btn--signal" data-imp="choose">Choose files</button>
        <span class="types">.CSV · .XLSX · .JSON · .XML (SMS BACKUP) · .ZIP</span>
      </div>
      <p class="mode-note">Best columns: <code>name, address, city, lat, lng, status, phone, last_contact, value, follow_up, notes</code>. Status is paid, unpaid or lead. Common headers like Customer Name, Service Address and Balance are recognized.</p>
      <div class="dlg-row">
        <button class="btn" data-imp="template">Download CSV template</button>
        <button class="btn" data-imp="demo">Load demo data</button>
      </div>`;
  }

  function showWorking(files) {
    body.innerHTML = `<div class="working"><i></i>Importing ${files.length} file${files.length === 1 ? '' : 's'}</div>`;
  }

  function showServerDebrief(out) {
    const s = out.summary || {};
    const dropped = s.records_without_coordinates_dropped || 0;
    const lines = [
      `${s.paid || 0} paid · ${s.unpaid || 0} due · ${s.lead || 0} leads on the map.`,
      s.geocoding_enabled
        ? `Geocoded ${s.geocoded || 0} addresses (${s.geocoded_exact_street || 0} street-exact, ${s.geocoded_approximate || 0} approximate). ${s.failed_geocodes || 0} failed, ${s.kept_existing_coordinates || 0} kept their existing coordinates.`
        : '',
      dropped
        ? `${dropped} record${dropped === 1 ? ' has' : 's have'} no coordinates and stayed off the map. Add lat/lng columns, or export GOOGLE_MAPS_API_KEY before starting server.py so street addresses get geocoded.`
        : '',
      (out.saved || []).some((p) => p.includes('google_takeout'))
        ? 'ZIP files were saved to data/raw/google_takeout/, but the importer does not read that folder yet.'
        : '',
    ].filter(Boolean);
    body.innerHTML = `
      <div class="mono">Import debrief</div>
      <div class="debrief">
        ${stat(out.saved?.length || 0, 'Files saved')}
        ${stat(s.raw_records || 0, 'Rows read')}
        ${stat(s.records || 0, 'On the map')}
        ${stat(s.merged_duplicates || 0, 'Merged dupes')}
        ${stat(s.duplicate_groups || 0, 'Duplicate groups')}
        ${stat(dropped, 'Off-map', dropped > 0)}
      </div>
      <ul class="debrief-lines">${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
      <div class="dlg-row"><button class="btn btn--signal" data-imp="done">View territory</button><button class="btn" data-imp="again">Import more</button></div>`;
  }

  function showPreviewDebrief({ files, rows, mapped, skipped, unsupported, reason }) {
    body.innerHTML = `
      <p class="mode-note" data-tone="warn"><b>Browser-only preview.</b> ${esc(reason)} Nothing was saved. Start <code>python3 server.py</code> to keep imports.</p>
      <div class="debrief">
        ${stat(files, 'Files read')}
        ${stat(rows, 'Rows read')}
        ${stat(mapped, 'On the map')}
        ${stat(skipped, 'No lat/lng', skipped > 0)}
        ${stat(unsupported.length, 'Need server', unsupported.length > 0)}
      </div>
      <ul class="debrief-lines">
        ${skipped ? `<li>${skipped} row${skipped === 1 ? '' : 's'} skipped without usable lat/lng. The server importer can geocode street addresses when GOOGLE_MAPS_API_KEY is set.</li>` : ''}
        ${unsupported.length ? `<li>${esc(unsupported.map((f) => f.name).join(', '))} need the local server.</li>` : ''}
      </ul>
      <div class="dlg-row"><button class="btn btn--signal" data-imp="done">View territory</button><button class="btn" data-imp="again">Import more</button></div>`;
  }

  function showError(title, detail) {
    body.innerHTML = `<p class="mode-note" data-tone="warn"><b>${esc(title)}</b> ${esc(detail)}</p>
      <div class="dlg-row"><button class="btn btn--signal" data-imp="again">Try again</button></div>`;
  }

  const stat = (n, label, warn = false) => `<div class="${warn ? 'is-warn' : ''}"><b>${n}</b><span>${esc(label)}</span></div>`;

  async function handleFiles(files) {
    if (!files.length) return;
    if (!dialog.open) dialog.showModal();
    showWorking(files);

    let reason = 'The local server is not reachable.';
    try {
      const fd = new FormData();
      files.forEach((f) => fd.append('files', f, f.name));
      const res = await fetch('api/upload', { method: 'POST', body: fd });
      let out = null;
      try { out = await res.json(); } catch { /* not JSON */ }
      if (res.ok && out?.ok) {
        await onServerImported(out);
        showServerDebrief(out);
        toast(`Imported ${out.saved.length} file(s). Records: ${out.summary?.records || 0}. Duplicate groups: ${out.summary?.duplicate_groups || 0}.`);
        return;
      }
      if (res.status !== 404 && res.status !== 405) {
        reason = 'The server import failed (see the server log), so this is a browser-only preview.';
        toast('Server import failed — falling back to browser-only preview.', 'warn');
      }
    } catch { /* offline: fall through to preview */ }

    const readable = files.filter((f) => /\.(csv|json)$/i.test(f.name));
    const unsupported = files.filter((f) => !/\.(csv|json)$/i.test(f.name));
    if (!readable.length) {
      const ext = unsupported[0].name.split('.').pop().toLowerCase();
      showError('Local server needed.', `.${ext} files need the backend: run python3 server.py, then import again. Browser-only preview reads CSV and JSON.`);
      toast(`Backend not reachable and .${ext} files need it: run python3 server.py, then import again. Browser-only preview supports CSV/JSON.`, 'warn');
      return;
    }
    let rows = [];
    try {
      for (const f of readable) {
        const text = await f.text();
        rows = rows.concat(/\.json$/i.test(f.name) ? D.rowsFromJson(JSON.parse(text)) : D.parseCsv(text));
      }
    } catch {
      showError('Could not read that file.', 'Use CSV or JSON in the documented schema.');
      toast('Could not read that file. Use CSV/JSON in the documented schema.', 'bad');
      return;
    }
    const { records, skipped } = D.cleanRows(rows);
    onPreview(records);
    showPreviewDebrief({ files: readable.length, rows: rows.length, mapped: records.length, skipped, unsupported, reason });
    toast(`Loaded ${records.length} of ${rows.length} rows in browser-only preview.${skipped > 0 ? ` ${skipped} row(s) skipped without usable lat/lng.` : ''} Run python3 server.py to keep imports.`, 'warn');
  }

  function downloadTemplate() {
    const blob = new Blob([D.FIELDS.join(',') + '\n'], { type: 'text/csv' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'client_import_template.csv' });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  return { open, handleFiles, isOpen: () => dialog.open };
}
