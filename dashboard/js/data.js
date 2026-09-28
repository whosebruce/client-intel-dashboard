// Pure data helpers: no DOM, no Leaflet. Everything here runs in Node too,
// so tests/js/data.test.mjs can cover it without a browser.

export const FIELDS = ['name', 'address', 'city', 'lat', 'lng', 'status', 'phone', 'last_contact', 'value', 'follow_up', 'notes'];
export const STATUSES = ['paid', 'unpaid', 'lead'];
export const STATUS_LABEL = { paid: 'Paid', unpaid: 'Due', lead: 'Lead' };

export const esc = (s) => String(s ?? '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
const norm = (s) => String(s ?? '').trim();
const pick = (...vs) => vs.find((v) => norm(v) !== '');
const toNum = (v) => { const s = norm(v); return s === '' ? NaN : Number(s); };

export function normalizeStatus(raw) {
  const s = norm(raw).toLowerCase();
  if (s === 'due' || s === 'owed' || s === 'unpaid') return 'unpaid';
  return STATUSES.includes(s) ? s : 'lead';
}

// Same header aliases as scripts/ingest.py, so a browser preview and a server
// import read a file the same way.
export function normalizeRecord(r, i = 0) {
  const key = (k) => String(k).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const row = Object.fromEntries(Object.entries(r || {}).map(([k, v]) => [key(k), v]));
  const evidence = Array.isArray(row.evidence) ? row.evidence.map(norm).filter(Boolean) : [norm(row.evidence)].filter(Boolean);
  return {
    id: norm(row.id) || `row-${i}`,
    name: norm(pick(row.name, row.client, row.client_name, row.customer, row.customer_name, row.contact)) || 'Unknown client',
    address: norm(pick(row.address, row.street, row.location, row.service_address, row.job_address)),
    city: norm(pick(row.city, row.town, row.county)),
    lat: toNum(pick(row.lat, row.latitude)),
    lng: toNum(pick(row.lng, row.lon, row.longitude)),
    status: normalizeStatus(row.status),
    phone: norm(pick(row.phone, row.phone_number, row.number, row.mobile, row.telephone)),
    last_contact: norm(pick(row.last_contact, row.last_contacted, row.date)),
    value: norm(pick(row.value, row.amount, row.payment, row.invoice, row.balance, row.amount_due, row.invoice_total)),
    follow_up: norm(pick(row.follow_up, row.followup, row.next_contact, row.next_call)),
    notes: norm(pick(row.notes, row.note, row.description, row.summary)),
    confidence: norm(row.confidence),
    evidence,
    source: norm(row.source),
  };
}

const hasCoords = (r) => Number.isFinite(r.lat) && Number.isFinite(r.lng) && Math.abs(r.lat) <= 90 && Math.abs(r.lng) <= 180;

// Every row with a name, phone or address becomes a record. Records without
// usable coordinates get mapped=false: they're listed in the roster as
// off-map but never drawn (no Null Island markers). skipped counts empty rows.
export function cleanRows(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const seen = new Map();
  const records = [];
  list.forEach((raw, i) => {
    const rec = normalizeRecord(raw, i);
    if (rec.name === 'Unknown client' && !rec.phone && !rec.address) return;
    rec.mapped = hasCoords(rec);
    if (!rec.mapped) { rec.lat = NaN; rec.lng = NaN; }
    const n = seen.get(rec.id) || 0;
    seen.set(rec.id, n + 1);
    if (n) rec.id = `${rec.id}~${n + 1}`;
    records.push(rec);
  });
  return { records, skipped: list.length - records.length };
}

export function rowsFromJson(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') return payload.clients || payload.records || payload.rows || [];
  return [];
}

export function parseCsv(text) {
  const src = String(text ?? '').replace(/^﻿/, '');
  const rows = [];
  let row = [], cell = '', quoted = false;
  const endRow = () => { row.push(cell); if (row.some((x) => x.trim())) rows.push(row); row = []; cell = ''; };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i], next = src[i + 1];
    if (quoted) {
      if (ch === '"' && next === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && next === '\n') i++; endRow(); }
    else cell += ch;
  }
  endRow();
  const headers = (rows.shift() || []).map((h) => h.trim());
  return rows.map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim()])));
}

export function toCsv(records) {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [FIELDS.join(',')];
  for (const r of records) lines.push(FIELDS.map((f) => q(Number.isFinite(r[f]) || typeof r[f] === 'string' ? r[f] : '')).join(','));
  return lines.join('\n') + '\n';
}

// "$1,200.50" -> 1200.5, "450" -> 450, "Quote pending" -> null
export function parseMoney(v) {
  const m = String(v ?? '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

export function formatMoney(n, { compact = false } = {}) {
  if (!Number.isFinite(n)) return '—';
  if (compact && Math.abs(n) >= 10000) return `$${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}K`;
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

// Dates: YYYY-MM-DD or M/D/YYYY, read as local calendar days. Anything else is a label.
export function parseDate(s) {
  const t = norm(s);
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return validDate(+m[1], +m[2], +m[3]);
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) return validDate(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[1], +m[2]);
  return null;
}
function validDate(y, mo, d) {
  const dt = new Date(y, mo - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d ? dt : null;
}

export const startOfDay = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const dayDiff = (date, today) => Math.round((startOfDay(date) - startOfDay(today)) / 86400000);

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
export const shortDate = (d) => `${MONTHS[d.getMonth()]} ${d.getDate()}`;

export function followUpInfo(rec, today) {
  const raw = norm(rec.follow_up);
  if (!raw) return { bucket: 'none', days: null, date: null, label: '' };
  const date = parseDate(raw);
  if (!date) return { bucket: 'undated', days: null, date: null, label: raw };
  const days = dayDiff(date, today);
  const bucket = days < 0 ? 'overdue' : days === 0 ? 'today' : days <= 7 ? 'week' : 'later';
  const rel = days < 0 ? `${-days}D OVERDUE` : days === 0 ? 'TODAY' : days === 1 ? 'TOMORROW' : `IN ${days}D`;
  return { bucket, days, date, label: `${shortDate(date)} · ${rel}` };
}

export function lastContactInfo(rec, today) {
  const date = parseDate(rec.last_contact);
  if (!date) return { days: null, label: norm(rec.last_contact) };
  const days = -dayDiff(date, today);
  const rel = days <= 0 ? 'TODAY' : days === 1 ? 'YESTERDAY' : `${days}D AGO`;
  return { days, label: `${shortDate(date)} · ${rel}` };
}

export const QUEUE_GROUPS = [
  { key: 'overdue', label: 'Overdue' },
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'Next 7 days' },
  { key: 'later', label: 'Later' },
  { key: 'undated', label: 'No date' },
];

export function queueGroups(rows, today) {
  const groups = Object.fromEntries(QUEUE_GROUPS.map((g) => [g.key, []]));
  for (const rec of rows) {
    const info = followUpInfo(rec, today);
    if (groups[info.bucket]) groups[info.bucket].push({ rec, info });
  }
  for (const key of Object.keys(groups)) {
    groups[key].sort((a, b) => (a.info.days ?? 0) - (b.info.days ?? 0) || a.rec.name.localeCompare(b.rec.name));
  }
  return groups;
}

export function matches(rec, { status = 'all', query = '', where = 'all' } = {}) {
  if (status !== 'all' && rec.status !== status) return false;
  if (where === 'offmap' && rec.mapped) return false;
  const q = norm(query).toLowerCase();
  if (!q) return true;
  const hay = [rec.name, rec.address, rec.city, rec.phone, rec.notes, rec.value, rec.follow_up].join(' ').toLowerCase();
  const digits = q.replace(/\D/g, '');
  return q.split(/\s+/).every((term) => hay.includes(term)) ||
    (digits.length >= 3 && rec.phone.replace(/\D/g, '').includes(digits));
}

export const SORTS = {
  follow_up: 'Follow-up (soonest)',
  name: 'Name (A–Z)',
  value: 'Value (highest)',
  last_contact: 'Last contact (oldest)',
  city: 'City',
};

export function sortRecords(rows, key, today) {
  const byName = (a, b) => a.name.localeCompare(b.name);
  const nullsLast = (x) => (x === null || x === undefined ? Infinity : x);
  const out = [...rows];
  if (key === 'name') return out.sort(byName);
  if (key === 'city') return out.sort((a, b) => (a.city || '~').localeCompare(b.city || '~') || byName(a, b));
  if (key === 'value') return out.sort((a, b) => nullsLast(-(parseMoney(a.value) ?? -Infinity)) - nullsLast(-(parseMoney(b.value) ?? -Infinity)) || byName(a, b));
  if (key === 'last_contact') return out.sort((a, b) => nullsLast(parseDate(a.last_contact)?.getTime()) - nullsLast(parseDate(b.last_contact)?.getTime()) || byName(a, b));
  return out.sort((a, b) => nullsLast(followUpInfo(a, today).days) - nullsLast(followUpInfo(b, today).days) || byName(a, b));
}

export function totals(rows) {
  const t = { all: { n: 0, value: 0 }, paid: { n: 0, value: 0 }, unpaid: { n: 0, value: 0 }, lead: { n: 0, value: 0 } };
  for (const r of rows) {
    const v = parseMoney(r.value) || 0;
    t.all.n++; t.all.value += v;
    t[r.status].n++; t[r.status].value += v;
  }
  return t;
}

export function territoryLabel(rows) {
  if (!rows.length) return '';
  const counts = new Map();
  for (const r of rows) if (r.city) counts.set(r.city, (counts.get(r.city) || 0) + 1);
  if (!counts.size) return 'Mapped territory';
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
}

export const initials = (name) => (String(name || '?').replace(/[^A-Za-z0-9 ]+/g, ' ').trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?');

// Records that share an exact coordinate get small deterministic ring offsets
// (~15 m) so each one stays its own clickable marker at max zoom. Never clusters,
// never a heatmap: one discrete marker per record.
export function spreadOverlaps(rows) {
  const groups = new Map();
  for (const r of rows) {
    const k = `${r.lat.toFixed(6)},${r.lng.toFixed(6)}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const out = new Map();
  for (const g of groups.values()) {
    if (g.length < 2) { out.set(g[0].id, { lat: g[0].lat, lng: g[0].lng, twins: 1 }); continue; }
    const lngScale = 1 / Math.max(Math.cos((g[0].lat * Math.PI) / 180), 0.2);
    g.forEach((r, i) => {
      const ring = Math.floor(i / 8), slot = i % 8, perRing = Math.min(g.length - ring * 8, 8);
      const ang = (2 * Math.PI * slot) / perRing, rad = 0.00014 * (ring + 1);
      out.set(r.id, { lat: r.lat + rad * Math.sin(ang), lng: r.lng + rad * Math.cos(ang) * lngScale, twins: g.length });
    });
  }
  return out;
}

export function distanceMiles(a, b) {
  const R = 3958.8, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function nearest(rec, rows, n = 5) {
  if (!rec.mapped) return [];
  return rows
    .filter((r) => r.id !== rec.id && r.mapped)
    .map((r) => ({ rec: r, miles: distanceMiles(rec, r) }))
    .sort((a, b) => a.miles - b.miles)
    .slice(0, n);
}

export function callSheet(rec, today) {
  const fu = followUpInfo(rec, today);
  return [
    rec.name,
    rec.phone,
    rec.address || rec.city,
    `Status: ${STATUS_LABEL[rec.status]}`,
    `Value: ${rec.value || ''}`,
    `Last contact: ${rec.last_contact || ''}`,
    `Follow-up: ${fu.label || rec.follow_up || ''}`,
    `Notes: ${rec.notes || ''}`,
  ].filter((line) => line !== undefined && line !== '').join('\n');
}

// null when there's nothing to route to (off-map and no address).
export function directionsUrl(rec) {
  const dest = rec.address || (rec.mapped ? `${rec.lat},${rec.lng}` : '');
  return dest ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}` : null;
}

export const telHref = (phone) => `tel:${String(phone).replace(/[^\d+]/g, '')}`;
export const smsHref = (phone) => `sms:${String(phone).replace(/[^\d+]/g, '')}`;
