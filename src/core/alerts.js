let seq = 0;

/** Genera alertas a partir de los eventos del registro. */
export class Alerts {
  constructor(registry, { delayThresholds, stoppedMinutes }, max = 500) {
    this.items = [];
    this.max = max;
    this.listeners = new Set();
    registry.on('update', (t, prev) => {
      // Solo alertamos al cruzar un umbral, no por el retraso con el que un tren aparece por primera vez
      const before = prev?.delayMin ?? 0;
      for (const th of prev ? delayThresholds : []) {
        if (t.delayMin >= th && before < th) {
          this.push({
            severity: th >= 30 ? 'critical' : th >= 15 ? 'high' : 'medium',
            type: 'delay', trainId: t.id,
            text: `${label(t)} acumula ${t.delayMin} min de retraso`,
          });
        }
      }
      const stoppedMin = t.stoppedSince ? (Date.now() - t.stoppedSince) / 60_000 : 0;
      if (t.status !== 'at_station' && stoppedMin >= stoppedMinutes && !t._stoppedAlerted) {
        t._stoppedAlerted = true;
        this.push({ severity: 'high', type: 'stopped', trainId: t.id, text: `${label(t)} detenido fuera de estación (${Math.round(stoppedMin)} min)` });
      } else if (prev?._stoppedAlerted && t.stoppedSince) t._stoppedAlerted = true;
    });
  }

  push(a) {
    const alert = { id: ++seq, at: new Date().toISOString(), ack: false, ...a };
    this.items.unshift(alert);
    this.items.length = Math.min(this.items.length, this.max);
    for (const l of this.listeners) l(alert);
    return alert;
  }

  ack(id) {
    const a = this.items.find((x) => x.id === Number(id));
    if (a) a.ack = true;
    return a;
  }

  onAlert(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
}

const label = (t) => `${t.operator} ${t.service ?? ''} ${t.number ?? t.line ?? ''}`.replace(/\s+/g, ' ').trim();
