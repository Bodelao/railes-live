/* global L */
const OP_COLORS = {
  Renfe: '#7b2fa8', Iryo: '#d7263d', Ouigo: '#e5007d', FGC: '#f28c28', Euskotren: '#2a9d4b',
  FGV: '#c0392b', SFM: '#1f6fd1', 'Renfe Feve': '#6b8e23',
};
const PTYPE = { gps: 'GPS', operator: 'Operador', schedule: 'Horario', simulated: 'Simulada' };
const NUCLEOS = [
  ['España', [40.0, -3.7], 6], ['Madrid', [40.42, -3.70], 10], ['Barcelona', [41.42, 2.13], 10], ['Valencia', [39.48, -0.40], 11],
  ['Bilbao / Euskadi', [43.24, -2.6], 9], ['Sevilla', [37.38, -5.95], 10], ['Málaga', [36.65, -4.48], 11],
];

const opColor = (op) => OP_COLORS[op] ?? '#4a5568';
const delayClass = (d) => (d == null ? 'unk' : d < 5 ? 'ok' : d < 15 ? 'warn' : d < 30 ? 'bad' : 'crit');
const delayText = (d) => (d == null ? '¿?' : d <= 0 ? 'En hora' : `+${d}′`);
const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const title = (t) => `${t.service ?? ''} ${t.number ?? t.line ?? ''}`.trim();
const hhmm = (iso) => (iso ? new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' }) : '—');
const ago = (iso) => { const s = Math.round((Date.now() - Date.parse(iso)) / 1000); return s < 60 ? `hace ${s} s` : `hace ${Math.round(s / 60)} min`; };
const $ = (id) => document.getElementById(id);

// ---------- Mapa ----------
const map = L.map('map', { preferCanvas: true, zoomControl: true, worldCopyJump: false }).setView([40.0, -3.7], 6);
const tiles = {
  light: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
  dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
};
let base = L.tileLayer(tiles.light, { maxZoom: 19, attribution: '© OpenStreetMap, © CARTO · Datos: Renfe, FGC, Euskotren, NAP (MITMS)' }).addTo(map);
const railLayer = L.tileLayer('https://{s}.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png', { maxZoom: 19, opacity: 0.45, attribution: '© OpenRailwayMap' });
L.control.layers(null, { 'Infraestructura ferroviaria (OpenRailwayMap)': railLayer }, { position: 'topleft' }).addTo(map);
const renderer = L.canvas({ padding: 0.3 });
const trailLayer = L.layerGroup().addTo(map);

// Marcador de tren: círculo con relleno del operador, borde según retraso y flecha de rumbo
const TrainMarker = L.CircleMarker.extend({
  _updatePath() {
    const r = this._renderer, ctx = r._ctx, p = this._point, t = this.train;
    if (!ctx || r._drawing === false) return;
    const rad = this._radius;
    ctx.globalAlpha = t.positionType === 'schedule' ? 0.55 : 1;
    if (t.bearing != null && t.status !== 'at_station') {
      const a = ((t.bearing - 90) * Math.PI) / 180;
      ctx.beginPath();
      ctx.moveTo(p.x + Math.cos(a) * (rad + 6), p.y + Math.sin(a) * (rad + 6));
      ctx.lineTo(p.x + Math.cos(a + 2.4) * (rad + 1), p.y + Math.sin(a + 2.4) * (rad + 1));
      ctx.lineTo(p.x + Math.cos(a - 2.4) * (rad + 1), p.y + Math.sin(a - 2.4) * (rad + 1));
      ctx.closePath();
      ctx.fillStyle = opColor(t.operator);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(p.x, p.y, rad, 0, Math.PI * 2);
    ctx.fillStyle = opColor(t.operator);
    ctx.fill();
    ctx.lineWidth = this.selected ? 4 : 2.5;
    ctx.strokeStyle = this.selected ? cssVar('--text') : cssVar(`--${delayClass(t.delayMin)}`);
    ctx.stroke();
    ctx.globalAlpha = 1;
  },
});

const markers = new Map(); // id → { marker, from, to }
let trains = [];
let selectedId = null;
let lastSnapshotAt = 0;

function syncMarkers(list) {
  const seen = new Set();
  const zoomR = map.getZoom() >= 10 ? 7 : map.getZoom() >= 8 ? 5.5 : 4.5;
  for (const t of list) {
    seen.add(t.id);
    let m = markers.get(t.id);
    if (!m) {
      const marker = new TrainMarker([t.lat, t.lon], { renderer, radius: zoomR, interactive: true });
      marker.train = t;
      marker.on('click', () => select(t.id, false));
      marker.bindTooltip('', { direction: 'top', offset: [0, -6] });
      marker.addTo(map);
      m = { marker, from: [t.lat, t.lon], to: [t.lat, t.lon] };
      markers.set(t.id, m);
    } else {
      m.from = cur(m); m.to = [t.lat, t.lon];
    }
    m.marker.train = t;
    m.marker.setRadius(zoomR);
    m.marker.setTooltipContent(`<b>${esc(t.operator)} ${esc(title(t))}</b><br>${esc(t.origin ?? '')} → ${esc(t.destination ?? '')}<br>${delayText(t.delayMin)}`);
  }
  for (const [id, m] of markers) if (!seen.has(id)) { m.marker.remove(); markers.delete(id); }
}

// Animación suave entre posiciones
let animStart = performance.now();
const ANIM_MS = 2800;
const cur = (m) => { const k = Math.min(1, (performance.now() - animStart) / ANIM_MS); return [m.from[0] + (m.to[0] - m.from[0]) * k, m.from[1] + (m.to[1] - m.from[1]) * k]; };
function frame() {
  if (performance.now() - animStart <= ANIM_MS + 50) for (const m of markers.values()) m.marker.setLatLng(cur(m));
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
map.on('zoomend', () => syncMarkers(visible()));

// ---------- Filtros ----------
const filters = { q: '', operators: new Set(), service: '', minDelay: '', ptypes: new Set(), sort: 'delay' };
let knownOps = new Set(), knownPtypes = new Set(), knownServices = new Set();

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
  b.onclick = () => {
    // Primer clic: aislar ese valor; siguientes: alternar
    if (!set.size) { set.add(value); } else if (set.has(value)) set.delete(value); else set.add(value);
    for (const c of container.children) c.setAttribute('aria-pressed', String(!set.size || set.has(c.dataset.v)));
    render();
  };
  b.dataset.v = value;
  container.appendChild(b);
}

function updateFacets() {
  for (const t of trains) {
    if (!knownOps.has(t.operator)) { knownOps.add(t.operator); chip($('f-operators'), t.operator, t.operator, opColor(t.operator), filters.operators); updateLegend(); }
    if (!knownPtypes.has(t.positionType)) { knownPtypes.add(t.positionType); chip($('f-ptype'), t.positionType, PTYPE[t.positionType] ?? t.positionType, null, filters.ptypes); }
    if (t.service && !knownServices.has(t.service)) {
      knownServices.add(t.service);
      const sel = $('f-service');
      const opts = [...knownServices].sort();
      sel.innerHTML = '<option value="">Todos</option>' + opts.map((s) => `<option${s === filters.service ? ' selected' : ''}>${esc(s)}</option>`).join('');
    }
  }
}

function updateLegend() {
  $('legend').innerHTML = [...knownOps].map((o) => `<span><i style="background:${opColor(o)}"></i>${esc(o)}</span>`).join('') +
    `<span><i style="border:2px solid var(--ok)"></i>En hora</span><span><i style="border:2px solid var(--warn)"></i>5–15′</span>` +
    `<span><i style="border:2px solid var(--bad)"></i>15–30′</span><span><i style="border:2px solid var(--crit)"></i>&gt;30′</span>`;
}

$('f-q').oninput = (e) => { filters.q = e.target.value; render(); };
$('f-service').onchange = (e) => { filters.service = e.target.value; render(); };
$('f-delay').onchange = (e) => { filters.minDelay = e.target.value; render(); };
$('f-sort').onchange = (e) => { filters.sort = e.target.value; renderList(visible()); };

// ---------- Lista y detalle ----------
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
  if (selectedId && markers.get(selectedId)) markers.get(selectedId).marker.selected = false;
  selectedId = id;
  const m = markers.get(id);
  if (m) { m.marker.selected = true; m.marker.redraw(); if (fly) map.flyTo(m.to, Math.max(map.getZoom(), 10), { duration: 0.8 }); }
  await showDetail();
  renderList(visible());
}

async function showDetail() {
  if (!selectedId) return;
  const res = await fetch(`/api/trains/${encodeURIComponent(selectedId)}`);
  if (!res.ok) { closeDetail(); return; }
  const t = await res.json();
  trailLayer.clearLayers();
  if (t.trail?.length > 1) L.polyline(t.trail, { color: opColor(t.operator), weight: 3, opacity: 0.7, dashArray: '4 6' }).addTo(trailLayer);
  const d = $('detail');
  d.hidden = false;
  d.innerHTML = `
    <button class="close" aria-label="Cerrar">×</button>
    <h2 style="color:${opColor(t.operator)}">${esc(t.operator)} ${esc(title(t))}</h2>
    <div class="sub">${esc(t.line ? `Línea ${t.line} · ` : '')}${esc(t.corridor ?? '')} <span class="ptype">${PTYPE[t.positionType] ?? t.positionType}</span></div>
    <div class="route"><span>${esc(t.origin ?? '?')}</span><span class="bar"></span><span>${esc(t.destination ?? '?')}</span></div>
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
}
function closeDetail() {
  if (selectedId && markers.get(selectedId)) { markers.get(selectedId).marker.selected = false; markers.get(selectedId).marker.redraw(); }
  selectedId = null; $('detail').hidden = true; trailLayer.clearLayers(); renderList(visible());
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDetail(); });

// ---------- Alertas, fuentes y resumen ----------
let alerts = [];
function renderAlerts() {
  const showAck = $('f-ack').checked;
  const open = alerts.filter((a) => !a.ack).length;
  $('k-alerts').textContent = open;
  $('alert-badge').textContent = open; $('alert-badge').dataset.n = open;
  $('alerts').innerHTML = alerts.filter((a) => showAck || !a.ack).slice(0, 300).map((a) => `
    <li class="${a.ack ? 'acked' : ''}" data-train="${esc(a.trainId ?? '')}">
      <span class="sev sev-${a.severity}"></span>
      <span>${esc(a.text)}<br><small class="note">${hhmm(a.at)}</small></span>
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
    `<div class="bar-row"><span>${esc(PTYPE[k] ?? k)}</span><div class="b" style="width:${(v / max) * 100}%;background:${color ? color(k) : ''}"></div><span class="v">${v}</span></div>`).join('');
}
function renderStats(list) {
  const punctBy = {};
  for (const t of list) {
    if (t.delayMin == null) continue;
    const p = (punctBy[t.operator] ??= { n: 0, ok: 0 });
    p.n++; if (t.delayMin < 5) p.ok++;
  }
  const buckets = { 'En hora': 0, '5–15′': 0, '15–30′': 0, '>30′': 0, 'Sin dato': 0 };
  for (const t of list) buckets[t.delayMin == null ? 'Sin dato' : t.delayMin < 5 ? 'En hora' : t.delayMin < 15 ? '5–15′' : t.delayMin < 30 ? '15–30′' : '>30′']++;
  const by = (k) => list.reduce((a, t) => ((a[t[k]] = (a[t[k]] || 0) + 1), a), {});
  $('stats').innerHTML = `<div class="stats-grid">
    <h3>Trenes por operador</h3>${bars(by('operator'), opColor)}
    <h3>Puntualidad por operador (&lt;5 min)</h3>${Object.entries(punctBy).map(([o, p]) => `<div class="bar-row"><span>${esc(o)}</span><div class="b" style="width:${(p.ok / p.n) * 100}%;background:${opColor(o)}"></div><span class="v">${Math.round((p.ok / p.n) * 100)}%</span></div>`).join('')}
    <h3>Distribución de retrasos</h3>${bars(buckets, (k) => cssVar({ 'En hora': '--ok', '5–15′': '--warn', '15–30′': '--bad', '>30′': '--crit', 'Sin dato': '--unk' }[k]))}
    <h3>Por servicio</h3>${bars(by('service'))}
    <h3>Calidad de posición</h3>${bars(by('positionType'))}
  </div>`;
}

// ---------- Pestañas y modos ----------
document.querySelectorAll('.tabs button').forEach((b) => b.onclick = () => {
  document.querySelectorAll('.tabs button').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
  document.querySelectorAll('#panel section').forEach((s) => (s.hidden = s.dataset.panel !== b.dataset.tab));
});
$('btn-panel').onclick = (e) => { const c = $('panel').classList.toggle('collapsed'); e.target.setAttribute('aria-expanded', String(!c)); setTimeout(() => map.invalidateSize(), 50); };

let rotateTimer = null;
$('btn-control').onclick = (e) => {
  const on = e.target.getAttribute('aria-pressed') !== 'true';
  e.target.setAttribute('aria-pressed', String(on));
  document.documentElement.dataset.theme = on ? 'dark' : 'light';
  base.setUrl(on ? tiles.dark : tiles.light);
  clearInterval(rotateTimer);
  if (on) {
    let i = 0;
    const next = () => { const [, c, z] = NUCLEOS[i++ % NUCLEOS.length]; map.flyTo(c, z, { duration: 1.5 }); };
    next(); rotateTimer = setInterval(next, 20_000);
  }
  for (const m of markers.values()) m.marker.redraw();
  render();
};
if (matchMedia('(prefers-color-scheme: dark)').matches) { document.documentElement.dataset.theme = 'dark'; base.setUrl(tiles.dark); }

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
  es.onopen = () => $('updated').textContent = 'Conectado';
  es.onerror = () => { $('updated').textContent = 'Reconectando…'; };
}
setInterval(() => {
  const s = Math.round((Date.now() - lastSnapshotAt) / 1000);
  if (lastSnapshotAt) $('updated').textContent = `Actualizado hace ${s} s`;
  document.querySelector('.brand .dot').classList.toggle('off', !lastSnapshotAt || s > 15);
}, 1000);
fetch('/api/health').then((r) => r.json()).then((h) => ($('mode').textContent = `modo ${h.mode}`));
connect();
