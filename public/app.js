/* global L */
import { opColor, OP_ORDER, delayClass, delayText, esc, store, isDark, registerPwa } from './common.js';

const PTYPE = { gps: 'GPS', operator: 'Operador', schedule: 'Horario', simulated: 'Simulada' };
const ZONES = [
  ['España peninsular', [40.2, -3.7], 6], ['Madrid', [40.42, -3.70], 11], ['Barcelona', [41.42, 2.13], 11], ['València', [39.47, -0.40], 11],
  ['Bilbao / Euskadi', [43.24, -2.6], 9], ['Sevilla', [37.38, -5.95], 11], ['Málaga', [36.65, -4.48], 11], ['Zaragoza', [41.65, -0.89], 10],
  ['Asturias / Cantabria', [43.4, -4.8], 9], ['Galicia', [42.6, -8.2], 8], ['Mallorca', [39.62, 2.9], 10],
];
const title = (t) => `${t.service ?? ''} ${t.number ?? t.line ?? ''}`.trim();
const hhmm = (iso) => (iso ? new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' }) : '—');
const ago = (iso) => { const s = Math.round((Date.now() - Date.parse(iso)) / 1000); return s < 60 ? `hace ${s} s` : `hace ${Math.round(s / 60)} min`; };
const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const $ = (id) => document.getElementById(id);
const mobile = () => matchMedia('(max-width: 820px)').matches;

// ---------- Mapa: zoom ----------
const map = L.map('map', {
  preferCanvas: true, zoomControl: false, minZoom: 5, maxZoom: 19,
  zoomSnap: 0.5, zoomDelta: 1, wheelPxPerZoomLevel: 80, // zoom con rueda/trackpad más suave
  tap: true, bounceAtZoomLimits: false,
}).setView([40.2, -3.7], 6);
L.control.zoom({ position: 'bottomright', zoomInTitle: 'Acercar', zoomOutTitle: 'Alejar' }).addTo(map);
L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);

// Botones extra: ver toda España, mi ubicación y pantalla completa
const Tools = L.Control.extend({
  options: { position: 'bottomright' },
  onAdd() {
    const div = L.DomUtil.create('div', 'leaflet-bar map-tools');
    const btn = (label, txt, fn) => { const a = L.DomUtil.create('a', '', div); a.href = '#'; a.title = label; a.setAttribute('aria-label', label); a.innerHTML = txt; L.DomEvent.on(a, 'click', (e) => { L.DomEvent.stop(e); fn(); }); return a; };
    btn('Ver toda España', '⤢', () => map.flyTo([40.2, -3.7], 6, { duration: 0.8 }));
    btn('Mi ubicación: trenes cerca de mí', '◎', () => map.locate({ setView: true, maxZoom: 13 }));
    if (document.fullscreenEnabled) btn('Pantalla completa', '⛶', () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()));
    L.DomEvent.disableClickPropagation(div);
    return div;
  },
});
new Tools().addTo(map);
let meMarker;
map.on('locationfound', (e) => { meMarker?.remove(); meMarker = L.circleMarker(e.latlng, { radius: 7, color: '#fff', weight: 3, fillColor: '#2a78d6', fillOpacity: 1 }).addTo(map).bindTooltip('Estás aquí'); });
map.on('locationerror', () => alert('No se ha podido obtener tu ubicación'));

const gotoSel = $('goto');
gotoSel.innerHTML = '<option value="">Ir a…</option>' + ZONES.map(([n], i) => `<option value="${i}">${n}</option>`).join('');
gotoSel.onchange = () => { const z = ZONES[gotoSel.value]; if (z) map.flyTo(z[1], z[2], { duration: 1 }); gotoSel.value = ''; };

// ---------- Mapa: capas base (estándar, satélite, híbrido…) ----------
const OSM = '© OpenStreetMap';
const esri = (svc, o = {}) => L.tileLayer(`https://server.arcgisonline.com/ArcGIS/rest/services/${svc}/MapServer/tile/{z}/{y}/{x}`, { maxZoom: 19, maxNativeZoom: 18, ...o });
// OpenStreetMap no requiere clave; el modo oscuro se obtiene invirtiendo sus teselas por CSS.
const osm = (o = {}) => L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: OSM, ...o });
const BASES = {
  'Mapa (OpenStreetMap)': osm(),
  'Mapa oscuro': osm({ className: 'dark-tiles' }),
  'Satélite': esri('World_Imagery', { attribution: 'Imágenes © Esri, Maxar, Earthstar Geographics' }),
  'Híbrido (satélite + calles)': L.layerGroup([
    esri('World_Imagery', { attribution: 'Imágenes © Esri, Maxar' }),
    esri('Reference/World_Transportation'),
    esri('Reference/World_Boundaries_and_Places'),
  ]),
  'Ortofoto PNOA (IGN España)': L.tileLayer('https://www.ign.es/wmts/pnoa-ma?request=GetTile&service=WMTS&VERSION=1.0.0&Layer=OI.OrthoimageCoverage&Style=default&Format=image/jpeg&TileMatrixSet=GoogleMapsCompatible&TileMatrix={z}&TileRow={y}&TileCol={x}', { maxZoom: 19, attribution: 'PNOA cedido por © Instituto Geográfico Nacional' }),
  'Topográfico': L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 17, attribution: `${OSM}, SRTM, © OpenTopoMap` }),
  // CARTO puede pedir clave de API según el uso; se deja como opción
  'Mapa claro (CARTO)': L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { maxZoom: 19, attribution: `${OSM}, © CARTO` }),
  'Mapa oscuro (CARTO)': L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 19, attribution: `${OSM}, © CARTO` }),
};
const orm = (style) => L.tileLayer(`https://{s}.tiles.openrailwaymap.org/${style}/{z}/{x}/{y}.png`, { maxZoom: 19, opacity: 0.6, attribution: '© OpenRailwayMap' });
const stationsLayer = L.layerGroup();
const OVERLAYS = {
  'Vías férreas (OpenRailwayMap)': orm('standard'),
  'Velocidad máxima de vía': orm('maxspeed'),
  'Electrificación': orm('electrification'),
  'Estaciones principales': stationsLayer,
};
const DEFAULT_BASE = isDark() ? 'Mapa oscuro' : 'Mapa (OpenStreetMap)';
let baseName = store.get('railes.base') ?? DEFAULT_BASE;
if (!BASES[baseName]) baseName = DEFAULT_BASE;
BASES[baseName].addTo(map);
for (const name of store.getJSON('railes.overlays', [])) OVERLAYS[name]?.addTo(map);
L.control.layers(BASES, OVERLAYS, { position: 'topright', collapsed: true }).addTo(map);
map.on('baselayerchange', (e) => { baseName = e.name; store.set('railes.base', e.name); document.body.classList.toggle('imagery', /Satélite|Híbrido|PNOA/.test(e.name)); });
document.body.classList.toggle('imagery', /Satélite|Híbrido|PNOA/.test(baseName));
const saveOverlays = () => store.setJSON('railes.overlays', Object.entries(OVERLAYS).filter(([, l]) => map.hasLayer(l)).map(([n]) => n));
map.on('overlayadd overlayremove', saveOverlays);
const setBase = (name) => { if (name === baseName) return; map.removeLayer(BASES[baseName]); BASES[name].addTo(map); map.fire('baselayerchange', { name, layer: BASES[name] }); };

fetch('/api/stations').then((r) => r.json()).then((st) => {
  for (const s of st) L.circleMarker([s.lat, s.lon], { radius: 3, color: '#52514e', weight: 1, fillColor: '#fff', fillOpacity: 1 }).bindTooltip(s.name).addTo(stationsLayer);
});

const renderer = L.canvas({ padding: 0.3 });
const trailLayer = L.layerGroup().addTo(map);
const radiusFor = (z) => (z < 7 ? 4.5 : z < 9 ? 5.5 : z < 11 ? 7 : z < 13 ? 8.5 : 10);

// Marcador de tren: círculo del operador, anillo de estado de retraso, flecha de rumbo y etiqueta a zoom alto
const TrainMarker = L.CircleMarker.extend({
  _updatePath() {
    const r = this._renderer, ctx = r._ctx, p = this._point, t = this.train;
    if (!ctx) return;
    const rad = this._radius;
    const fill = opColor(t.operator);
    ctx.globalAlpha = t.positionType === 'schedule' ? 0.6 : 1;
    if (t.bearing != null && t.status !== 'at_station') {
      const a = ((t.bearing - 90) * Math.PI) / 180;
      ctx.beginPath();
      ctx.moveTo(p.x + Math.cos(a) * (rad + 7), p.y + Math.sin(a) * (rad + 7));
      ctx.lineTo(p.x + Math.cos(a + 2.4) * (rad + 1), p.y + Math.sin(a + 2.4) * (rad + 1));
      ctx.lineTo(p.x + Math.cos(a - 2.4) * (rad + 1), p.y + Math.sin(a - 2.4) * (rad + 1));
      ctx.closePath();
      ctx.fillStyle = fill; ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(p.x, p.y, rad, 0, Math.PI * 2);
    ctx.fillStyle = fill; ctx.fill();
    ctx.lineWidth = this.selected ? 4 : 2.5;
    ctx.strokeStyle = this.selected ? cssVar('--text') : cssVar(`--${delayClass(t.delayMin)}`);
    ctx.stroke();
    if (this._map && this._map.getZoom() >= 11) {
      const label = `${t.number ?? t.line ?? ''}${t.delayMin >= 5 ? ` +${t.delayMin}′` : ''}`;
      ctx.font = '600 11px system-ui, sans-serif';
      ctx.lineWidth = 3; ctx.strokeStyle = cssVar('--panel'); ctx.fillStyle = cssVar('--text');
      ctx.strokeText(label, p.x + rad + 4, p.y + 4); ctx.fillText(label, p.x + rad + 4, p.y + 4);
    }
    ctx.globalAlpha = 1;
  },
});

const markers = new Map();
let trains = [];
let selectedId = null;
let followSelected = false;
let lastSnapshotAt = 0;

function syncMarkers(list) {
  const seen = new Set();
  const rad = radiusFor(map.getZoom());
  for (const t of list) {
    seen.add(t.id);
    let m = markers.get(t.id);
    if (!m) {
      const marker = new TrainMarker([t.lat, t.lon], { renderer, radius: rad, interactive: true });
      marker.on('click', () => select(t.id, false));
      marker.on('dblclick', (e) => { L.DomEvent.stop(e); select(t.id, true); });
      marker.bindTooltip('', { direction: 'top', offset: [0, -8] });
      marker.train = t;
      marker.addTo(map);
      m = { marker, from: [t.lat, t.lon], to: [t.lat, t.lon] };
      markers.set(t.id, m);
    } else { m.from = cur(m); m.to = [t.lat, t.lon]; }
    m.marker.train = t;
    m.marker.selected = t.id === selectedId;
    m.marker.setRadius(rad);
    m.marker.setTooltipContent(`<b>${esc(t.operator)} ${esc(title(t))}</b><br>${esc(t.origin ?? '')} → ${esc(t.destination ?? '')}<br>${delayText(t.delayMin)}`);
  }
  for (const [id, m] of markers) if (!seen.has(id)) { m.marker.remove(); markers.delete(id); }
  if (followSelected && markers.get(selectedId)) map.panTo(markers.get(selectedId).to, { animate: true, duration: 2 });
}

let animStart = performance.now();
const ANIM_MS = 2800;
const cur = (m) => { const k = Math.min(1, (performance.now() - animStart) / ANIM_MS); return [m.from[0] + (m.to[0] - m.from[0]) * k, m.from[1] + (m.to[1] - m.from[1]) * k]; };
(function frame() {
  if (performance.now() - animStart <= ANIM_MS + 50) for (const m of markers.values()) m.marker.setLatLng(cur(m));
  requestAnimationFrame(frame);
})();
map.on('zoomend', () => syncMarkers(visible()));
map.on('dragstart', () => { if (followSelected) { followSelected = false; const b = document.querySelector('#detail .follow'); if (b) b.setAttribute('aria-pressed', 'false'); } });

// ---------- Filtros ----------
const filters = { q: '', operators: new Set(), service: '', minDelay: '', ptypes: new Set(), sort: 'delay' };
const knownOps = new Set(), knownPtypes = new Set(), knownServices = new Set();

function visible() {
  const q = filters.q.toLowerCase();
  return trains.filter((t) =>
    (!filters.operators.size || filters.operators.has(t.operator)) &&
    (!filters.ptypes.size || filters.ptypes.has(t.positionType)) &&
    (!filters.service || t.service === filters.service) &&
    (!filters.minDelay || (t.delayMin ?? -1) >= +filters.minDelay) &&
    (!q || [t.number, t.line, t.origin, t.destination, t.nextStop, t.prevStop, t.service].some((v) => v && String(v).toLowerCase().includes(q))));
}

function chip(container, value, label, color, set) {
  const b = document.createElement('button');
  b.className = 'chip';
  b.setAttribute('aria-pressed', 'true');
  b.innerHTML = `${color ? `<i style="background:${color}"></i>` : ''}${esc(label)}`;
  b.dataset.v = value;
  b.onclick = () => {
    if (!set.size) set.add(value); else if (set.has(value)) set.delete(value); else set.add(value);
    for (const c of container.children) c.setAttribute('aria-pressed', String(!set.size || set.has(c.dataset.v)));
    render();
  };
  // Mantener el orden fijo de operadores
  const order = (v) => { const i = OP_ORDER.indexOf(v); return i < 0 ? 99 : i; };
  const before = [...container.children].find((c) => order(c.dataset.v) > order(value));
  container.insertBefore(b, before ?? null);
}

function updateFacets() {
  for (const t of trains) {
    if (!knownOps.has(t.operator)) { knownOps.add(t.operator); chip($('f-operators'), t.operator, t.operator, opColor(t.operator), filters.operators); updateLegend(); }
    if (!knownPtypes.has(t.positionType)) { knownPtypes.add(t.positionType); chip($('f-ptype'), t.positionType, PTYPE[t.positionType] ?? t.positionType, null, filters.ptypes); }
    if (t.service && !knownServices.has(t.service)) {
      knownServices.add(t.service);
      $('f-service').innerHTML = '<option value="">Todos</option>' + [...knownServices].sort().map((s) => `<option${s === filters.service ? ' selected' : ''}>${esc(s)}</option>`).join('');
    }
  }
}

function updateLegend() {
  const ops = [...knownOps].sort((a, b) => OP_ORDER.indexOf(a) - OP_ORDER.indexOf(b));
  $('legend').innerHTML = ops.map((o) => `<span><i style="background:${opColor(o)}"></i>${esc(o)}</span>`).join('') +
    `<span><i class="ring" style="border-color:var(--ok)"></i>En hora</span><span><i class="ring" style="border-color:var(--warn)"></i>5–15′</span>` +
    `<span><i class="ring" style="border-color:var(--bad)"></i>15–30′</span><span><i class="ring" style="border-color:var(--crit)"></i>&gt;30′</span>`;
}
$('legend-toggle').onclick = (e) => { const open = document.body.classList.toggle('legend-open'); e.target.setAttribute('aria-expanded', String(open)); };

$('f-q').oninput = (e) => { filters.q = e.target.value; render(); };
$('f-service').onchange = (e) => { filters.service = e.target.value; render(); };
$('f-delay').onchange = (e) => { filters.minDelay = e.target.value; render(); };
$('f-sort').onchange = (e) => { filters.sort = e.target.value; renderList(visible()); };

// ---------- Lista y ficha ----------
function renderList(list) {
  const sorted = [...list].sort((a, b) =>
    filters.sort === 'delay' ? (b.delayMin ?? -1) - (a.delayMin ?? -1)
      : filters.sort === 'operator' ? a.operator.localeCompare(b.operator) || title(a).localeCompare(title(b))
        : String(a.number ?? a.line ?? '').localeCompare(String(b.number ?? b.line ?? ''), 'es', { numeric: true }));
  $('count').textContent = `${list.length} trenes`;
  $('list').innerHTML = sorted.slice(0, 400).map((t) => `
    <li data-id="${esc(t.id)}" class="${t.id === selectedId ? 'sel' : ''}" tabindex="0">
      <span class="op" style="background:${opColor(t.operator)}"></span>
      <span class="t">${esc(t.operator)} · ${esc(title(t))}</span>
      <span class="delay d-${delayClass(t.delayMin)}">${delayText(t.delayMin)}</span>
      <span class="s">${esc(t.origin ?? '?')} → ${esc(t.destination ?? '?')}${t.nextStop ? ` · próx. ${esc(t.nextStop)}` : ''}</span>
    </li>`).join('');
}
$('list').onclick = (e) => { const li = e.target.closest('li'); if (li) select(li.dataset.id, true); };
$('list').onkeydown = (e) => { if (e.key === 'Enter') { const li = e.target.closest('li'); if (li) select(li.dataset.id, true); } };

async function select(id, fly) {
  if (selectedId && markers.get(selectedId)) { markers.get(selectedId).marker.selected = false; markers.get(selectedId).marker.redraw(); }
  selectedId = id;
  const m = markers.get(id);
  if (mobile()) showTab('map');
  if (m) {
    m.marker.selected = true; m.marker.redraw();
    if (fly) map.flyTo(m.to, Math.max(map.getZoom(), 13), { duration: 0.8 });
  }
  await showDetail();
  renderList(visible());
}

async function showDetail() {
  if (!selectedId) return;
  const res = await fetch(`/api/trains/${encodeURIComponent(selectedId)}`);
  if (!res.ok) { closeDetail(); return; }
  const t = await res.json();
  trailLayer.clearLayers();
  if (t.trail?.length > 1) L.polyline(t.trail, { color: opColor(t.operator), weight: 3, opacity: 0.8, dashArray: '4 6' }).addTo(trailLayer);
  const d = $('detail');
  d.hidden = false;
  d.innerHTML = `
    <div class="grab" aria-hidden="true"></div>
    <button class="close" aria-label="Cerrar">×</button>
    <h2><i class="opdot" style="background:${opColor(t.operator)}"></i>${esc(t.operator)} ${esc(title(t))}</h2>
    <div class="sub">${esc(t.line ? `Línea ${t.line} · ` : '')}${esc(t.corridor ?? '')} <span class="ptype">${PTYPE[t.positionType] ?? t.positionType}</span></div>
    <div class="route"><span>${esc(t.origin ?? '?')}</span><span class="bar"></span><span>${esc(t.destination ?? '?')}</span></div>
    <div class="detail-actions">
      <button class="zoomto">Acercar al tren</button>
      <button class="follow" aria-pressed="${followSelected}">Seguir tren</button>
    </div>
    <dl>
      <dt>Retraso</dt><dd><span class="delay d-${delayClass(t.delayMin)}">${delayText(t.delayMin)}</span></dd>
      <dt>Estado</dt><dd>${{ running: 'En marcha', stopped: 'Detenido', at_station: 'En estación', unknown: 'Desconocido' }[t.status] ?? t.status}</dd>
      <dt>Anterior</dt><dd>${esc(t.prevStop ?? '—')}</dd>
      <dt>Siguiente</dt><dd>${esc(t.nextStop ?? '—')} ${t.nextStopEta ? `(${hhmm(t.nextStopEta)})` : ''}</dd>
      <dt>Velocidad</dt><dd>${t.speedKmh != null ? `${t.speedKmh} km/h` : '—'}</dd>
      <dt>Rumbo</dt><dd>${t.bearing != null ? `${Math.round(t.bearing)}°` : '—'}</dd>
      <dt>Posición</dt><dd>${t.lat.toFixed(4)}, ${t.lon.toFixed(4)}</dd>
      <dt>Fuente</dt><dd>${esc(t.source)} · ${ago(t.updatedAt)}</dd>
      ${t.accessible != null ? `<dt>Accesible</dt><dd>${t.accessible ? 'Sí' : 'No'}</dd>` : ''}
    </dl>`;
  d.querySelector('.close').onclick = closeDetail;
  d.querySelector('.zoomto').onclick = () => map.flyTo([t.lat, t.lon], 15, { duration: 0.8 });
  d.querySelector('.follow').onclick = (e) => { followSelected = !followSelected; e.target.setAttribute('aria-pressed', String(followSelected)); if (followSelected) map.flyTo([t.lat, t.lon], Math.max(map.getZoom(), 13)); };
}
function closeDetail() {
  if (selectedId && markers.get(selectedId)) { markers.get(selectedId).marker.selected = false; markers.get(selectedId).marker.redraw(); }
  selectedId = null; followSelected = false; $('detail').hidden = true; trailLayer.clearLayers(); renderList(visible());
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDetail(); });

// ---------- Alertas, fuentes y resumen ----------
let alerts = [];
function renderAlerts() {
  const showAck = $('f-ack').checked;
  const open = alerts.filter((a) => !a.ack).length;
  $('k-alerts').textContent = open;
  for (const id of ['alert-badge', 'alert-badge-m']) { $(id).textContent = open; $(id).dataset.n = open; }
  $('alerts').innerHTML = alerts.filter((a) => showAck || !a.ack).slice(0, 300).map((a) => `
    <li class="${a.ack ? 'acked' : ''}" data-train="${esc(a.trainId ?? '')}">
      <span class="sev sev-${a.severity}" title="${a.severity}"></span>
      <span>${esc(a.text)}<br><small class="note">${hhmm(a.at)} · ${{ critical: 'Crítica', high: 'Alta', medium: 'Media', info: 'Info' }[a.severity] ?? a.severity}</small></span>
      ${a.ack ? '<small>✓</small>' : `<button data-ack="${a.id}">Reconocer</button>`}
    </li>`).join('') || '<li><span></span><span class="note">Sin alertas</span></li>';
}
$('alerts').onclick = async (e) => {
  const id = e.target.dataset.ack;
  if (id) { await fetch(`/api/alerts/${id}/ack`, { method: 'POST' }); const a = alerts.find((x) => x.id === +id); if (a) a.ack = true; renderAlerts(); return; }
  const li = e.target.closest('li');
  if (li?.dataset.train && markers.has(li.dataset.train)) select(li.dataset.train, true);
};
$('f-ack').onchange = renderAlerts;

function renderSources(sources) {
  $('sources').innerHTML = sources.map((s) => `
    <li><span class="sev state-${s.state}"></span>
      <span><b>${esc(s.id)}</b> — ${s.trains} trenes<br><small class="note">${s.lastOk ? `OK ${ago(s.lastOk)}` : 'Sin datos aún'}${s.latencyMs != null ? ` · ${s.latencyMs} ms` : ''}${s.lastError && s.state !== 'ok' ? `<br>⚠ ${esc(s.lastError)}` : ''}</small></span>
      <small>${{ ok: 'OK', degraded: 'Degradada', down: 'Caída', starting: 'Iniciando' }[s.state]}</small></li>`).join('');
}

function bars(obj, color) {
  const max = Math.max(1, ...Object.values(obj));
  return Object.entries(obj).sort((a, b) => b[1] - a[1]).map(([k, v]) =>
    `<div class="bar-row"><span>${esc(PTYPE[k] ?? k)}</span><div class="b" style="width:${(v / max) * 100}%;${color ? `background:${color(k)}` : ''}"></div><span class="v">${v}</span></div>`).join('');
}
function renderStats(list) {
  const punctBy = {};
  for (const t of list) {
    if (t.delayMin == null) continue;
    const p = (punctBy[t.operator] ??= { n: 0, ok: 0 });
    p.n++; if (t.delayMin < 5) p.ok++;
  }
  const by = (k) => list.reduce((a, t) => ((a[t[k]] = (a[t[k]] || 0) + 1), a), {});
  $('stats').innerHTML = `<div class="stats-grid">
    <h3>Trenes por operador</h3>${bars(by('operator'), opColor)}
    <h3>Puntualidad ahora (&lt;5 min)</h3>${Object.entries(punctBy).map(([o, p]) => `<div class="bar-row"><span>${esc(o)}</span><div class="b" style="width:${(p.ok / p.n) * 100}%;background:${opColor(o)}"></div><span class="v">${Math.round((p.ok / p.n) * 100)}%</span></div>`).join('')}
    <h3>Por servicio</h3>${bars(by('service'))}
    <h3>Calidad de posición</h3>${bars(by('positionType'))}
  </div>`;
}

// ---------- Pestañas (escritorio) y navegación inferior (móvil) ----------
function showTab(name) {
  document.body.dataset.view = name;
  for (const b of document.querySelectorAll('.bottomnav [data-nav]')) b.toggleAttribute('aria-current', b.dataset.nav === name);
  if (name === 'map') { setTimeout(() => map.invalidateSize(), 50); return; }
  for (const x of document.querySelectorAll('.tabs button')) x.setAttribute('aria-selected', String(x.dataset.tab === name));
  for (const s of document.querySelectorAll('#panel section')) s.hidden = s.dataset.panel !== name;
}
document.querySelectorAll('.tabs button').forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));
document.querySelectorAll('.bottomnav [data-nav]').forEach((b) => (b.onclick = () => showTab(b.dataset.nav)));
showTab(mobile() ? 'map' : 'trains');
$('btn-panel').onclick = (e) => { const c = $('panel').classList.toggle('collapsed'); e.target.setAttribute('aria-expanded', String(!c)); setTimeout(() => map.invalidateSize(), 50); };

let rotateTimer = null, baseBeforeControl = null;
$('btn-control').onclick = (e) => {
  const on = e.target.getAttribute('aria-pressed') !== 'true';
  e.target.setAttribute('aria-pressed', String(on));
  document.documentElement.dataset.theme = on ? 'dark' : (isDark() ? 'dark' : 'light');
  if (on && baseName === 'Mapa (OpenStreetMap)') { baseBeforeControl = baseName; setBase('Mapa oscuro'); } else if (!on && baseBeforeControl) { setBase(baseBeforeControl); baseBeforeControl = null; }
  clearInterval(rotateTimer);
  if (on) {
    let i = 0;
    const next = () => { const [, c, z] = ZONES[i++ % ZONES.length]; map.flyTo(c, z, { duration: 1.5 }); };
    next(); rotateTimer = setInterval(next, 20_000);
  }
  for (const m of markers.values()) m.marker.redraw();
  render();
};

// ---------- Render general y stream ----------
function render() {
  const list = visible();
  syncMarkers(list);
  renderList(list);
  renderStats(list);
}

function onSnapshot(s) {
  trains = s.trains;
  lastSnapshotAt = Date.now();
  animStart = performance.now();
  updateFacets();
  render();
  $('k-active').textContent = s.stats.active;
  $('k-punct').textContent = s.stats.punctuality != null ? `${s.stats.punctuality}%` : '–';
  $('k-delay').textContent = s.stats.avgDelay != null ? `${s.stats.avgDelay} min` : '–';
  renderSources(s.sources);
  if (selectedId) showDetail();
}

function connect() {
  const es = new EventSource('/api/stream');
  es.addEventListener('snapshot', (e) => onSnapshot(JSON.parse(e.data)));
  es.addEventListener('alerts', (e) => { alerts = JSON.parse(e.data); renderAlerts(); });
  es.addEventListener('alert', (e) => { alerts.unshift(JSON.parse(e.data)); renderAlerts(); });
  es.onopen = () => ($('updated').textContent = 'Conectado');
  es.onerror = () => { $('updated').textContent = 'Reconectando…'; };
}
setInterval(() => {
  const s = Math.round((Date.now() - lastSnapshotAt) / 1000);
  if (lastSnapshotAt) $('updated').textContent = `Actualizado hace ${s} s`;
  document.querySelector('.brand .dot').classList.toggle('off', !lastSnapshotAt || s > 15);
}, 1000);
fetch('/api/health').then((r) => r.json()).then((h) => ($('mode').textContent = `modo ${h.mode}`));
registerPwa($('btn-install'));
connect();
