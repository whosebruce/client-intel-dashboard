// Leaflet wrapper. One discrete marker per record, keyed by record id, so a
// selection change swaps two icons instead of rebuilding every marker.
import { esc, initials, spreadOverlaps, STATUS_LABEL } from './data.js';

const L = window.L;
const HOME = { center: [39.5, -98.35], zoom: 4 };
const FIT_MAX_ZOOM = 13;
const LABEL_ZOOM = 12; // below this, unselected pins shrink to plain squares

export function createMap(el, { onSelect }) {
  const map = L.map(el, { zoomControl: false, attributionControl: false, worldCopyJump: true }).setView(HOME.center, HOME.zoom);
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  L.control.attribution({ position: 'bottomleft', prefix: false }).addTo(map);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    crossOrigin: true,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
  }).addTo(map);

  const markers = new Map(); // id -> { marker, rec, pos, flags }
  let selectedId = null;

  const icon = (rec, flags, selected) => L.divIcon({
    className: 'pin-wrap',
    html: `<div class="pin pin--${rec.status}${selected ? ' is-selected' : ''}${flags.overdue ? ' is-overdue' : ''}" data-id="${esc(rec.id)}"><span>${esc(initials(rec.name))}</span></div>`,
    iconSize: [36, 26],
    iconAnchor: [18, 13],
    popupAnchor: [0, -14],
  });

  const popupHtml = (rec, twins) => `
    <div class="pop">
      <b>${esc(rec.name)}</b>
      <span>${esc(rec.address || rec.city || 'No address')}</span>
      <span class="pop-meta">${esc(STATUS_LABEL[rec.status])} · ${esc(rec.value || 'no value')}</span>
      ${twins > 1 ? `<em>${twins} records share this exact location — markers are fanned slightly so each stays clickable.</em>` : ''}
    </div>`;

  // rows: records to show. flagsFor(rec) -> { overdue }
  function sync(rows, flagsFor) {
    const positions = spreadOverlaps(rows);
    const keep = new Set(rows.map((r) => r.id));
    for (const [id, m] of markers) if (!keep.has(id)) { m.marker.remove(); markers.delete(id); }
    for (const rec of rows) {
      const pos = positions.get(rec.id);
      const flags = flagsFor(rec);
      const existing = markers.get(rec.id);
      const sig = `${rec.status}|${rec.name}|${flags.overdue}|${pos.twins}|${rec.value}|${rec.address}`;
      if (existing) {
        existing.marker.setLatLng([pos.lat, pos.lng]);
        if (existing.sig !== sig) {
          existing.marker.setIcon(icon(rec, flags, rec.id === selectedId));
          existing.marker.setPopupContent(popupHtml(rec, pos.twins));
        }
        Object.assign(existing, { rec, pos, flags, sig });
        continue;
      }
      const marker = L.marker([pos.lat, pos.lng], { icon: icon(rec, flags, rec.id === selectedId), keyboard: true, title: rec.name, riseOnHover: true })
        .bindPopup(popupHtml(rec, pos.twins), { className: 'pop-wrap', closeButton: false, autoPanPadding: [40, 40] })
        .on('click', () => onSelect(rec.id, { source: 'map' }))
        .addTo(map);
      markers.set(rec.id, { marker, rec, pos, flags, sig });
    }
    if (selectedId && markers.has(selectedId)) markers.get(selectedId).marker.setZIndexOffset(1000);
  }

  function select(id, { fly = false } = {}) {
    const prev = markers.get(selectedId);
    if (prev) { prev.marker.setIcon(icon(prev.rec, prev.flags, false)); prev.marker.setZIndexOffset(0); }
    selectedId = id;
    const cur = markers.get(id);
    if (!cur) return;
    cur.marker.setIcon(icon(cur.rec, cur.flags, true));
    cur.marker.setZIndexOffset(1000);
    // Zoom in to at least FIT_MAX_ZOOM, but never pull a closer zoom back out.
    if (fly) map.flyTo([cur.pos.lat, cur.pos.lng], Math.max(map.getZoom(), FIT_MAX_ZOOM), { duration: 0.5 });
  }

  function openPopup(id) { markers.get(id)?.marker.openPopup(); }

  function fit(rows, { animate = true } = {}) {
    if (!rows.length) { map.setView(HOME.center, HOME.zoom, { animate }); return; }
    const bounds = L.latLngBounds(rows.map((r) => [r.lat, r.lng]));
    map.fitBounds(bounds, { padding: [56, 56], maxZoom: FIT_MAX_ZOOM, animate });
  }

  const contains = (rec) => map.getBounds().contains([rec.lat, rec.lng]);

  const zoomClass = () => el.classList.toggle('is-far', map.getZoom() < LABEL_ZOOM);
  map.on('zoomend', zoomClass);
  zoomClass();

  // Leaflet needs a nudge whenever the panel layout changes the container size.
  new ResizeObserver(() => map.invalidateSize({ pan: false })).observe(el);

  return { leaflet: map, markers, sync, select, openPopup, fit, contains, on: (ev, fn) => map.on(ev, fn) };
}
