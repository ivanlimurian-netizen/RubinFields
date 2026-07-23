/**
 * Утилиты: хранение, уведомления, геометрия, идентификаторы
 */

/** Базовый путь приложения на хостинге, напр. /RubinFields */
function getAppBasePath() {
  if (typeof window.RUBIN_APP_BASE === 'string') {
    return window.RUBIN_APP_BASE.replace(/\/$/, '');
  }
  let path = window.location.pathname || '';
  if (/\/index\.html?$/i.test(path)) {
    path = path.replace(/\/index\.html?$/i, '');
  }
  path = path.replace(/\/$/, '');
  return path === '' || path === '/' ? '' : path;
}

/** URL ресурса с учётом подпапки (https://site.ru/RubinFields/...) */
function appUrl(relativePath) {
  const clean = String(relativePath).replace(/^\//, '');
  const base = getAppBasePath();
  return base ? `${base}/${clean}` : clean;
}

/** Локальный Flask-сервер (не статический хостинг) */
function isLocalApiHost() {
  const h = window.location.hostname;
  return h === 'localhost' || h === '127.0.0.1';
}

const RubinStorage = {
  KEY: 'rubin_gis_fields_v2',
  STYLE_KEY: 'rubin_gis_style_mode',

  load() {
    try {
      const raw = localStorage.getItem(this.KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      console.warn('LocalStorage read error', e);
      return null;
    }
  },

  save(collection) {
    try {
      localStorage.setItem(this.KEY, JSON.stringify(collection));
      return true;
    } catch (e) {
      showToast('Не удалось сохранить данные в LocalStorage', 'error');
      return false;
    }
  },

  getStyleMode() {
    return localStorage.getItem(this.STYLE_KEY) || 'texture';
  },

  setStyleMode(mode) {
    localStorage.setItem(this.STYLE_KEY, mode);
  }
};

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), 4500);
}

function generateId() {
  return `field-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function isGeoJsonGeometry(obj) {
  return obj && typeof obj.type === 'string';
}

/** Приводит Polygon / MultiPolygon к одному внешнему кольцу GeoJSON Polygon */
function normalizeGeometry(geometry) {
  if (!geometry) return { type: 'Polygon', coordinates: [[]] };
  if (geometry.type === 'MultiPolygon') {
    return { type: 'Polygon', coordinates: geometry.coordinates[0] };
  }
  return geometry;
}

function geometryCoordinates(geometry) {
  return normalizeGeometry(geometry).coordinates;
}

/** MapInfo / export_final.bat часто отдают Web Mercator (метры), а не градусы */
const WGS84_SEMI_MAJOR = 6378137;

function isProjectedMetersCoord(x, y) {
  return Math.abs(x) > 180 || Math.abs(y) > 90;
}

function sampleGeometryCoord(geometry) {
  const ring = geometryCoordinates(geometry)[0];
  return ring?.length ? ring[0] : null;
}

function webMercatorToWgs84Pair(x, y) {
  const lon = (x / WGS84_SEMI_MAJOR) * (180 / Math.PI);
  const lat = Math.atan(Math.sinh(y / WGS84_SEMI_MAJOR)) * (180 / Math.PI);
  return [lon, lat];
}

function mapCoordTree(coords, fn) {
  if (typeof coords[0] === 'number') {
    return fn(coords[0], coords[1]);
  }
  return coords.map((part) => mapCoordTree(part, fn));
}

/** Пересчёт EPSG:3857 → WGS84, если координаты в метрах */
function ensureWgs84Geometry(geometry) {
  if (!geometry?.coordinates) return geometry;
  const sample = sampleGeometryCoord(geometry);
  if (!sample || !isProjectedMetersCoord(sample[0], sample[1])) {
    return geometry;
  }
  const coordinates = mapCoordTree(geometry.coordinates, webMercatorToWgs84Pair);
  return { type: geometry.type, coordinates };
}

/** Проверка и исправление GeoJSON после export_final.bat / DeepSeek */
function ensureMapInfoGeoJsonCollection(geojson) {
  if (!geojson?.features?.length) return geojson;
  let fixed = false;
  const features = geojson.features.map((f) => {
    const geometry = ensureWgs84Geometry(f.geometry);
    if (geometry !== f.geometry) fixed = true;
    return { ...f, geometry };
  });
  if (fixed) {
    showToast('Координаты MapInfo пересчитаны из метров в градусы (WGS84)', 'info');
  }
  const sample = sampleGeometryCoord(features[0].geometry);
  if (sample && isProjectedMetersCoord(sample[0], sample[1])) {
    throw new Error(
      'Координаты MapInfo в неизвестной проекции. Запустите: python scripts/export_mapinfo_geojson.py'
    );
  }
  return { ...geojson, features };
}

/** Буквенный рейтинг из fields.geojson (A–E) → число 1–5 для стилей */
/** Текст из MapInfo (Gran_Sostav, Name_soil) → код текстуры */
function guessTextureFromText(text) {
  const v = String(text || '').toLowerCase();
  if (v.includes('пес') || v.includes('sand')) return 'sandy';
  if (v.includes('глин') && !v.includes('сугл')) return 'clay';
  if (v.includes('сугл') || v.includes('clay_loam')) return 'clay_loam';
  if (v.includes('супес')) return 'loamy';
  return 'loamy';
}

function letterRatingToNumber(rating) {
  if (rating == null || rating === '') return 3;
  const n = parseInt(rating, 10);
  if (n >= 1 && n <= 5) return n;
  const map = { A: 5, B: 4, C: 3, D: 2, E: 1 };
  const key = String(rating).trim().toUpperCase();
  return map[key] ?? 3;
}

/**
 * Нормализация объекта из fields.geojson под внутреннюю модель приложения
 */
function normalizeFieldFeature(raw) {
  const props = raw.properties || {};
  const id = String(raw.id ?? props.pk ?? props.id ?? generateId());
  const displayName = (props.name_rus && String(props.name_rus).trim()) || props.name || `Поле ${id}`;

  return {
    type: 'Feature',
    id,
    properties: {
      name: String(displayName),
      texture: props.texture || 'loamy',
      humus: props.humus || 'medium',
      rating: letterRatingToNumber(props.rating),
      sq: props.sq != null ? Number(props.sq) : null,
      sq_acc: props.sq_acc != null ? Number(props.sq_acc) : null,
      farmunit: props.farmunit,
      pk: props.pk,
      descr: props.descr || ''
    },
    geometry: normalizeGeometry(raw.geometry)
  };
}

/**
 * Площадь полигона в гектарах (GeoJSON geometry или coordinates)
 */
function polygonAreaHa(geometryOrCoords) {
  const coordinates = isGeoJsonGeometry(geometryOrCoords)
    ? geometryCoordinates(geometryOrCoords)
    : geometryOrCoords;
  if (typeof turf !== 'undefined') {
    const feature = turf.polygon(coordinates);
    const m2 = turf.area(feature);
    return +(m2 / 10000).toFixed(2);
  }
  return shoelaceAreaHa(coordinates[0]);
}

function shoelaceAreaHa(ring) {
  const R = 6378137;
  let area = 0;
  const n = ring.length - 1;
  for (let i = 0; i < n; i++) {
    const [lon1, lat1] = ring[i];
    const [lon2, lat2] = ring[i + 1];
    const x1 = (lon1 * Math.PI / 180) * R * Math.cos(lat1 * Math.PI / 180);
    const y1 = (lat1 * Math.PI / 180) * R;
    const x2 = (lon2 * Math.PI / 180) * R * Math.cos(lat2 * Math.PI / 180);
    const y2 = (lat2 * Math.PI / 180) * R;
    area += x1 * y2 - x2 * y1;
  }
  return +(Math.abs(area) / 2 / 10000).toFixed(2);
}

function centroidOfPolygon(geometryOrCoords) {
  const coordinates = isGeoJsonGeometry(geometryOrCoords)
    ? geometryCoordinates(geometryOrCoords)
    : geometryOrCoords;
  const ring = coordinates[0];
  if (typeof turf !== 'undefined') {
    const c = turf.centroid(turf.polygon(coordinates));
    return c.geometry.coordinates;
  }
  let sx = 0;
  let sy = 0;
  const n = ring.length - 1;
  for (let i = 0; i < n; i++) {
    sx += ring[i][0];
    sy += ring[i][1];
  }
  return [sx / n, sy / n];
}

const TEXTURE_LABELS = {
  sandy: 'Песчаный',
  loamy: 'Супесчаный',
  clay_loam: 'Суглинок',
  clay: 'Глина'
};

const HUMUS_LABELS = {
  low: 'Низкий (<2%)',
  medium: 'Средний (2–4%)',
  high: 'Высокий (>4%)'
};

function ratingLabel(rating) {
  const n = Number(rating);
  const stars = '★'.repeat(n) + '☆'.repeat(5 - n);
  const classes = ['', 'E', 'D', 'C', 'B', 'A'];
  return `${n} ${stars} (класс ${classes[n] || '—'})`;
}

function geoJsonToYmapsCoords(geometryOrCoords) {
  const coordinates = isGeoJsonGeometry(geometryOrCoords)
    ? geometryCoordinates(geometryOrCoords)
    : geometryOrCoords;
  return coordinates[0].map(([lon, lat]) => [lat, lon]);
}

/** Точки внешнего контура для расчёта границ карты */
function geometryBoundsPoints(geometry) {
  const ring = geometryCoordinates(geometry)[0] || [];
  return ring.map(([lon, lat]) => [lat, lon]);
}

function ymapsCoordsToGeoJson(coords) {
  const ring = coords.map(([lat, lon]) => [lon, lat]);
  if (ring.length && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) {
    ring.push([...ring[0]]);
  }
  return [ring];
}

/**
 * Overlay analysis: атрибутивные слои поверх базовых полей
 * Храним в поле: feature.properties.overlays[layerId] = { ...attrs }
 */
const RubinOverlayRegistry = {
  KEY: 'rubin_gis_overlay_layers_v1',

  load() {
    try {
      return JSON.parse(localStorage.getItem(this.KEY) || '[]');
    } catch (_) {
      return [];
    }
  },

  save(layers) {
    try {
      localStorage.setItem(this.KEY, JSON.stringify(layers));
      return true;
    } catch (_) {
      return false;
    }
  },

  upsert(meta) {
    const layers = this.load();
    const idx = layers.findIndex((l) => l.id === meta.id);
    const next = { ...meta, updatedAt: Date.now() };
    if (idx >= 0) layers[idx] = { ...layers[idx], ...next };
    else layers.unshift(next);
    this.save(layers.slice(0, 50));
  }
};

/**
 * Хранилище исходной геометрии overlay слоёв (для отрисовки зон как на примере).
 * В LocalStorage НЕ сохраняем (может быть тяжёлым); хранится на время сессии.
 */
const RubinOverlayData = {
  _layers: {},
  set(layerId, features) {
    this._layers[layerId] = (features || []).slice(0, 20000);
  },
  get(layerId) {
    return this._layers[layerId] || null;
  }
};

function safeLayerId(prefix, name) {
  const base = String(name || 'layer')
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return `${prefix}_${base || 'layer'}`;
}

function ringBbox(ring) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of ring) {
    const x = p[0];
    const y = p[1];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

function bboxOverlap(a, b) {
  return !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);
}

function toTurfPolygon(geometry) {
  const coords = geometryCoordinates(geometry);
  // turf.polygon expects [ [ [lon,lat], ... ] ]
  return turf.polygon(coords);
}

/**
 * Spatial join (polygon→polygon): для каждого базового поля ищем overlay-объект
 * по максимальной площади пересечения. Возвращает:
 * - matches: Map<fieldId, { overlayIndex, score, attrs }>
 * - stats: { matched, totalFields }
 */
function spatialJoinOverlayToFields(baseFeatures, overlayFeatures, options = {}) {
  const minScoreField = options.minScoreField ?? options.minScore ?? 0.6; // доля от площади поля
  const minScoreOverlay = options.minScoreOverlay ?? 0.6; // доля от площади overlay-объекта
  const pickProps = options.pickProps || null; // (props)=>attrs

  if (typeof turf === 'undefined') {
    throw new Error('Для overlay analysis нужна библиотека turf.js (не загрузилась)');
  }

  const overlayPrepared = overlayFeatures
    .map((f, i) => {
      const g = normalizeGeometry(ensureWgs84Geometry(f.geometry));
      const ring = geometryCoordinates(g)[0];
      if (!ring?.length) return null;
      const poly = toTurfPolygon(g);
      const area = turf.area(poly) || 0;
      return {
        i,
        feature: { ...f, geometry: g },
        bbox: ringBbox(ring),
        poly,
        area,
        props: f.properties || {}
      };
    })
    .filter(Boolean);

  const matches = new Map();
  let matched = 0;

  for (const field of baseFeatures) {
    const fg = normalizeGeometry(field.geometry);
    const fring = geometryCoordinates(fg)[0];
    if (!fring?.length) continue;
    const fbbox = ringBbox(fring);
    const fpoly = toTurfPolygon(fg);
    const fArea = turf.area(fpoly) || 0;
    if (!fArea) continue;

    let best = null;
    for (const cand of overlayPrepared) {
      if (!bboxOverlap(fbbox, cand.bbox)) continue;
      let inter = null;
      try {
        inter = turf.intersect(fpoly, cand.poly);
      } catch (_) {
        inter = null;
      }
      if (!inter) continue;
      const interArea = turf.area(inter) || 0;
      if (!interArea) continue;
      const scoreField = interArea / fArea;
      const scoreOverlay = cand.area ? interArea / cand.area : 0;
      const score = Math.max(scoreField, scoreOverlay);
      if (!best || score > best.score) {
        best = { overlayIndex: cand.i, score, scoreField, scoreOverlay, props: cand.props };
      }
    }

    if (
      best &&
      (best.scoreField >= minScoreField || best.scoreOverlay >= minScoreOverlay)
    ) {
      const attrs = pickProps ? pickProps(best.props, best.overlayIndex) : { ...best.props };
      matches.set(field.id, { overlayIndex: best.overlayIndex, score: best.score, attrs });
      matched += 1;
    }
  }

  return { matches, stats: { matched, totalFields: baseFeatures.length } };
}

/** Встроенные тестовые поля — если fetch недоступен (file://) */
const SAMPLE_FIELDS = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      id: 'field-1',
      properties: { name: 'Поле «Восточное»', texture: 'loamy', humus: 'medium', rating: 4 },
      geometry: {
        type: 'Polygon',
        coordinates: [[[79.472, 53.988], [79.485, 53.988], [79.485, 53.978], [79.472, 53.978], [79.472, 53.988]]]
      }
    },
    {
      type: 'Feature',
      id: 'field-2',
      properties: { name: 'Поле «Западное»', texture: 'sandy', humus: 'low', rating: 2 },
      geometry: {
        type: 'Polygon',
        coordinates: [[[79.458, 53.992], [79.470, 53.992], [79.470, 53.982], [79.458, 53.982], [79.458, 53.992]]]
      }
    },
    {
      type: 'Feature',
      id: 'field-3',
      properties: { name: 'Поле «Южное»', texture: 'clay_loam', humus: 'high', rating: 5 },
      geometry: {
        type: 'Polygon',
        coordinates: [[[79.478, 53.975], [79.492, 53.975], [79.492, 53.965], [79.478, 53.965], [79.478, 53.975]]]
      }
    }
  ]
};

async function fetchJson(url) {
  const target = /^https?:\/\//i.test(url) ? url : appUrl(url);
  const res = await fetch(target);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function loadSampleFields() {
  try {
    return await fetchJson('data/sample_fields.json');
  } catch (e) {
    console.warn('sample_fields.json недоступен, используем встроенные данные', e);
    return SAMPLE_FIELDS;
  }
}

/** Поля из fields.geojson (контуры хозяйства) */
async function loadProductionFields() {
  try {
    const data = await fetchJson('fields.geojson');
    const features = (data.features || [])
      .filter((f) => f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon'))
      .map(normalizeFieldFeature);
    if (!features.length) throw new Error('Нет полигонов в fields.geojson');
    return { type: 'FeatureCollection', features };
  } catch (e) {
    console.warn('fields.geojson недоступен', e);
    return null;
  }
}

/** Сначала fields.geojson, иначе пример */
async function loadInitialFields() {
  const production = await loadProductionFields();
  if (production?.features?.length) return production;
  return loadSampleFields();
}

/** Поле из слоя MapInfo «Поля_Рубин» */
function mapMapinfoFieldFeature(raw, index = 0) {
  const props = raw.properties || {};
  const mapinfoId = props.id ?? raw.id ?? index;
  const number = props.Number ?? props.number ?? props.NAME ?? '';
  const name = String(number || `Поле ${mapinfoId}`);
  const sq = props.Area_ha != null ? Number(props.Area_ha) : null;

  return {
    type: 'Feature',
    id: `mapinfo-field-${mapinfoId}`,
    properties: {
      name,
      texture: guessTextureFromText(props.soil || props.Soil),
      humus: 'medium',
      rating: 3,
      sq,
      source: 'mapinfo',
      mapinfoId,
      number: String(number)
    },
    geometry: normalizeGeometry(ensureWgs84Geometry(raw.geometry))
  };
}

/** Полигон почвенной разности «Почвы_Рубин» */
function mapMapinfoSoilFeature(raw, index = 0) {
  const props = raw.properties || {};
  const mapinfoId = props.id ?? raw.id ?? index;
  const soilName = props.Name_soil ?? props.name_soil ?? 'Почва';
  const gran = props.Gran_Sostav ?? props.gran_sostav ?? '';

  return {
    type: 'Feature',
    id: `mapinfo-soil-${mapinfoId}`,
    properties: {
      name: String(soilName),
      soilType: String(soilName),
      granSostav: String(gran),
      texture: guessTextureFromText(gran || soilName),
      humus: 'medium',
      rating: 3,
      source: 'mapinfo-soil',
      mapinfoId
    },
    geometry: normalizeGeometry(ensureWgs84Geometry(raw.geometry))
  };
}

/** Синхронизация с window.fieldsData (ТЗ) */
function syncWindowFieldsData(collection) {
  window.fieldsData = collection;
}
