import { readFileSync, existsSync } from 'node:fs';
import { parse } from 'csv-parse/sync';

// Diccionario opcional código → nombre de estación.
// Coloca en data/estaciones.csv el listado de estaciones de Renfe (data.renfe.com), con columnas CÓDIGO;DESCRIPCION;...
const names = new Map();
const file = 'data/estaciones.csv';
if (existsSync(file)) {
  const rows = parse(readFileSync(file), { columns: true, delimiter: ';', bom: true, relax_column_count: true });
  for (const r of rows) {
    const code = r['CÓDIGO'] ?? r.CODIGO ?? r.codigo;
    const name = r.DESCRIPCION ?? r.descripcion ?? r.NOMBRE;
    if (code && name) names.set(String(code).replace(/^0+/, ''), name.trim());
  }
}

export const registerStation = (code, name) => names.set(String(code).replace(/^0+/, ''), name);
export const stationName = (code) => (code == null || code === '' ? undefined : names.get(String(code).replace(/^0+/, '')) ?? String(code));
