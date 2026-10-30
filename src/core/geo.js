const R = 6371; // km
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

export function haversineKm(a, b) {
  const dLat = rad(b[0] - a[0]);
  const dLon = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function bearing(a, b) {
  const y = Math.sin(rad(b[1] - a[1])) * Math.cos(rad(b[0]));
  const x = Math.cos(rad(a[0])) * Math.sin(rad(b[0])) - Math.sin(rad(a[0])) * Math.cos(rad(b[0])) * Math.cos(rad(b[1] - a[1]));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** Precalcula distancias acumuladas de una polilínea [[lat,lon],...]. */
export function measure(line) {
  const cum = [0];
  for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + haversineKm(line[i - 1], line[i]));
  return { line, cum, length: cum[cum.length - 1] };
}

/** Punto y rumbo a una distancia `d` (km) a lo largo de una polilínea medida. */
export function pointAt(m, d) {
  const { line, cum } = m;
  if (d <= 0) return { lat: line[0][0], lon: line[0][1], bearing: bearing(line[0], line[1]) };
  if (d >= m.length) {
    const n = line.length - 1;
    return { lat: line[n][0], lon: line[n][1], bearing: bearing(line[n - 1], line[n]) };
  }
  let i = 1;
  while (cum[i] < d) i++;
  const t = (d - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
  const a = line[i - 1], b = line[i];
  return { lat: a[0] + (b[0] - a[0]) * t, lon: a[1] + (b[1] - a[1]) * t, bearing: bearing(a, b) };
}

/** Distancia (km) de la proyección de un punto sobre la polilínea (aprox. equirectangular). */
export function projectDistance(m, p) {
  let best = { dist: Infinity, along: 0 };
  const k = Math.cos(rad(p[0]));
  for (let i = 1; i < m.line.length; i++) {
    const a = m.line[i - 1], b = m.line[i];
    const ax = a[1] * k, ay = a[0], bx = b[1] * k, by = b[0], px = p[1] * k, py = p[0];
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
    const q = [ay + dy * t, (ax + dx * t) / k];
    const dist = haversineKm(p, q);
    if (dist < best.dist) best = { dist, along: m.cum[i - 1] + haversineKm(a, q) };
  }
  return best;
}
