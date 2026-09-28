/* Browser QA for the Client Intel Dashboard.
 *
 * Usage:
 *   1. PORT=8767 python3 server.py
 *   2. Seed synthetic data first (see tests/browser/README.md)
 *   3. cd tests/browser && npm install && node qa.js [baseURL]
 *
 * Exercises every visible control on desktop, tablet and phone viewports and
 * fails on any console/page error. Uses only synthetic data. Reads app state
 * through the window.cid debug hook in dashboard/js/main.js.
 */
const fs = require('fs');
const { chromium } = require('playwright');

const BASE = process.argv[2] || 'http://127.0.0.1:8767/';
let passed = 0, failed = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  ok ? passed++ : failed++;
};
const collectErrors = (page, sink) => {
  page.on('console', (m) => { if (m.type() === 'error') sink.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => sink.push(`pageerror: ${e.message}`));
};
const tileNoise = (e) => /tile\.openstreetmap\.org|net::ERR|Failed to load resource/i.test(e);
const count = (page) => page.evaluate(() => cid.state.clients.length);
const markerCount = (page) => page.evaluate(() => cid.markers.size);
const settle = (page, ms = 150) => page.waitForTimeout(ms);

// Use Playwright's bundled Chromium, or the installed Chrome if that build isn't downloaded.
const launch = () => chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));

(async () => {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE.replace(/\/$/, '') });
  const page = await ctx.newPage();
  const errors = [];
  collectErrors(page, errors);

  // ---- A. initial load ----
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.cid && cid.state.source !== 'none', null, { timeout: 5000 }).catch(() => {});
  const status = await page.textContent('#dataStatus');
  check('page loads clients.json and sees the server', /clients\.json/.test(status) && /server online/.test(status), status.trim());
  const clientCount = await count(page);
  check('marker count matches mapped records', clientCount > 0 && (await markerCount(page)) === clientCount, `${await markerCount(page)}/${clientCount}`);
  const positions = await page.evaluate(() => [...cid.markers.values()].map((m) => { const p = m.marker.getLatLng(); return p.lat.toFixed(7) + ',' + p.lng.toFixed(7); }));
  check('same-coordinate records get distinct marker positions (no silent stacking)', new Set(positions).size === positions.length, positions.join(' | '));
  check('no heatmap / no cluster plugin loaded', !(await page.evaluate(() => !!(L.heatLayer || L.markerClusterGroup))));
  check('a record is selected on load', /\w/.test(await page.textContent('#recName').catch(() => '')));
  check('status tiles show counts', (await page.textContent('.stat--all b')).trim() === String(clientCount));

  // ---- B. search, status tiles, sort, map-area ----
  await page.fill('#search', 'Gamma');
  await settle(page);
  check('search filters rows + markers', (await markerCount(page)) === 1 && (await page.locator('#list .row').count()) === 1);
  await page.fill('#search', '555-000-0003');
  await settle(page);
  check('search matches phone numbers', (await page.locator('#list .row').count()) === 1);
  await page.fill('#search', '');
  await page.click('.stat--paid');
  await settle(page);
  const paidRows = await page.locator('#list .row').count();
  check('Paid tile shows only paid', paidRows === 1 && (await markerCount(page)) === 1 && (await page.getAttribute('.stat--paid', 'aria-pressed')) === 'true', `${paidRows} row(s)`);
  await page.click('.stat--paid');
  await settle(page);
  check('clicking the active tile returns to All', (await page.locator('#list .row').count()) === clientCount);
  await page.selectOption('#sort', 'name');
  await settle(page);
  const firstByName = (await page.textContent('#list .row .row-name')).trim();
  await page.selectOption('#sort', 'value');
  await settle(page);
  const firstByValue = (await page.textContent('#list .row .row-name')).trim();
  check('sort select reorders the roster', firstByName === 'Test Alpha' && firstByValue === 'Test Alpha', `${firstByName} / ${firstByValue}`);
  await page.selectOption('#sort', 'follow_up');
  await page.evaluate(() => cid.map.setView([33.5, -116.2], 12, { animate: false }));
  await page.click('#inViewBtn');
  await settle(page, 300);
  check('Map area toggle limits the roster to the visible map', (await page.locator('#list .row').count()) === 0 && (await page.getAttribute('#inViewBtn', 'aria-pressed')) === 'true');
  await page.click('#inViewBtn');
  await settle(page);

  // ---- C. row click + marker click ----
  const rowName = (await page.locator('#list .row .row-name').nth(1).textContent()).trim();
  await page.locator('#list .row').nth(1).click();
  await settle(page, 300);
  check('roster row click opens the record', (await page.textContent('#recName')).trim() === rowName, rowName);
  await page.locator('.leaflet-marker-icon').last().click();
  await page.waitForTimeout(700);
  const selectedAfterMarker = await page.evaluate(() => cid.state.selectedId);
  check('marker click selects a record', !!selectedAfterMarker);
  const twinPopup = await page.evaluate(() => [...cid.markers.values()].some((m) => (m.marker.getPopup()?.getContent() || '').includes('share this exact location')));
  check('same-address popup explains fanned markers', twinPopup);
  check('record shows the shared-location note for twins', await page.evaluate(() => {
    const twin = [...cid.markers.values()].find((m) => m.pos.twins > 1);
    cid.select(twin.rec.id);
    return /share this exact location/.test(document.getElementById('recordBody').textContent);
  }));
  const nearby = await page.locator('.nearby button').count();
  check('record lists nearby records', nearby > 0, `${nearby} nearby`);
  await page.locator('.nearby button').first().click();
  await settle(page, 300);
  check('nearby entry selects that record', (await page.evaluate(() => cid.state.selectedId)) !== selectedAfterMarker);

  // ---- D. fit territory + zoom-in separation ----
  await page.click('#fitBtn');
  await page.waitForTimeout(500);
  const fitZoom = await page.evaluate(() => cid.map.getZoom());
  check('Fit territory fits filtered markers (zoom <= 13)', fitZoom <= 13, `zoom ${fitZoom}`);
  const pixelGap = await page.evaluate(() => {
    const twins = [...cid.markers.values()].filter((m) => m.pos.twins > 1);
    if (twins.length < 2) return -1;
    cid.map.setView([twins[0].rec.lat, twins[0].rec.lng], 18, { animate: false });
    const a = cid.map.latLngToContainerPoint([twins[0].pos.lat, twins[0].pos.lng]);
    const b = cid.map.latLngToContainerPoint([twins[1].pos.lat, twins[1].pos.lng]);
    return Math.hypot(a.x - b.x, a.y - b.y);
  });
  check('zoomed-in same-address markers are visually separated (>=20px at z18)', pixelGap >= 20, `${Math.round(pixelGap)}px`);
  check('zooming in is not overridden back to a compressed view', (await page.evaluate(() => cid.map.getZoom())) === 18);
  check('pins show initials when zoomed in', !(await page.evaluate(() => document.getElementById('map').classList.contains('is-far'))));

  // ---- E. panel toggles, focus mode ----
  const hasClass = (cls) => page.evaluate((c) => document.getElementById('app').classList.contains(c), cls);
  await page.click('#focusBtn');
  check('Focus map hides every panel', (await hasClass('focus')) && (await page.getAttribute('#focusBtn', 'aria-pressed')) === 'true' && !(await page.locator('#roster').isVisible()));
  await page.click('#focusBtn');
  check('Focus map again restores the panels', !(await hasClass('focus')) && (await page.locator('#roster').isVisible()));
  for (const p of ['roster', 'record', 'queue']) {
    await page.click(`[data-hide="${p}"]`);
    check(`panel Hide button hides ${p}`, (await hasClass(`hide-${p}`)) && !(await page.locator(`#${p}`).isVisible()));
  }
  await page.click('.seg [data-panel="roster"]');
  check('Roster toggle brings the roster back', !(await hasClass('hide-roster')) && (await page.getAttribute('.seg [data-panel="roster"]', 'aria-pressed')) === 'true');
  await page.click('.seg [data-panel="queue"]');
  check('Queue toggle brings the queue back', !(await hasClass('hide-queue')));
  await page.locator('#list .row').first().click();
  check('selecting a record restores the record panel', !(await hasClass('hide-record')) && (await page.locator('#record').isVisible()));
  await page.locator('#queueCols .qitem').first().click();
  await settle(page, 300);
  check('queue card selects its record', (await page.evaluate(() => cid.state.selectedId)) === (await page.locator('#queueCols .qitem').first().getAttribute('data-id')));

  // ---- F. copy call sheet, directions, call/text links ----
  await page.click('#copyBtn');
  await settle(page);
  const toast1 = await page.textContent('#toast');
  check('Copy sheet copies + toasts', /copied/i.test(toast1), toast1.trim());
  const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
  check('call sheet clipboard content has name + status', /Status:/.test(clip) && /Follow-up:/.test(clip));
  // Capture what window.open receives instead of loading Google Maps.
  await page.evaluate(() => { window.__opened = []; window.open = (url) => { window.__opened.push(url); return null; }; });
  await page.click('#directionsBtn');
  const popupUrl = await page.evaluate(() => window.__opened[0] || '');
  check('Route opens a Google Maps directions URL', popupUrl.startsWith('https://www.google.com/maps/dir/?api=1&destination='), popupUrl.slice(0, 80));
  check('Call and Text use tel: and sms: links', /^tel:\d+/.test(await page.getAttribute('#callBtn', 'href')) && /^sms:\d+/.test(await page.getAttribute('#textBtn', 'href')));

  // ---- G. export CSV ----
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#exportBtn')]);
  const csv = fs.readFileSync(await download.path(), 'utf-8').trim().split('\n');
  check('Export CSV downloads header + all records', csv[0].startsWith('name,address') && csv.length === 1 + clientCount, `${csv.length} lines`);

  // ---- H. keyboard + theme + help ----
  const before = await page.evaluate(() => cid.state.selectedId);
  await page.keyboard.press('j');
  check('J moves to the next record', (await page.evaluate(() => cid.state.selectedId)) !== before);
  await page.keyboard.press('/');
  check('/ focuses search', await page.evaluate(() => document.activeElement.id === 'search'));
  await page.keyboard.press('Escape');
  await page.keyboard.press('t');
  check('T switches to day mode', (await page.getAttribute('html', 'data-theme')) === 'day');
  await page.click('#themeBtn');
  check('theme button switches back to night', (await page.getAttribute('html', 'data-theme')) === 'night');
  await page.click('#helpBtn');
  check('? opens the shortcuts dialog', await page.locator('#helpDialog').isVisible());
  await page.keyboard.press('Escape');
  check('Escape closes the dialog', !(await page.locator('#helpDialog').isVisible()));

  // ---- I. demo data ----
  await page.click('#importBtn');
  check('Import opens the import dialog with server mode', (await page.locator('#importDialog').isVisible()) && /server online/i.test(await page.textContent('#importBody')));
  await page.click('[data-imp="demo"]');
  await settle(page, 300);
  check('Load demo data swaps in synthetic records', (await page.evaluate(() => cid.state.source)) === 'demo' && (await count(page)) === 36 && /Demo data/.test(await page.textContent('#notices')));
  await page.click('[data-action="clear-demo"]');
  await page.waitForFunction(() => cid.state.source === 'file');
  check('Clear demo goes back to clients.json', (await count(page)) === clientCount);

  // ---- J. browser-only import fallback (backend blocked) ----
  await page.route('**/api/upload', (r) => r.abort());
  const csvBody = 'name,address,city,lat,lng,status,phone\n' +
    'Preview One,"1 Preview Way, Faketown, CA",Faketown,33.0001,-117.0001,lead,555-111-0001\n' +
    'Preview Two,"2 Preview Way, Faketown, CA",Faketown,33.0002,-117.0002,paid,555-111-0002\n' +
    'Preview NoCoords,"3 Preview Way, Faketown, CA",Faketown,,,lead,555-111-0003\n';
  await page.setInputFiles('#fileInput', { name: 'preview.csv', mimeType: 'text/csv', buffer: Buffer.from(csvBody) });
  await page.waitForFunction(() => cid.state.source === 'preview', null, { timeout: 3000 }).catch(() => {});
  check('browser-only CSV preview maps coordinate rows', (await page.textContent('#dataStatus')).includes('Browser preview') && (await count(page)) === 2, `${await count(page)} records`);
  check('rows with blank lat/lng are skipped (no Null Island markers)', !(await page.evaluate(() => cid.state.clients.some((c) => c.lat === 0 || c.lng === 0))));
  const skipToast = await page.textContent('#toast');
  check('preview toast reports skipped no-coord rows', /skipped without usable lat\/lng/.test(skipToast), skipToast.slice(0, 90));
  check('preview debrief shows in the dialog', /Browser-only preview/.test(await page.textContent('#importBody')));
  await page.setInputFiles('#fileInput', { name: 'export.xlsx', mimeType: 'application/octet-stream', buffer: Buffer.from('PK-fake') });
  await settle(page, 400);
  const xlsxToast = await page.textContent('#toast');
  check('browser-only .xlsx explains the backend is needed', /need/i.test(xlsxToast) && /server\.py/.test(xlsxToast), xlsxToast.slice(0, 90));
  await page.unroute('**/api/upload');

  // ---- K. backend upload path ----
  await page.click('[data-imp="again"]');
  const uploadBody = 'name,address,city,lat,lng,status,phone\n' +
    'Test Epsilon,"78 Upload Rd, Faketown, CA 90003",Faketown,32.7357,-117.1811,lead,555-000-0005\n';
  await page.setInputFiles('#fileInput', { name: 'synthetic-upload-ui.csv', mimeType: 'text/csv', buffer: Buffer.from(uploadBody) });
  await page.waitForFunction(() => cid.state.source === 'file', null, { timeout: 8000 }).catch(() => {});
  await settle(page, 500);
  const uploadToast = await page.textContent('#toast');
  check('backend upload imports and refreshes the dashboard', /Imported 1 file/.test(uploadToast) && (await count(page)) === clientCount + 1, `${await count(page)} records`);
  check('import debrief shows the importer counts', /Import debrief/i.test(await page.textContent('#importBody')) && /On the map/i.test(await page.textContent('#importBody')));
  await page.click('[data-imp="done"]');
  check('View territory closes the dialog', !(await page.locator('#importDialog').isVisible()));
  check('summary endpoint feeds the off-map notice', await page.evaluate(async () => {
    const s = (await (await fetch('api/summary')).json()).summary;
    return !!s && typeof s.records === 'number' && !('duplicates' in s);
  }));

  const realErrors = errors.filter((e) => !tileNoise(e));
  check('no console/page errors on desktop', realErrors.length === 0, realErrors.join(' ;; ').slice(0, 300));

  // ---- L. tablet: record drawer ----
  const tPage = await ctx.newPage();
  const tErrors = [];
  collectErrors(tPage, tErrors);
  await tPage.setViewportSize({ width: 1024, height: 768 });
  await tPage.goto(BASE, { waitUntil: 'networkidle' });
  await tPage.waitForFunction(() => cid.state.source === 'file');
  check('tablet shows the record drawer over the map', await tPage.locator('#record').isVisible());
  await tPage.click('[data-hide="record"]');
  check('tablet drawer Hide closes it', !(await tPage.locator('#record').isVisible()));
  await tPage.locator('#list .row').first().click();
  check('tablet row click reopens the drawer', await tPage.locator('#record').isVisible());
  check('no console/page errors on tablet', tErrors.filter((e) => !tileNoise(e)).length === 0);
  await tPage.close();

  // ---- M. phone viewport ----
  const mErrors = [];
  const mPage = await ctx.newPage();
  collectErrors(mPage, mErrors);
  await mPage.setViewportSize({ width: 390, height: 844 });
  await mPage.goto(BASE, { waitUntil: 'networkidle' });
  await mPage.waitForFunction(() => cid.state.source === 'file');
  check('phone has no sideways scroll', await mPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  check('phone tabs visible', await mPage.locator('#tabs').isVisible());
  await mPage.click('#tabs [data-tab="map"]');
  check('Map tab hides the sheet', !(await mPage.locator('#roster').isVisible()) && !(await mPage.locator('#record').isVisible()));
  await mPage.click('#tabs [data-tab="roster"]');
  check('Roster tab shows the list', await mPage.locator('#roster').isVisible());
  await mPage.locator('#list .row').first().click();
  await mPage.waitForTimeout(700);
  check('phone row click jumps to the Record tab', (await mPage.locator('#record').isVisible()) && (await mPage.getAttribute('#tabs [data-tab="record"]', 'aria-selected')) === 'true');
  await mPage.click('#tabs [data-tab="queue"]');
  check('Queue tab shows follow-ups', await mPage.locator('#queue').isVisible());
  await mPage.click('#tabs [data-tab="map"]');
  await mPage.locator('.leaflet-marker-icon').first().click({ force: true });
  await mPage.waitForTimeout(700);
  check('phone marker click opens the record', await mPage.locator('#record').isVisible());
  await mPage.click('#record [data-hide="record"]');
  check('phone panel Hide returns to the map', !(await mPage.locator('#record').isVisible()) && (await mPage.getAttribute('#app', 'data-tab')) === 'map');
  await mPage.click('#menuBtn');
  check('phone Menu opens', await mPage.locator('#menu').isVisible());
  const [mDownload] = await Promise.all([mPage.waitForEvent('download'), mPage.click('#menu [data-action="export"]')]);
  check('phone Menu > Export CSV downloads', !!mDownload && !(await mPage.locator('#menu').isVisible()));
  const mReal = mErrors.filter((e) => !tileNoise(e));
  check('no console/page errors on phone', mReal.length === 0, mReal.join(' ;; ').slice(0, 300));

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('QA crashed:', e); process.exit(2); });
