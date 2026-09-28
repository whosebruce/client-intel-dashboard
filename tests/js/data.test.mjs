// Unit tests for dashboard/js/data.js. No browser, no dependencies:
//   node --test tests/js/
import test from 'node:test';
import assert from 'node:assert/strict';
import * as D from '../../dashboard/js/data.js';
import { demoRecords } from '../../dashboard/js/demo.js';

const TODAY = new Date(2026, 8, 28); // 2026-09-28, local
const rec = (over = {}) => ({ ...D.normalizeRecord({ name: 'Test', lat: 32.7, lng: -117.1 }), ...over });

test('normalizeRecord maps messy CRM headers', () => {
  const r = D.normalizeRecord({ 'Customer Name': 'Jane Q', 'Service Address': '1 Demo St', 'Phone Number': '555-0100', Balance: '$450', 'Next Call': '2026-10-01', Status: 'Due', Latitude: '32.7', Longitude: '-117.1' });
  assert.equal(r.name, 'Jane Q');
  assert.equal(r.address, '1 Demo St');
  assert.equal(r.phone, '555-0100');
  assert.equal(r.value, '$450');
  assert.equal(r.follow_up, '2026-10-01');
  assert.equal(r.status, 'unpaid');
  assert.equal(r.lat, 32.7);
  assert.equal(r.lng, -117.1);
});

test('unknown status falls back to lead', () => {
  assert.equal(D.normalizeStatus('maybe'), 'lead');
  assert.equal(D.normalizeStatus('PAID'), 'paid');
});

test('cleanRows skips blank or out-of-range coordinates and de-duplicates ids', () => {
  const { records, skipped } = D.cleanRows([
    { id: 'a', name: 'One', lat: '32.7', lng: '-117.1' },
    { id: 'a', name: 'Two', lat: '32.8', lng: '-117.2' },
    { name: 'Blank', lat: '', lng: '' },
    { name: 'Bad', lat: '132', lng: '-117' },
  ]);
  assert.equal(records.length, 2);
  assert.equal(skipped, 2);
  assert.notEqual(records[0].id, records[1].id);
  assert.ok(records.every((r) => r.lat !== 0 && r.lng !== 0));
});

test('parseCsv handles quotes, embedded commas, CRLF and a BOM', () => {
  const rows = D.parseCsv('﻿name,notes\r\n"Smith, Jo","said ""hi"""\r\nLee,plain\r\n\r\n');
  assert.deepEqual(rows, [{ name: 'Smith, Jo', notes: 'said "hi"' }, { name: 'Lee', notes: 'plain' }]);
});

test('toCsv round-trips through parseCsv in the import schema', () => {
  const r = rec({ name: 'Quote "Q" Co, LLC', notes: 'line one' });
  const back = D.parseCsv(D.toCsv([r]));
  assert.equal(back.length, 1);
  assert.deepEqual(Object.keys(back[0]), D.FIELDS);
  assert.equal(back[0].name, 'Quote "Q" Co, LLC');
  assert.equal(back[0].lat, '32.7');
});

test('parseMoney reads dollar strings and ignores labels', () => {
  assert.equal(D.parseMoney('$1,200.50'), 1200.5);
  assert.equal(D.parseMoney('450'), 450);
  assert.equal(D.parseMoney('Quote pending'), null);
  assert.equal(D.formatMoney(16400, { compact: true }), '$16.4K');
  assert.equal(D.formatMoney(3500), '$3,500');
});

test('followUpInfo buckets dates relative to today', () => {
  const b = (follow_up) => D.followUpInfo(rec({ follow_up }), TODAY);
  assert.equal(b('2026-09-19').bucket, 'overdue');
  assert.equal(b('2026-09-19').days, -9);
  assert.match(b('2026-09-19').label, /9D OVERDUE/);
  assert.equal(b('2026-09-28').bucket, 'today');
  assert.equal(b('9/30/2026').bucket, 'week');
  assert.equal(b('2026-10-20').bucket, 'later');
  assert.equal(b('next week').bucket, 'undated');
  assert.equal(b('').bucket, 'none');
  assert.equal(b('2026-02-30').bucket, 'undated');
});

test('queueGroups sorts each bucket soonest first', () => {
  const g = D.queueGroups([
    rec({ id: 'b', name: 'B', follow_up: '2026-09-20' }),
    rec({ id: 'a', name: 'A', follow_up: '2026-09-10' }),
    rec({ id: 'c', name: 'C', follow_up: '2026-10-02' }),
    rec({ id: 'd', name: 'D' }),
  ], TODAY);
  assert.deepEqual(g.overdue.map((x) => x.rec.id), ['a', 'b']);
  assert.deepEqual(g.week.map((x) => x.rec.id), ['c']);
  assert.equal(g.today.length + g.later.length + g.undated.length, 0);
});

test('sortRecords by value puts the biggest first and blanks last', () => {
  const rows = [rec({ id: '1', name: 'A', value: '' }), rec({ id: '2', name: 'B', value: '$90' }), rec({ id: '3', name: 'C', value: '$1,000' })];
  assert.deepEqual(D.sortRecords(rows, 'value', TODAY).map((r) => r.id), ['3', '2', '1']);
  assert.deepEqual(D.sortRecords(rows, 'name', TODAY).map((r) => r.id), ['1', '2', '3']);
});

test('matches searches text and phone digits', () => {
  const r = rec({ name: 'Harbor Dental', phone: '(555) 010-0110', city: 'North Park' });
  assert.ok(D.matches(r, { query: 'harbor north' }));
  assert.ok(D.matches(r, { query: '0100110' }));
  assert.ok(!D.matches(r, { query: 'bakery' }));
  assert.ok(!D.matches(r, { status: 'paid' }));
});

test('spreadOverlaps fans same-coordinate records into distinct nearby points', () => {
  const rows = [rec({ id: 'a' }), rec({ id: 'b' }), rec({ id: 'c' }), rec({ id: 'solo', lat: 33, lng: -117 })];
  const pos = D.spreadOverlaps(rows);
  const keys = new Set(['a', 'b', 'c'].map((id) => `${pos.get(id).lat},${pos.get(id).lng}`));
  assert.equal(keys.size, 3);
  assert.equal(pos.get('a').twins, 3);
  assert.deepEqual(pos.get('solo'), { lat: 33, lng: -117, twins: 1 });
  for (const id of ['a', 'b', 'c']) assert.ok(D.distanceMiles(rows[0], pos.get(id)) < 0.02); // within ~30 m
});

test('nearest returns the closest other records in order', () => {
  const base = rec({ id: 'x', lat: 32.7, lng: -117.1 });
  const near = rec({ id: 'near', lat: 32.701, lng: -117.1 });
  const far = rec({ id: 'far', lat: 32.9, lng: -117.1 });
  assert.deepEqual(D.nearest(base, [far, base, near], 5).map((n) => n.rec.id), ['near', 'far']);
});

test('call sheet and directions use the record details', () => {
  const r = rec({ name: 'Jo', phone: '555-0100', address: '1 Demo St', follow_up: '2026-09-30' });
  const sheet = D.callSheet(r, TODAY);
  assert.match(sheet, /^Jo\n555-0100\n1 Demo St\nStatus: Lead/);
  assert.match(sheet, /Follow-up: SEP 30 · IN 2D/);
  assert.equal(D.directionsUrl(r), 'https://www.google.com/maps/dir/?api=1&destination=1%20Demo%20St');
  assert.equal(D.directionsUrl(rec({ address: '' })), 'https://www.google.com/maps/dir/?api=1&destination=32.7%2C-117.1');
  assert.equal(D.telHref('(555) 010-0100'), 'tel:5550100100');
});

test('territoryLabel picks the most common city', () => {
  assert.equal(D.territoryLabel([rec({ city: 'A' }), rec({ city: 'B' }), rec({ city: 'B' })]), 'B');
  assert.equal(D.territoryLabel([rec({ city: '' })]), 'Mapped territory');
});

test('esc neutralizes HTML', () => {
  assert.equal(D.esc('<img src=x onerror="a">'), '&lt;img src=x onerror=&quot;a&quot;&gt;');
});

test('demo data is synthetic, mappable and has a same-spot pair', () => {
  const rows = demoRecords(TODAY);
  const { records, skipped } = D.cleanRows(rows);
  assert.equal(records.length, 36);
  assert.equal(skipped, 0);
  assert.ok(rows.every((r) => /^555-01\d\d$/.test(r.phone)));
  assert.equal(D.spreadOverlaps(records).get(rows[1].id).twins, 2);
  const groups = D.queueGroups(records, TODAY);
  assert.ok(groups.overdue.length && groups.today.length && groups.week.length);
});
