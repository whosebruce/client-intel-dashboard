// Synthetic demo territory. Every name, phone and address here is made up; phones
// use the reserved 555-01xx range. Dates are generated relative to `today` so the
// follow-up queue always has overdue, today and upcoming items to show.

const HUBS = [
  ['North Park', 32.7477, -117.1297],
  ['City Heights', 32.7480, -117.0997],
  ['Hillcrest', 32.7488, -117.1631],
  ['Chula Vista', 32.6401, -117.0842],
  ['La Mesa', 32.7678, -117.0231],
  ['El Cajon', 32.7948, -116.9625],
  ['National City', 32.6781, -117.0992],
  ['Clairemont', 32.8121, -117.1968],
  ['Lemon Grove', 32.7426, -117.0314],
  ['Point Loma', 32.7353, -117.2427],
];

const NAMES = [
  'Harbor Dental Group', 'Dana R.', 'Mesa Taqueria', 'Luis & Ana P.', 'Summit Barbers', 'Keiko T.',
  'Rolling Hills HOA', 'Marcus W.', 'Bayfront Yoga', 'Priya S.', 'Canyon Auto Care', 'Omar H.',
  'Sunset Laundromat', 'Grace L.', 'Pacific Print Shop', 'Tom & Jen K.', 'Cedar Street Cafe', 'Rafael M.',
  'Lighthouse Tutoring', 'Nina V.', 'Northside Fitness', 'Andre B.', 'Oak Ridge Vet', 'Sofia G.',
  'Coastline Realty', 'Derek F.', 'Juniper Florals', 'Maya C.', 'Ironworks Garage', 'Elena D.',
  'Blue Door Bakery', 'Victor N.', 'Palm Court Apts', 'Hana Y.', 'Ridgeway Storage', 'Carlos E.',
];

const STREETS = ['Demo St', 'Sample Ave', 'Placeholder Blvd', 'Mockup Way', 'Example Dr', 'Fixture Ln', 'Testbed Rd', 'Specimen Ct'];

const NOTES = {
  paid: ['Paid in full, happy with the work.', 'Paid by Zelle same day.', 'Repeat customer, pays on invoice.', 'Paid cash, asked about a spring tune-up.'],
  unpaid: ['Invoice sent, said they would pay Friday.', 'Balance left after the second visit.', 'Waiting on HOA board approval to pay.', 'Reminder sent, no reply yet.'],
  lead: ['Asked for a quote by text.', 'Referral from a neighbor.', 'Wants an estimate after the holidays.', 'Called about pricing, send the brochure.'],
};

function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const iso = (d) => d.toISOString().slice(0, 10);
const shift = (today, days) => { const d = new Date(today); d.setDate(d.getDate() + days); return d; };

export function demoRecords(today = new Date()) {
  const rand = prng(2026);
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12);
  const records = NAMES.map((name, i) => {
    const [city, lat, lng] = HUBS[i % HUBS.length];
    const status = ['paid', 'unpaid', 'lead', 'paid', 'unpaid', 'lead', 'lead'][i % 7];
    const amount = status === 'lead' ? Math.round(rand() * 30 + 8) * 50 : Math.round(rand() * 24 + 3) * 25;
    const followOffset = [-9, -3, -1, 0, 0, 1, 2, 4, 6, 11, 18, 30][i % 12];
    return {
      id: `demo-${String(i + 1).padStart(2, '0')}`,
      name,
      address: `${100 + Math.floor(rand() * 8800)} ${STREETS[i % STREETS.length]}, ${city}, CA`,
      city,
      lat: +(lat + (rand() - 0.5) * 0.028).toFixed(6),
      lng: +(lng + (rand() - 0.5) * 0.032).toFixed(6),
      status,
      phone: `555-01${String(10 + i).padStart(2, '0')}`,
      last_contact: iso(shift(base, -Math.floor(rand() * 60) - 1)),
      value: status === 'lead' && i % 3 === 0 ? 'Quote pending' : `$${amount.toLocaleString('en-US')}`,
      follow_up: i % 9 === 8 ? '' : iso(shift(base, followOffset)),
      notes: NOTES[status][i % 4],
      confidence: 'demo',
      evidence: ['Synthetic demo record'],
      source: 'demo',
    };
  });
  // Two records with an address but no coordinates yet: they show in the roster as off-map.
  records.push(
    { id: 'demo-37', name: 'Westside Glass', address: '742 Sample Ave, Lemon Grove, CA', city: 'Lemon Grove', status: 'lead', phone: '555-0190', last_contact: iso(shift(base, -12)), value: '$900', follow_up: iso(shift(base, 3)), notes: 'Referral, wants a storefront quote. No coordinates yet.', confidence: 'demo', evidence: ['Synthetic demo record'], source: 'demo' },
    { id: 'demo-38', name: 'Irene Q.', address: '19 Demo St, La Mesa, CA', city: 'La Mesa', status: 'unpaid', phone: '555-0191', last_contact: iso(shift(base, -20)), value: '$180', follow_up: iso(shift(base, -2)), notes: 'Balance after the gate repair. No coordinates yet.', confidence: 'demo', evidence: ['Synthetic demo record'], source: 'demo' },
  );
  // Two records at one exact spot, to show the fanned-marker ring.
  records[1].lat = records[0].lat; records[1].lng = records[0].lng;
  records[1].address = records[0].address;
  records[1].city = records[0].city;
  records[1].notes = 'Shares a building with Harbor Dental Group (suite 2).';
  return records;
}
