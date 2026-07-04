/* Browser QA for the Client Intel Dashboard.
 *
 * Usage:
 *   1. python3 server.py            (or PORT=8767 python3 server.py)
 *   2. Seed synthetic data first (see tests/browser/README.md)
 *   3. cd tests/browser && npm install && node qa.js [baseURL]
 *
 * Exercises every visible control on desktop and mobile viewports and fails
 * on any console/page error. Uses only synthetic data.
 */
const { chromium } = require('playwright');

const BASE = process.argv[2] || 'http://127.0.0.1:8767/';
let passed = 0, failed = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  ok ? passed++ : failed++;
};

const collectErrors = (page, sink) => {
  page.on('console', m => { if (m.type() === 'error') sink.push(`console: ${m.text()}`); });
  page.on('pageerror', e => sink.push(`pageerror: ${e.message}`));
};
const tileNoise = e => /tile\.openstreetmap\.org|net::ERR|Failed to load resource/i.test(e);

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE.replace(/\/$/, '') });
  const page = await ctx.newPage();
  const errors = [];
  collectErrors(page, errors);

  // ---- A. initial load ----
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const note = await page.textContent('#datasetNote');
  check('page loads and reads clients.json', /clients\.json/.test(note), note.trim());
  const clientCount = await page.evaluate(() => state.clients.length);
  const markerCount = await page.evaluate(() => state.markers.length);
  check('marker count matches mapped records', clientCount > 0 && markerCount === clientCount, `${markerCount}/${clientCount}`);
  const positions = await page.evaluate(() => state.markers.map(m => { const p = m.getLatLng(); return p.lat.toFixed(7) + ',' + p.lng.toFixed(7); }));
  check('same-coordinate records get distinct marker positions (no silent stacking)', new Set(positions).size === positions.length, positions.join(' | '));
  const heatOrCluster = await page.evaluate(() => !!(window.L && (L.heatLayer || L.markerClusterGroup)));
  check('no heatmap / no cluster plugin loaded', !heatOrCluster);

  // ---- B. search + status filter ----
  await page.fill('#search', 'Gamma');
  await page.waitForTimeout(100);
  check('search filters rows + markers', await page.evaluate(() => state.markers.length) === 1 &&
    await page.locator('.client').count() === 1);
  await page.fill('#search', '');
  await page.selectOption('#statusFilter', 'paid');
  await page.waitForTimeout(100);
  const paidRows = await page.locator('.client').count();
  check('status filter shows only paid', paidRows === 1 && await page.evaluate(() => state.markers.length) === 1, `${paidRows} row(s)`);
  await page.selectOption('#statusFilter', 'all');
  await page.waitForTimeout(100);

  // ---- C. row click + marker click ----
  await page.locator('.client').first().click();
  const detailName = await page.textContent('#detailName');
  check('client row click opens details', detailName !== 'Pick a client', detailName);
  const twinPopup = await page.evaluate(() => {
    const twin = state.clients.find(c => c._twins > 1);
    if (!twin) return 'NO-TWIN-DATA';
    const m = state.markers[state.clients.filter(c => Number.isFinite(c.lat)).indexOf(twin)];
    return 'has-twins';
  });
  // click a marker directly via its DOM element
  await page.locator('.marker-label').last().click();
  await page.waitForTimeout(700);
  check('marker click selects a client', await page.evaluate(() => !!state.selected));
  const popupText = await page.evaluate(() => {
    const twin = state.markers.map((m, i) => ({ m, i })).find(({ m }) => (m.getPopup()?.getContent() || '').includes('share this exact location'));
    return twin ? 'popup-mentions-shared-location' : 'missing';
  });
  check('same-address popup explains fanned markers', popupText === 'popup-mentions-shared-location', twinPopup);

  // ---- D. fit territory + zoom-in separation ----
  await page.click('#fitBtn');
  await page.waitForTimeout(400);
  const fitZoom = await page.evaluate(() => map.getZoom());
  check('Fit territory fits filtered markers (zoom <= 13)', fitZoom <= 13, `zoom ${fitZoom}`);
  const pixelGap = await page.evaluate(() => {
    const twins = state.clients.filter(c => c._twins > 1);
    if (twins.length < 2) return -1;
    map.setView([twins[0].lat, twins[0].lng], 18, { animate: false });
    const a = map.latLngToContainerPoint([twins[0]._dlat, twins[0]._dlng]);
    const b = map.latLngToContainerPoint([twins[1]._dlat, twins[1]._dlng]);
    return Math.hypot(a.x - b.x, a.y - b.y);
  });
  check('zoomed-in same-address markers are visually separated (>=20px at z18)', pixelGap >= 20, `${Math.round(pixelGap)}px`);
  const zoomAfter = await page.evaluate(() => map.getZoom());
  check('zooming in is not overridden back to a compressed view', zoomAfter === 18, `zoom ${zoomAfter}`);

  // ---- E. panel toggles + rail ----
  await page.click('#panelToggle');
  const focus = await page.evaluate(() => document.querySelector('.app').classList.contains('focus-map'));
  const toggleTxt = await page.textContent('#panelToggle');
  check('Hide panels enters map focus mode', focus && toggleTxt === 'Show panels');
  await page.click('#panelToggle');
  check('Show panels restores layout', await page.evaluate(() => !document.querySelector('.app').classList.contains('focus-map')));
  for (const p of ['left', 'detail', 'queue']) {
    await page.click(`.panel-close[data-panel="${p}"]`);
    check(`panel Hide button hides ${p}`, await page.evaluate(cls => document.querySelector('.app').classList.contains(cls), `hide-${p}`));
  }
  await page.click('#railClients');
  check('rail Clients button restores client panel', await page.evaluate(() => !document.querySelector('.app').classList.contains('hide-left')));
  await page.click('#railQueue');
  check('rail Queue button restores queue', await page.evaluate(() => !document.querySelector('.app').classList.contains('hide-queue')));
  await page.locator('.client').first().click(); // restores detail via selectClient
  check('selecting a client restores detail panel', await page.evaluate(() => !document.querySelector('.app').classList.contains('hide-detail')));
  await page.click('#railMap');
  await page.waitForTimeout(300);
  check('rail Map button fits map', await page.evaluate(() => map.getZoom()) <= 13);

  // ---- F. copy call sheet + directions ----
  await page.click('#copyCallSheet');
  await page.waitForTimeout(150);
  const toast1 = await page.textContent('#toast');
  check('Copy call sheet copies + toasts', /copied/i.test(toast1), toast1.trim());
  const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
  check('call sheet clipboard content has name + status', /Status:/.test(clip));
  const [popup] = await Promise.all([page.waitForEvent('popup'), page.click('#directionsBtn')]);
  const popupUrl = popup.url();
  await popup.close();
  check('Directions opens Google Maps dir URL', popupUrl.startsWith('https://www.google.com/maps/dir/?api=1&destination='), popupUrl.slice(0, 80));

  // ---- G. export CSV ----
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#exportBtn')]);
  const path = await download.path();
  const fs = require('fs');
  const csv = fs.readFileSync(path, 'utf-8').trim().split('\n');
  check('Export CSV downloads header + all records', csv[0].startsWith('name,address') && csv.length === 1 + clientCount, `${csv.length} lines`);

  // ---- H. browser-only import fallback (backend blocked) ----
  await page.route('**/api/upload', r => r.abort());
  const csvBody = 'name,address,city,lat,lng,status,phone\n' +
    'Preview One,"1 Preview Way, Faketown, CA",Faketown,33.0001,-117.0001,lead,555-111-0001\n' +
    'Preview Two,"2 Preview Way, Faketown, CA",Faketown,33.0002,-117.0002,paid,555-111-0002\n' +
    'Preview NoCoords,"3 Preview Way, Faketown, CA",Faketown,,,lead,555-111-0003\n';
  await page.setInputFiles('#fileInput', { name: 'preview.csv', mimeType: 'text/csv', buffer: Buffer.from(csvBody) });
  await page.waitForTimeout(500);
  const previewNote = await page.textContent('#datasetNote');
  const previewCount = await page.evaluate(() => state.clients.length);
  check('browser-only CSV preview maps coordinate rows', /browser-only preview/.test(previewNote) && previewCount === 2, `${previewCount} records`);
  const nullIsland = await page.evaluate(() => state.clients.some(c => c.lat === 0 || c.lng === 0));
  check('rows with blank lat/lng are skipped (no Null Island markers)', !nullIsland);
  const skipToast = await page.textContent('#toast');
  check('preview toast reports skipped no-coord rows + geocoding hint', /skipped without usable lat\/lng/.test(skipToast), skipToast.slice(0, 90));
  // unsupported type in browser-only mode
  await page.setInputFiles('#fileInput', { name: 'export.xlsx', mimeType: 'application/octet-stream', buffer: Buffer.from('PK-fake') });
  await page.waitForTimeout(400);
  const xlsxToast = await page.textContent('#toast');
  check('browser-only .xlsx explains backend is needed', /need/i.test(xlsxToast) && /server\.py/.test(xlsxToast), xlsxToast.slice(0, 90));
  await page.unroute('**/api/upload');

  // ---- I. backend upload path via Load data ----
  const uploadBody = 'name,address,city,lat,lng,status,phone\n' +
    'Test Epsilon,"78 Upload Rd, Faketown, CA 90003",Faketown,32.7357,-117.1811,lead,555-000-0005\n';
  await page.setInputFiles('#fileInput', { name: 'synthetic-upload-ui.csv', mimeType: 'text/csv', buffer: Buffer.from(uploadBody) });
  await page.waitForTimeout(1500);
  const uploadToast = await page.textContent('#toast');
  const afterUpload = await page.evaluate(() => state.clients.length);
  check('backend upload imports and refreshes dashboard', /Imported 1 file/.test(uploadToast) && afterUpload === clientCount + 1, `${afterUpload} records`);
  check('Load data button opens file picker (wired)', await page.evaluate(() => !!document.getElementById('loadBtn').onclick));

  const realErrors = errors.filter(e => !tileNoise(e));
  check('no console/page errors on desktop', realErrors.length === 0, realErrors.join(' ;; ').slice(0, 300));

  // ---- J. mobile viewport ----
  const mErrors = [];
  const mPage = await ctx.newPage();
  collectErrors(mPage, mErrors);
  await mPage.setViewportSize({ width: 390, height: 844 });
  await mPage.goto(BASE, { waitUntil: 'networkidle' });
  check('mobile tabs visible', await mPage.locator('.mobile-tabs').isVisible());
  await mPage.click('.mobile-tabs button[data-tab="map"]');
  check('mobile Map tab hides panels', await mPage.evaluate(() => !document.getElementById('clientsPanel').classList.contains('mobile-active')));
  await mPage.click('.mobile-tabs button[data-tab="clients"]');
  check('mobile Clients tab shows list', await mPage.locator('#clientsPanel').isVisible());
  await mPage.locator('.client').first().click();
  await mPage.waitForTimeout(700);
  check('mobile row click jumps to Details tab', await mPage.locator('#detailPanel').isVisible());
  await mPage.click('.mobile-tabs button[data-tab="queue"]');
  check('mobile Queue tab shows follow-ups', await mPage.locator('.queue').isVisible());
  await mPage.click('.mobile-tabs button[data-tab="map"]');
  await mPage.locator('.marker-label').first().click({ force: true });
  await mPage.waitForTimeout(700);
  check('mobile marker click opens details', await mPage.locator('#detailPanel').isVisible());
  await mPage.click('.panel-close[data-panel="detail"]');
  check('mobile panel Hide returns to map', await mPage.evaluate(() => !document.getElementById('detailPanel').classList.contains('mobile-active')));
  const mReal = mErrors.filter(e => !tileNoise(e));
  check('no console/page errors on mobile', mReal.length === 0, mReal.join(' ;; ').slice(0, 300));

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('QA crashed:', e); process.exit(2); });
