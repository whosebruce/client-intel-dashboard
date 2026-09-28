// Render functions. Each takes plain data and writes one region's HTML.
// Clicks are handled by delegation in main.js via data-id / data-action.
import * as D from './data.js';

const $ = (id) => document.getElementById(id);
const { esc } = D;

const statusChip = (s) => `<span class="chip chip--status chip--${s}"><i></i>${D.STATUS_LABEL[s]}</span>`;

function followChip(info) {
  if (info.bucket === 'none') return '';
  if (info.bucket === 'undated') return `<span class="chip chip--mono" title="Follow-up">${esc(info.label)}</span>`;
  const tone = info.bucket === 'overdue' ? ' chip--overdue' : info.bucket === 'today' ? ' chip--today' : '';
  return `<span class="chip chip--mono${tone}" title="Follow-up">FU ${esc(info.label)}</span>`;
}

export function renderTiles(t, active) {
  const tile = (key, label) => {
    const v = t[key];
    const money = v.value ? D.formatMoney(v.value, { compact: true }) : '—';
    return `<button class="stat stat--${key}" data-status="${key}" aria-pressed="${active === key}" title="Show ${label.toLowerCase()} records">
      <span class="stat-label"><i></i>${label}</span><b>${v.n}</b><small>${money}</small></button>`;
  };
  $('tiles').innerHTML = tile('all', 'All') + tile('paid', 'Paid') + tile('unpaid', 'Due') + tile('lead', 'Leads');
  const n = t.all.n;
  $('ratio').innerHTML = n
    ? D.STATUSES.filter((s) => t[s].n).map((s) => `<span class="r-${s}" style="flex:${t[s].n}" title="${D.STATUS_LABEL[s]}: ${t[s].n}"></span>`).join('')
    : '';
}

export function renderNotices(notices) {
  $('notices').innerHTML = notices.map((n) => `
    <div class="notice" data-tone="${n.tone || 'info'}" role="note">
      <b>${esc(n.title)}</b><span>${esc(n.body)}</span>
      ${n.actions?.length ? `<div class="notice-actions">${n.actions.map((a) => `<button class="btn btn--sm" data-action="${a.action}">${esc(a.label)}</button>`).join('')}</div>` : ''}
    </div>`).join('');
}

export function renderList(rows, { selectedId, today, shown, total, hasData }) {
  $('listHead').innerHTML = hasData ? `<span>Showing ${shown} of ${total}</span><span>${shown ? '' : 'No match'}</span>` : '';
  if (!hasData) {
    $('list').innerHTML = `<li class="empty empty--hazard">
      <b>No records loaded</b>
      <p>Import a CRM export, spreadsheet, JSON file or SMS backup. Everything stays on this machine.</p>
      <div class="empty-actions"><button class="btn btn--signal" data-action="import">Import data</button><button class="btn" data-action="demo">Load demo data</button></div>
    </li>`;
    return;
  }
  if (!rows.length) {
    $('list').innerHTML = `<li class="empty"><b>No matching records</b><p>Clear the search, pick another status, or turn off Map area.</p>
      <div class="empty-actions"><button class="btn" data-action="clear-filters">Clear filters</button></div></li>`;
    return;
  }
  $('list').innerHTML = rows.map((r) => {
    const fu = D.followUpInfo(r, today);
    return `<li><button class="row row--${r.status}" data-id="${esc(r.id)}" aria-current="${r.id === selectedId}">
      <span class="row-name">${esc(r.name)}</span>
      <span class="row-value">${esc(r.value || '')}</span>
      <span class="row-addr">${esc(r.address || r.city || 'No address')}</span>
      <span class="row-meta">${statusChip(r.status)}${followChip(fu)}${r.phone ? `<span class="chip chip--mono">${esc(r.phone)}</span>` : ''}</span>
    </button></li>`;
  }).join('');
}

export function renderRecord(rec, { today, twins, nearby, hasData }) {
  const body = $('recordBody');
  if (!rec) {
    body.innerHTML = `<div class="rec-head"><h3>${hasData ? 'Pick a record' : 'Standing by'}</h3>
      <p class="rec-addr">${hasData ? 'Select a marker, a roster row or a queue card to see the full record.' : 'Import data or load the demo to start.'}</p></div>`;
    return;
  }
  const fu = D.followUpInfo(rec, today);
  const lc = D.lastContactInfo(rec, today);
  const phone = rec.phone ? esc(rec.phone) : '';
  const confidence = rec.confidence && rec.confidence !== 'high' ? `<span class="chip chip--mono" title="Location / data confidence">${esc(rec.confidence)}</span>` : '';
  const evidence = (rec.evidence || []).filter(Boolean);
  body.innerHTML = `
    <div class="rec-head">
      <h3 id="recName">${esc(rec.name)}</h3>
      <div class="rec-chips">${statusChip(rec.status)}${followChip(fu)}${confidence}</div>
      <p class="rec-addr">${esc(rec.address || rec.city || 'No address on file')}</p>
      ${twins > 1 ? `<p class="rec-twins">${twins} records share this exact location. Their markers are fanned into a ring.</p>` : ''}
    </div>
    <div class="rec-actions">
      <a class="btn" id="callBtn" href="${phone ? D.telHref(rec.phone) : '#'}" aria-disabled="${!phone}">Call</a>
      <a class="btn" id="textBtn" href="${phone ? D.smsHref(rec.phone) : '#'}" aria-disabled="${!phone}">Text</a>
      <button class="btn" id="directionsBtn" data-action="directions">Route</button>
      <button class="btn" id="copyBtn" data-action="copy">Copy sheet</button>
    </div>
    <div class="facts">
      <div class="fact"><label>Phone</label><div class="mono-val">${phone || '—'}</div></div>
      <div class="fact"><label>Value</label><div class="mono-val">${esc(rec.value || '—')}</div></div>
      <div class="fact"><label>Last contact</label><div>${esc(rec.last_contact || '—')}</div>${lc.days !== null ? `<small>${esc(lc.label.split(' · ')[1])}</small>` : ''}</div>
      <div class="fact"><label>Follow-up</label><div>${esc(rec.follow_up || '—')}</div>${fu.days !== null ? `<small class="${fu.bucket === 'overdue' ? 'is-overdue' : ''}">${esc(fu.label.split(' · ')[1])}</small>` : ''}</div>
      <div class="fact"><label>City</label><div>${esc(rec.city || '—')}</div></div>
      <div class="fact"><label>Coordinates</label><div class="mono-val">${rec.lat.toFixed(5)}, ${rec.lng.toFixed(5)}</div></div>
    </div>
    <div class="rec-block"><h4>Notes</h4><p class="rec-notes">${esc(rec.notes || 'No notes.')}</p></div>
    ${evidence.length ? `<div class="rec-block"><h4>Evidence${rec.source ? ` // ${esc(rec.source)}` : ''}</h4><ul class="evidence">${evidence.slice(0, 6).map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>` : ''}
    ${nearby.length ? `<div class="rec-block"><h4>Nearby // closest ${nearby.length}</h4><ul class="nearby">${nearby.map(({ rec: n, miles }) => `
      <li><button data-id="${esc(n.id)}" title="${esc(n.address || n.city)}"><i class="st-${n.status}"></i><span>${esc(n.name)}</span><small>${miles < 0.1 ? '<0.1' : miles.toFixed(1)} mi</small></button></li>`).join('')}</ul></div>` : ''}
  `;
}

export function renderQueue(groups, { selectedId, hasData }) {
  const total = D.QUEUE_GROUPS.reduce((n, g) => n + groups[g.key].length, 0);
  $('queueMeta').textContent = hasData ? `${groups.overdue.length} overdue · ${total} scheduled` : '';
  $('queueBadge').textContent = groups.overdue.length ? String(groups.overdue.length) : '';
  const cols = D.QUEUE_GROUPS.filter((g) => g.key !== 'undated' || groups.undated.length);
  $('queueCols').innerHTML = cols.map((g) => {
    const items = groups[g.key];
    return `<div class="qcol qcol--${g.key}">
      <h4>${g.label}<span>${items.length}</span></h4>
      <ul>${items.length ? items.map(({ rec, info }) => `<li><button class="qitem qitem--${rec.status}" data-id="${esc(rec.id)}" aria-current="${rec.id === selectedId}">
        <time>${esc(info.label)}</time><b>${esc(rec.name)}</b>
        <span>${D.STATUS_LABEL[rec.status]} · ${esc(rec.city || rec.address || 'no location')}${rec.value ? ` · ${esc(rec.value)}` : ''}</span>
      </button></li>`).join('') : `<li class="qempty">${g.key === 'overdue' ? 'Clear' : 'Nothing here'}</li>`}</ul>
    </div>`;
  }).join('');
}
