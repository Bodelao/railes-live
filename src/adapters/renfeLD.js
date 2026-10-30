import { fetchWithTimeout, num } from './http.js';
import { stationName } from '../data/stationNames.js';

// Códigos de producto del visor (a validar; si no se reconocen se usa la descripción del corredor).
const PRODUCTS = { 2: 'AVE', 3: 'Avant', 4: 'Talgo', 7: 'Alvia', 11: 'Intercity', 13: 'MD', 15: 'Regional', 16: 'Regional Exprés', 28: 'Avlo', 29: 'Euromed' };

/** Renfe AVE/LD/MD — visor de tiempo real (flotaLD.json). */
export function parseRenfeLD(json) {
  const list = json?.trenes ?? json?.trains ?? (Array.isArray(json) ? json : []);
  return list.map((t) => {
    const number = String(t.codComercial ?? t.numTren ?? '').trim();
    const today = new Date().toISOString().slice(0, 10);
    return {
      id: `renfe-ld:${number || t.idTren}`,
      operator: 'Renfe',
      service: t.desProduct ?? PRODUCTS[Number(t.codProduct)] ?? 'Larga Distancia',
      number,
      corridor: t.desCorridor,
      origin: stationName(t.codOrigen), destination: stationName(t.codDestino),
      prevStop: stationName(t.codEstAnt), nextStop: stationName(t.codEstSig),
      nextStopEta: /^\d{1,2}:\d{2}/.test(t.horaLlegadaSigEst ?? '') ? new Date(`${today}T${t.horaLlegadaSigEst.padStart(5, '0')}:00`).toISOString() : undefined,
      lat: num(t.latitud), lon: num(t.longitud),
      delayMin: t.ultRetraso != null && t.ultRetraso !== '' ? Number(t.ultRetraso) : undefined,
      status: 'running',
      positionType: 'operator',
      accessible: t.accesible,
      updatedAt: t.GpsTime ? new Date(Number(t.GpsTime)).toISOString() : undefined,
    };
  });
}

export function createRenfeLD({ url, intervalMs }) {
  return { id: 'renfe-ld', intervalMs, fetch: async () => parseRenfeLD(await fetchWithTimeout(url)) };
}
