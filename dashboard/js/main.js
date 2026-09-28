// Client Intel dashboard controller: state, layout, events.
import * as D from './data.js';
import { createMap } from './map.js';
import * as V from './views.js';
import { createImporter } from './importer.js';
import { demoRecords } from './demo.js';

const $ = (id) => document.getElementById(id);
const app = $('app');
const store = {
  get: (k) => { try { return localStorage.getItem(`cid.${k}`); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(`cid.${k}`, v); } catch { /* storage blocked */ } },
};
const isPhone = () => matchMedia('(max-width: 819px)').matches;

const state = {
  clients: [],
  source: 'none', // file | preview | demo | none
  serverOnline: false,
  summary: null,
  selectedId: null,
  filter: { status: 'all', query: '' },
  sort: D.SORTS[store.get('sort')] ? store.get('sort') : 'follow_up',
  inView: false,
  hidden: { roster: false, record: false, queue: false },
  focus: false,
  tab: 'roster',
};
let view = { today: D.startOfDay(), matched: [], roster: [] };

const map = createMap($('map'), { onSelect: (id) => select(id, { source: 'map' }) });

let toastTimer;
function toast(msg, tone = 'info') {
  const el = $('toast');
  el.textContent = msg;
  el.dataset.tone = tone;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 4800);
}

const importer = createImporter({
  isServerOnline: () => state.serverOnline,
  onServerImported: async (out) => { state.summary = out.summary || null; await loadServerData(); },
  onPreview: (records) => setData(records, 'preview'),
  onDemo: loadDemo,
  onDone: () => { if (isPhone()) setTab('map'); fit(); },
  toast,
});

// ── Derived data + rendering ─────────────────────────────────
const byId = (id) => state.clients.find((r) => r.id === id) || null;

function compute() {
  const today = D.startOfDay();
  const matched = state.clients.filter((r) => D.matches(r, state.filter));
  const listed = state.inView ? matched.filter(map.contains) : matched;
  view = { today, matched, roster: D.sortRecords(listed, state.sort, today) };
}

function render({ markers = true } = {}) {
  compute();
  const { today, matched, roster } = view;
  const hasData = state.clients.length > 0;
  V.renderTiles(D.totals(state.clients), state.filter.status);
  V.renderNotices(notices());
  V.renderList(roster, { selectedId: state.selectedId, today, shown: roster.length, total: state.clients.length, hasData });
  V.renderQueue(D.queueGroups(matched, today), { selectedId: state.selectedId, hasData });
  if (markers) map.sync(matched, (rec) => ({ overdue: D.followUpInfo(rec, today).bucket === 'overdue' }));
  renderRecord();
  renderChrome();
}

function renderRecord() {
  const rec = byId(state.selectedId);
  V.renderRecord(rec, {
    today: view.today,
    twins: rec ? map.markers.get(rec.id)?.pos.twins || 1 : 1,
    nearby: rec ? D.nearest(rec, state.clients, 5) : [],
    hasData: state.clients.length > 0,
  });
  app.classList.toggle('has-selection', !!rec);
  const i = view.roster.findIndex((r) => r.id === state.selectedId);
  $('prevBtn').disabled = i <= 0;
  $('nextBtn').disabled = !view.roster.length || i === view.roster.length - 1;
}

function renderChrome() {
  const n = view.matched.length;
  const label = D.territoryLabel(view.matched);
  $('territory').textContent = state.clients.length ? `Territory // ${label} · ${n} on map` : 'Territory // standing by';
  $('mapCount').textContent = `${n} on map`;
  $('exportBtn').disabled = !state.clients.length;
  $('inViewBtn').setAttribute('aria-pressed', state.inView);

  const s = $('dataStatus');
  const [tone, text] = {
    file: state.serverOnline ? ['ok', `clients.json · ${state.clients.length} records · server online`] : ['idle', `clients.json · ${state.clients.length} records · read only`],
    preview: ['warn', `Browser preview · ${state.clients.length} records · not saved`],
    demo: ['warn', `Demo data · ${state.clients.length} synthetic records`],
    none: state.serverOnline ? ['ok', 'Server online · no data yet'] : ['bad', 'Server offline · preview only'],
  }[state.source];
  s.dataset.tone = tone;
  s.querySelector('.status-text').textContent = text;
  const when = state.summary?.generated_at ? ` · last import ${new Date(state.summary.generated_at).toLocaleString()}` : '';
  s.title = text + when;
}

function notices() {
  const out = [];
  if (state.source === 'demo') {
    out.push({ tone: 'warn', title: 'Demo data // synthetic', body: 'Nothing here is real and nothing is saved. Import your own files to replace it.', actions: [{ label: 'Import data', action: 'import' }, { label: 'Clear demo', action: 'clear-demo' }] });
  } else if (state.source === 'preview') {
    out.push({ tone: 'warn', title: 'Browser preview // not saved', body: 'Start python3 server.py to keep imports and read XLSX or SMS backups.', actions: [{ label: 'Import again', action: 'import' }] });
  } else if (state.source === 'file' && state.summary?.records_without_coordinates_dropped > 0) {
    const n = state.summary.records_without_coordinates_dropped;
    out.push({ tone: 'bad', title: `${n} record${n === 1 ? '' : 's'} off-map`, body: 'No coordinates. Add lat/lng columns, or set GOOGLE_MAPS_API_KEY and re-import to geocode street addresses.' });
  }
  return out;
}

// ── Selection ────────────────────────────────────────────────
function select(id, { source = 'list' } = {}) {
  if (!byId(id)) return;
  state.selectedId = id;
  if (!isPhone() && state.hidden.record) { state.hidden.record = false; applyLayout(); }
  render({ markers: false });
  map.select(id, { fly: true });
  document.querySelector(`#list [data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' });
  if (isPhone()) setTab('record');
  else if (source !== 'list') $('record').querySelector('.record-body').scrollTop = 0;
}

function step(delta) {
  if (!view.roster.length) return;
  const i = view.roster.findIndex((r) => r.id === state.selectedId);
  const next = view.roster[Math.min(Math.max(i + delta, 0), view.roster.length - 1)] || view.roster[0];
  select(next.id, { source: 'keys' });
}

// ── Data sources ─────────────────────────────────────────────
function setData(records, source) {
  state.clients = records;
  state.source = records.length || source === 'file' ? source : 'none';
  state.filter = { status: 'all', query: '' };
  state.inView = false;
  $('search').value = '';
  state.selectedId = D.sortRecords(records, state.sort, D.startOfDay())[0]?.id || null;
  render();
  map.select(state.selectedId);
  requestAnimationFrame(() => fit({ animate: false }));
}

async function loadServerData() {
  try {
    const res = await fetch('clients.json', { cache: 'no-store' });
    if (res.ok) {
      const { records } = D.cleanRows(D.rowsFromJson(await res.json()));
      setData(records, 'file');
      return true;
    }
  } catch { /* no clients.json yet */ }
  return false;
}

async function checkServer() {
  try {
    const res = await fetch('api/health', { cache: 'no-store' });
    state.serverOnline = res.ok && (await res.json()).ok === true;
  } catch { state.serverOnline = false; }
  if (!state.serverOnline) return;
  try {
    const res = await fetch('api/summary', { cache: 'no-store' });
    if (res.ok) state.summary = (await res.json()).summary || null;
  } catch { /* older server without /api/summary */ }
}

function loadDemo() {
  state.summary = state.source === 'file' ? state.summary : null;
  setData(demoRecords(new Date()), 'demo');
  toast('Demo data loaded. Every record is synthetic and nothing is saved.');
}

async function clearDemo() {
  if (!(await loadServerData())) setData([], 'none');
}

// ── Actions ──────────────────────────────────────────────────
function fit({ animate = true } = {}) { map.fit(view.matched, { animate }); }

async function copyCallSheet() {
  const rec = byId(state.selectedId);
  if (!rec) return toast('Pick a record first.');
  const text = D.callSheet(rec, view.today);
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = Object.assign(document.createElement('textarea'), { value: text });
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
  }
  toast('Call sheet copied.');
}

function directions() {
  const rec = byId(state.selectedId);
  if (!rec) return toast('Pick a record first.');
  window.open(D.directionsUrl(rec), '_blank', 'noopener');
}

function exportCsv() {
  if (!state.clients.length) return toast('Nothing to export yet.');
  const blob = new Blob([D.toCsv(state.clients)], { type: 'text/csv' });
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: `client-intel-export-${new Date().toISOString().slice(0, 10)}.csv`,
  });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast(`Exported ${state.clients.length} records.`);
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  store.set('theme', theme);
  const next = theme === 'night' ? 'Day' : 'Night';
  $('themeBtn').textContent = next;
  $('menuTheme').textContent = `${next} mode`;
}
const toggleTheme = () => setTheme(document.documentElement.dataset.theme === 'night' ? 'day' : 'night');

const ACTIONS = {
  import: () => importer.open(),
  demo: loadDemo,
  'clear-demo': clearDemo,
  'clear-filters': () => { state.filter = { status: 'all', query: '' }; state.inView = false; $('search').value = ''; render(); },
  copy: copyCallSheet,
  directions,
  export: exportCsv,
  fit: () => fit(),
  theme: toggleTheme,
};

// ── Layout ───────────────────────────────────────────────────
function applyLayout() {
  for (const p of ['roster', 'record', 'queue']) {
    app.classList.toggle(`hide-${p}`, state.hidden[p]);
    document.querySelector(`.seg [data-panel="${p}"]`).setAttribute('aria-pressed', !state.hidden[p] && !state.focus);
  }
  app.classList.toggle('focus', state.focus);
  app.classList.toggle('queue-open', !state.hidden.queue && !state.focus);
  $('focusBtn').setAttribute('aria-pressed', state.focus);
}

function togglePanel(p) {
  if (state.focus) { state.focus = false; state.hidden = { roster: true, record: true, queue: true }; }
  state.hidden[p] = !state.hidden[p];
  applyLayout();
}

function toggleFocus() {
  state.focus = !state.focus;
  if (!state.focus) state.hidden = { roster: false, record: false, queue: false };
  applyLayout();
  if (state.focus) setTimeout(() => fit(), 60);
}

function setTab(tab) {
  state.tab = tab;
  app.dataset.tab = tab;
  document.querySelectorAll('#tabs [data-tab]').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === tab));
}

function hidePanel(p) {
  if (isPhone()) setTab('map');
  else { state.hidden[p] = true; applyLayout(); }
}

// ── Menu (phone) ─────────────────────────────────────────────
function toggleMenu(open = $('menu').hidden) {
  const menu = $('menu');
  menu.hidden = !open;
  $('menuBtn').setAttribute('aria-expanded', open);
  if (open) {
    const r = $('menuBtn').getBoundingClientRect();
    menu.style.top = `${r.bottom + 6}px`;
    menu.style.right = `${Math.max(8, innerWidth - r.right)}px`;
    menu.querySelector('button')?.focus();
  }
}

// ── Events ───────────────────────────────────────────────────
function wire() {
  let searchTimer;
  $('search').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.filter.query = e.target.value; render(); }, 60);
  });
  $('sort').innerHTML = Object.entries(D.SORTS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  $('sort').value = state.sort;
  $('sort').addEventListener('change', (e) => { state.sort = e.target.value; store.set('sort', state.sort); render({ markers: false }); });
  $('inViewBtn').addEventListener('click', () => { state.inView = !state.inView; render({ markers: false }); });
  $('tiles').addEventListener('click', (e) => {
    const b = e.target.closest('[data-status]');
    if (!b) return;
    const s = b.dataset.status;
    state.filter.status = state.filter.status === s && s !== 'all' ? 'all' : s;
    render();
  });

  for (const id of ['list', 'queueCols', 'recordBody']) {
    $(id).addEventListener('click', (e) => {
      const row = e.target.closest('[data-id]');
      if (row) select(row.dataset.id, { source: id === 'list' ? 'list' : id });
    });
  }
  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-action]');
    if (a && ACTIONS[a.dataset.action]) { ACTIONS[a.dataset.action](); if (a.closest('#menu')) toggleMenu(false); }
    if (!$('menu').hidden && !e.target.closest('#menu, #menuBtn')) toggleMenu(false);
  });

  $('importBtn').addEventListener('click', () => importer.open());
  $('exportBtn').addEventListener('click', exportCsv);
  $('fitBtn').addEventListener('click', () => fit());
  $('focusBtn').addEventListener('click', toggleFocus);
  $('themeBtn').addEventListener('click', toggleTheme);
  $('helpBtn').addEventListener('click', () => $('helpDialog').showModal());
  $('helpDialog').addEventListener('click', (e) => { if (e.target === $('helpDialog') || e.target.closest('[data-close]')) $('helpDialog').close(); });
  $('menuBtn').addEventListener('click', () => toggleMenu());
  $('prevBtn').addEventListener('click', () => step(-1));
  $('nextBtn').addEventListener('click', () => step(1));
  document.querySelectorAll('.seg [data-panel]').forEach((b) => b.addEventListener('click', () => togglePanel(b.dataset.panel)));
  document.querySelectorAll('[data-hide]').forEach((b) => b.addEventListener('click', () => hidePanel(b.dataset.hide)));
  document.querySelectorAll('#tabs [data-tab]').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
  map.on('moveend', () => { if (state.inView) render({ markers: false }); });

  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const typing = e.target.matches?.('input, select, textarea, [contenteditable]');
    if (e.key === 'Escape') {
      if (!$('menu').hidden) return toggleMenu(false);
      if (e.target === $('search')) {
        if ($('search').value) { $('search').value = ''; state.filter.query = ''; render(); } else $('search').blur();
      }
      return;
    }
    if (typing || document.querySelector('dialog[open]')) return;
    const keys = {
      '/': () => { if (isPhone()) setTab('roster'); $('search').focus(); },
      j: () => step(1), k: () => step(-1),
      f: () => fit(), m: () => { if (!isPhone()) toggleFocus(); },
      c: copyCallSheet, d: directions,
      i: () => importer.open(), t: toggleTheme,
      '?': () => $('helpDialog').showModal(),
    };
    const fn = keys[e.key.toLowerCase()] || keys[e.key];
    if (fn) { e.preventDefault(); fn(); }
  });

  // Drop files anywhere on the page to import.
  let depth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  window.addEventListener('dragenter', (e) => { if (!hasFiles(e) || importer.isOpen()) return; depth++; $('dropOverlay').hidden = false; });
  window.addEventListener('dragleave', () => { if (depth && --depth === 0) $('dropOverlay').hidden = true; });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    $('dropOverlay').hidden = true;
    importer.handleFiles([...e.dataTransfer.files]);
  });
}

// ── Boot ─────────────────────────────────────────────────────
async function boot() {
  setTheme(document.documentElement.dataset.theme === 'day' ? 'day' : 'night');
  wire();
  applyLayout();
  render();
  await checkServer();
  if (!(await loadServerData())) render();
}

// QA/debug hook for tests/browser/qa.js. Read-only use; not an API.
window.cid = { state, get view() { return view; }, map: map.leaflet, markers: map.markers, select };

boot();
