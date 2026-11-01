// Utilidades compartidas entre el mapa y el cuadro de mandos.

// Colores por operador: paleta categórica validada (daltonismo, contraste) en claro y oscuro.
// El color sigue a la entidad, nunca al orden: un operador siempre tiene el mismo color.
const OPS = {
  Renfe: ['#6250d6', '#9085e9'], Iryo: ['#e34948', '#e66767'], Ouigo: ['#e87ba4', '#d55181'], FGC: ['#eb6834', '#d95926'],
  Euskotren: ['#008300', '#008300'], FGV: ['#1baf7a', '#199e70'], SFM: ['#2a78d6', '#3987e5'], 'Renfe Feve': ['#eda100', '#c98500'],
};
export const OP_ORDER = Object.keys(OPS);
export const isDark = () => document.documentElement.dataset.theme === 'dark' ||
  (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
export const opColor = (op) => (OPS[op] ? OPS[op][isDark() ? 1 : 0] : '#8c8a83');

export const delayClass = (d) => (d == null ? 'unk' : d < 5 ? 'ok' : d < 15 ? 'warn' : d < 30 ? 'bad' : 'crit');
export const delayText = (d) => (d == null ? '¿?' : d <= 0 ? 'En hora' : `+${d}′`);
export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// localStorage puede no estar disponible (modo privado, etc.)
export const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* sin persistencia */ } },
  getJSON(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  setJSON(k, v) { this.set(k, JSON.stringify(v)); },
};

/** Registra el service worker y gestiona el botón "Instalar app". */
export function registerPwa(btn) {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  let deferred;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; if (btn) btn.hidden = false; });
  btn?.addEventListener('click', async () => { if (!deferred) return; deferred.prompt(); await deferred.userChoice; deferred = null; btn.hidden = true; });
}
