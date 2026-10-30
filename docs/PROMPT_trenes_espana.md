# PROMPT — "RailES Live": visión en tiempo real y gestión visual de los trenes de España

## 1. Rol y objetivo

Actúa como un equipo senior (arquitecto de software, ingeniero de datos de transporte con experiencia en GTFS/GTFS-RT y desarrollador frontend de mapas) y construye **RailES Live**: una aplicación web que muestre sobre un mapa, en tiempo (casi) real, la posición de **todos los trenes de pasajeros que circulan en España, de todas las compañías ferroviarias**, y que ofrezca una **consola de gestión visual** (filtros, alertas de retraso, KPIs, detalle de cada tren, timeline y línea temporal de incidencias).

La aplicación debe ser honesta con la calidad del dato: cada tren mostrará **de dónde viene su posición** (GPS real, posición publicada por el operador, o estimación a partir del horario) y **su antigüedad**.

## 2. Alcance: operadores y fuentes de datos

Implementa un sistema de **adaptadores (plugins)** por fuente. Cada adaptador se puede activar o desactivar por configuración, tiene su propio intervalo de sondeo y devuelve un modelo normalizado (ver §4). Fuentes objetivo (a validar en el arranque, ya que las URLs públicas cambian):

| Operador | Ámbito | Fuente principal | Tipo de posición |
|---|---|---|---|
| Renfe Cercanías / Rodalies | Núcleos de cercanías | GTFS-RT Renfe (`https://gtfsrt.renfe.com/vehicle_positions.json`, `trip_updates.json`, `alerts.json`) + GTFS estático de cercanías (data.renfe.com) | `gps` |
| Renfe AVE / Larga y Media Distancia / Avant / Regionales | Red nacional | Visor de tiempo real de Renfe (`https://tiempo-real.largorecorrido.renfe.com/renfe-visor/flotaLD.json`) + GTFS estático de Renfe | `operator` |
| FGC (Ferrocarrils de la Generalitat de Catalunya) | Cataluña | Open data FGC, dataset "posicionament dels trens" (API Opendatasoft) + GTFS/GTFS-RT FGC | `gps` |
| Euskotren | País Vasco | GTFS + GTFS-RT (Open Data Euskadi / NAP) | `gps` o `schedule` |
| Iryo | Alta velocidad | GTFS estático vía Punto de Acceso Nacional (nap.transportes.gob.es) | `schedule` |
| Ouigo España | Alta velocidad | GTFS estático vía NAP | `schedule` |
| FGV (Metrovalencia/TRAM), SFM (Mallorca), Renfe Feve (ancho métrico), Ferrocarril de Sóller, etc. | Regionales | GTFS estático del NAP, y GTFS-RT si existe | `schedule` (o `gps`) |
| Mercancías (Renfe Mercancías, Medway, Captrain…) | — | No hay datos públicos. Queda fuera del alcance de la v1, pero el modelo tiene que permitir añadirlos | — |

**Motor de estimación por horario (obligatorio):** para operadores sin tiempo real, interpola la posición del tren a lo largo del `shape` GTFS (o, si no existe, de la recta o polilínea entre paradas). Usa `stop_times`, `calendar`/`calendar_dates` y la hora actual en `Europe/Madrid`. Si hay `trip_updates`, aplica el retraso conocido. Estas posiciones se marcan como `schedule`, con menor opacidad en el mapa.

**Modo simulación (obligatorio):** un adaptador `simulator` que genere decenas de trenes verosímiles sobre corredores reales (Madrid–Sevilla, Madrid–Barcelona, Madrid–Valencia, Cercanías Madrid/Barcelona, Bilbao, Valencia…), con retrasos aleatorios. Servirá para desarrollo y demos, y como respaldo cuando las fuentes reales no respondan.

Reglas: respeta los términos de uso y las licencias de cada fuente, cita la atribución en la UI, sondea con una cadencia razonable (15–30 s), usa caché y *backoff* exponencial ante errores y **no hagas scraping agresivo**.

## 3. Arquitectura

- **Backend:** Node.js 20+ (TypeScript o JS moderno con ESM) y Fastify.
  - `ingestion/`: un adaptador por fuente con la interfaz `{ id, operator, intervalMs, fetch(): Promise<Train[]> }`.
  - `core/registry`: fusiona los resultados, deduplica (el mismo tren desde dos fuentes: gana la de mayor calidad y la más reciente), calcula rumbo y velocidad a partir de posiciones sucesivas y expira los trenes que llevan más de 5 min sin actualizarse.
  - `core/alerts`: genera eventos (retraso superior a 5, 15 o 30 min; tren detenido fuera de estación más de 5 min; fuente caída; tren nuevo o finalizado).
  - `core/history`: guarda las últimas N posiciones por tren (estela) y una serie temporal de KPIs. En la v1 se guarda en memoria y deja preparada la interfaz para PostgreSQL+PostGIS o TimescaleDB.
  - **API REST:** `GET /api/trains` (con filtros `operator`, `service`, `bbox`, `minDelay`), `GET /api/trains/:id`, `GET /api/sources` (estado de cada fuente), `GET /api/stats`, `GET /api/alerts`, `GET /api/stations`.
  - **Tiempo real hacia el cliente:** Server-Sent Events (`/api/stream`) o WebSocket, enviando *snapshots* y *deltas*.
- **Frontend:** SPA ligera (vanilla JS + Leaflet, o React + MapLibre GL si se quiere WebGL). Sirve las dependencias desde `node_modules`, no desde un CDN.
- **Configuración** mediante `.env` o `config.json`: fuentes activas, intervalos, umbrales de alerta y modo (`live`, `simulation` o `hybrid`).
- **Docker:** `Dockerfile` y `docker-compose.yml`.

## 4. Modelo de datos normalizado

```ts
Train {
  id: string;              // `${source}:${vehicleOrTripId}`
  operator: 'Renfe'|'Iryo'|'Ouigo'|'FGC'|'Euskotren'|'FGV'|'SFM'|string;
  service: 'AVE'|'Alvia'|'Avant'|'Intercity'|'MD'|'Regional'|'Cercanías'|'Rodalies'|'Iryo'|'Ouigo'|'Metro'|'Tram'|string;
  number?: string;         // nº comercial
  line?: string;           // C-1, R2, L6…
  origin?: string; destination?: string;
  prevStop?: string; nextStop?: string; nextStopEta?: string;
  lat: number; lon: number;
  bearing?: number; speedKmh?: number;
  delayMin?: number;       // null si se desconoce
  status: 'running'|'stopped'|'at_station'|'unknown';
  positionType: 'gps'|'operator'|'schedule'|'simulated';
  source: string; updatedAt: string; // ISO
  accessible?: boolean;
}
```

## 5. Funcionalidades de la UI ("gestión visual")

1. **Mapa a pantalla completa** de la península, Baleares y Canarias (inset) con capa base OSM/CARTO y, opcionalmente, la capa de infraestructura de OpenRailwayMap.
2. **Marcadores de tren** coloreados por operador, con forma o borde según el estado de retraso (verde: en hora; ámbar: 5–15 min; rojo: más de 15 min; gris: desconocido). Flecha de rumbo, animación suave entre actualizaciones (interpolación) y *clustering* a zoom bajo.
3. **Panel lateral** con:
   - KPIs: trenes activos, puntualidad (%), retraso medio, nº de alertas y desglose por operador y por servicio.
   - Filtros: operador, tipo de servicio, rango de retraso, tipo de posición y búsqueda por número, línea o estación.
   - Lista de trenes ordenable (por retraso, operador o número); al hacer clic, el mapa centra el tren.
4. **Ficha de tren:** origen → destino, parada anterior/siguiente, ETA, retraso, velocidad, fuente, antigüedad del dato, estela de las últimas posiciones y *timeline* de paradas cuando exista.
5. **Centro de alertas:** feed en vivo con severidad, posibilidad de "reconocer" (ack) y filtro.
6. **Estado de las fuentes:** semáforo por adaptador (ok/degradado/caído), última actualización y nº de trenes aportados.
7. **Modo "sala de control":** tema oscuro, mapa más tablero de puntualidad por corredor y rotación automática entre núcleos (Madrid, Barcelona, Valencia, Bilbao, Sevilla…).
8. **Reproducción histórica (v2):** *slider* temporal para revisar las últimas horas.
9. Responsive, accesible (WCAG AA, teclado) y con UI en español.

## 6. Requisitos no funcionales

- Latencia de extremo a extremo menor de 30 s respecto a la fuente.
- Soportar más de 3 000 trenes simultáneos sin que la UI baje de 30 fps (usar Canvas/WebGL si hace falta).
- Resiliencia: una fuente caída no afecta a las demás.
- Observabilidad: logs estructurados y `/api/health`.
- Tests: tests unitarios de los parsers de cada adaptador (con *fixtures* JSON), de la interpolación sobre el *shape* y de la deduplicación.
- Sin claves privadas en el repositorio.

## 7. Entregables y orden de trabajo

1. Estructura del proyecto, modelo, registro, API y SSE.
2. Adaptador `simulator` y frontend completo funcionando de extremo a extremo.
3. Adaptadores reales (Renfe GTFS-RT Cercanías, Renfe visor LD, FGC, Euskotren) con parsers tolerantes y *fixtures*.
4. Motor GTFS estático e interpolación (Iryo, Ouigo y resto).
5. Alertas, KPIs, estado de fuentes y modo sala de control.
6. README (instalación, configuración, fuentes y licencias, limitaciones), Docker y tests.

**Criterio de aceptación:** `npm install && npm start` levanta la app en `http://localhost:3000`. En modo `simulation` se ven trenes moviéndose de inmediato. En modo `hybrid`, si hay red, aparecen además los trenes reales de las fuentes accesibles, y las caídas se reflejan en el panel de estado de fuentes.
