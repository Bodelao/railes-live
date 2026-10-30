export async function fetchWithTimeout(url, { timeoutMs = 15_000, as = 'json' } = {}) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { 'user-agent': 'RailES-Live/0.1 (+open data viewer)' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`);
  if (as === 'json') return res.json();
  return Buffer.from(await res.arrayBuffer());
}

export const num = (v) => (v === '' || v == null ? undefined : Number(String(v).replace(',', '.')));
