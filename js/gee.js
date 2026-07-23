/**
 * Google Earth Engine — клиентский слой запросов NDVI.
 * На хостинге: data/ndvi_latest.json + data/ndvi_mosaics/*.png (scripts/calc_ndvi.py).
 * Локально: server.py → ndvi_compute.py, затем тот же JSON как запасной источник.
 */
const RubinGee = {
  STATIC_NDVI_URL: 'data/ndvi_latest.json',

  /** Базовые URL API (тот же хост или Flask :5000) */
  getApiUrls() {
    if (!isLocalApiHost()) return [];
    return [appUrl('api/ndvi'), 'http://127.0.0.1:5000/api/ndvi'];
  },

  /**
   * Предрасчитанный NDVI (Sentinel-2 / GEE) из data/ndvi_latest.json.
   */
  async fetchNdviFromStatic(options = {}) {
    const data = await fetchJson(this.STATIC_NDVI_URL);
    const period = data.period || {};
    const requestedPeriod = options.period || 'last_month';
    const customMonth = options.customMonth || null;

    if (requestedPeriod === 'custom' && customMonth) {
      const wantStart = `${customMonth}-01`;
      if (period.label !== customMonth && period.start !== wantStart) {
        throw new Error(
          `В файле NDVI только период ${period.label || period.start || '—'}. Запрошен ${customMonth}.`
        );
      }
    } else if (requestedPeriod === 'last_year') {
      throw new Error('Файл ndvi_latest.json содержит только один месяц, не год.');
    }

    const cacheBust = data.generated_at
      ? `?v=${encodeURIComponent(String(data.generated_at).replace(/[^\w.-]/g, ''))}`
      : '';

    const values = (data.fields || [])
      .filter((row) => row.field_id != null && row.ndvi != null)
      .map((row) => {
        const item = {
          id: String(row.field_id),
          ndvi: row.ndvi,
          status: ndviStatusLabel(row.ndvi)
        };
        if (row.mosaic && row.bbox) {
          item.mosaic = String(row.mosaic).replace(/^\//, '') + cacheBust;
          item.bbox = {
            west: Number(row.bbox.west),
            south: Number(row.bbox.south),
            east: Number(row.bbox.east),
            north: Number(row.bbox.north)
          };
        }
        return item;
      });

    if (!values.length) {
      throw new Error('Файл ndvi_latest.json пуст или без значений NDVI');
    }

    const mosaicMeta = data.mosaic || {};
    return {
      period: requestedPeriod,
      custom_month: customMonth,
      start: period.start,
      end: period.end,
      label: period.label || (period.start ? period.start.slice(0, 7) : 'последний месяц'),
      source: 'gee_static',
      generated_at: data.generated_at,
      mosaic: {
        enabled: !!mosaicMeta.enabled && values.some((v) => v.mosaic),
        count: mosaicMeta.count || values.filter((v) => v.mosaic).length,
        opacity: mosaicMeta.opacity_hint != null ? Number(mosaicMeta.opacity_hint) : 0.6,
        palette: mosaicMeta.palette || null,
        vis_min: mosaicMeta.vis_min,
        vis_max: mosaicMeta.vis_max
      },
      values
    };
  },

  /**
   * Запрос среднего NDVI по списку полей за период.
   * @param {object[]} features — GeoJSON Feature[]
   * @param {{ period: string, customMonth?: string }} options
   * @returns {Promise<{ source: string, values: Array, start, end, label }>}
   */
  async fetchNdviBatch(features, options = {}) {
    const payload = {
      features: features.map((f) => ({
        id: f.id,
        geometry: f.geometry
      })),
      period: options.period || 'last_month',
      custom_month: options.customMonth || null
    };

    const urls = this.getApiUrls();
    if (urls.length) {
      let lastError = null;
      for (const url of urls) {
        try {
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
          return data;
        } catch (e) {
          lastError = e;
        }
      }
      console.warn('NDVI API недоступен, пробуем ndvi_latest.json', lastError);
    }

    return this.fetchNdviFromStatic(options);
  },

  /**
   * Локальный демо-расчёт (без GEE), детерминированный по id поля и периоду.
   */
  computeDemoNdvi(features, periodSeed) {
    return features.map((f) => {
      const ndvi = demoNdviValue(f.id, periodSeed);
      return {
        id: f.id,
        ndvi,
        status: ndviStatusLabel(ndvi)
      };
    });
  }
};

/** Псевдо-NDVI 0.1–0.8 (как на сервере) */
function demoNdviValue(featureId, seed) {
  const str = `${featureId}:${seed}`;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  const rnd = Math.abs(Math.sin(hash * 12.9898) * 43758.5453) % 1;
  return +(0.1 + rnd * 0.7).toFixed(3);
}

/** Текстовая оценка состояния растительности */
function ndviStatusLabel(ndvi) {
  if (ndvi == null || Number.isNaN(Number(ndvi))) return 'нет данных';
  const v = Number(ndvi);
  if (v < 0.2) return 'плохое';
  if (v < 0.35) return 'слабое';
  if (v < 0.55) return 'среднее';
  return 'хорошее';
}
