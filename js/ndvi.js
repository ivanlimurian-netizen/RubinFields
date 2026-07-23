/**
 * NDVI: среднее по полю + внутрипольная мозаика (PNG GroundOverlay).
 * Источник: data/ndvi_latest.json + data/ndvi_mosaics/*.png (хостинг),
 * Flask+GEE (локально) или демо-режим.
 */
const RubinNdvi = {
  CACHE_KEY: 'rubin_gis_ndvi_cache',
  period: 'last_month',
  customMonth: null,
  lastMeta: null,
  loading: false,
  enabled: false,
  mosaicOpacity: 0.7,
  mosaicOverlays: [],
  hasMosaics: false,

  init() {
    this._loadUiState();
    this._bindControls();
    this._bindMosaicLayer();
    this._tryLoadStaticLatest();
    return this;
  },

  /** При открытии сайта подтягиваем готовый NDVI с хостинга. */
  _tryLoadStaticLatest() {
    if (this._shouldSkipStaticAutoload()) return;

    RubinGee.fetchNdviFromStatic({ period: 'last_month' })
      .then((payload) => this._applyPayload(payload, { silent: true, repaintLayer: true }))
      .catch((err) => console.info('NDVI static autoload:', err.message));
  },

  _shouldSkipStaticAutoload() {
    if (!RubinFields.features?.length) return true;
    const hasMosaicFiles = RubinFields.features.some((f) => f.properties?.ndviMosaic?.url);
    // Перезагрузить JSON, если мозаик ещё нет (старый кэш только со средним NDVI)
    if (this._isRealNdviSource(this.lastMeta?.source) && this.hasMosaics && hasMosaicFiles) {
      return true;
    }
    return false;
  },

  _isRealNdviSource(source) {
    return source === 'gee' || source === 'gee_static';
  },

  _bindControls() {
    const periodSel = document.getElementById('ndvi-period');
    const monthInp = document.getElementById('ndvi-custom-month');
    const btnRefresh = document.getElementById('btn-refresh-ndvi');

    periodSel?.addEventListener('change', () => {
      this.period = periodSel.value;
      const isCustom = this.period === 'custom';
      if (monthInp) {
        monthInp.hidden = !isCustom;
        if (isCustom && !monthInp.value) {
          const d = new Date();
          d.setMonth(d.getMonth() - 1);
          monthInp.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        }
      }
    });

    monthInp?.addEventListener('change', () => {
      this.customMonth = monthInp.value || null;
    });

    btnRefresh?.addEventListener('click', () => this.refreshAndApply());
  },

  _bindMosaicLayer() {
    document.addEventListener('rubin:layerVisibility', (e) => {
      const { id, visible } = e.detail || {};
      if (id !== 'ndvi_mosaic') return;
      if (visible) {
        this.ensureMosaicVisible().catch((err) => {
          console.warn(err);
          showToast(err.message || 'Не удалось показать мозаику NDVI', 'error');
        });
      } else {
        this._updateBaseForMosaic(false);
        this._hideNdviLegend();
      }
    });
  },

  /**
   * Включить мозаику: при необходимости подгрузить JSON, отрисовать полигоны с PNG.
   */
  async ensureMosaicVisible() {
    const hasData = RubinFields.features.some((f) => f.properties?.ndviMosaic?.url);
    if (!hasData) {
      showToast('Загрузка NDVI-мозаик…', 'info');
      const payload = await RubinGee.fetchNdviFromStatic({ period: 'last_month' });
      this._applyPayload(payload, { silent: true, repaintLayer: true });
    } else if (!this.mosaicOverlays.length && !this._mosaicDrawn) {
      this.renderMosaicLayer();
    }

    if (!this.hasMosaics) {
      throw new Error(
        'Нет файлов мозаики. На ПК: python scripts\\calc_ndvi.py, затем загрузите data/ndvi_mosaics/ на хостинг.'
      );
    }

    this.renderMosaicLayer();
    RubinLayers._syncCollectionOnMap('ndvi_mosaic');
    this._updateBaseForMosaic(true);
    this._showNdviLegend();
    if (!this._mosaicDrawn) {
      throw new Error('Мозаика не отрисовалась — проверьте data/ndvi_mosaics/*.png');
    }
  },

  _mosaicImageUrl(path) {
    if (!path) return '';
    if (/^https?:\/\//i.test(path) || path.startsWith('data:')) return path;
    const rel = appUrl(path);
    try {
      return new URL(rel, window.location.href).href;
    } catch (_) {
      return rel;
    }
  },

  /** При активной мозаике — только контур полей, без заливки поверх PNG */
  _updateBaseForMosaic(mosaicOn) {
    if (typeof RubinFields === 'undefined') return;
    Object.entries(RubinFields.polygons || {}).forEach(([id, polygon]) => {
      const selected = id === RubinFields.selectedId;
      const feature = RubinFields.features.find((f) => String(f.id) === String(id));
      const opts = RubinLayers.getBaseFieldOptions(feature, selected);
      if (mosaicOn) {
        opts.fillOpacity = 0;
        opts.fillColor = '#00000000';
      }
      polygon.options.set(opts);
    });
  },

  _showNdviLegend() {
    if (typeof RubinStyling === 'undefined') return;
    RubinStyling.renderLegend('ndvi');
    const bottom = document.getElementById('bottom-legend');
    if (bottom) bottom.hidden = false;
  },

  _hideNdviLegend() {
    if (RubinLayers.isVisible('ndvi')) return;
    const bottom = document.getElementById('bottom-legend');
    if (bottom) bottom.hidden = true;
  },

  _loadUiState() {
    try {
      const raw = localStorage.getItem(this.CACHE_KEY);
      if (!raw) return;
      const cached = JSON.parse(raw);
      this.lastMeta = cached.meta;
      this.hasMosaics = !!(cached.meta?.mosaic?.enabled);
      if (cached.meta?.mosaic?.opacity != null) {
        this.mosaicOpacity = Number(cached.meta.mosaic.opacity) || 0.6;
      }
      if (cached.values && RubinFields.features?.length) {
        this._applyValuesMap(cached.values, cached.meta, false);
        if (this.hasMosaics) this.renderMosaicLayer();
      }
    } catch (e) {
      console.warn('NDVI cache read error', e);
    }
  },

  _periodSeed() {
    if (this.period === 'custom' && this.customMonth) {
      return `custom_${this.customMonth}`;
    }
    return this.period;
  },

  /**
   * Обновить NDVI со спутника (JSON/GEE) и перекрасить поля.
   */
  async refreshAndApply() {
    if (!RubinFields.features?.length) {
      showToast('Нет полей для расчёта NDVI', 'error');
      return;
    }
    if (this.loading) return;

    const periodSel = document.getElementById('ndvi-period');
    const monthInp = document.getElementById('ndvi-custom-month');
    this.period = periodSel?.value || 'last_month';
    this.customMonth = this.period === 'custom' ? monthInp?.value || null : null;

    this.loading = true;
    const btn = document.getElementById('btn-refresh-ndvi');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Загрузка NDVI…';
    }

    showToast('Загрузка NDVI (Sentinel-2)…', 'info');

    try {
      const payload = await this._fetchNdvi();
      this._applyPayload(payload, { silent: false, repaintLayer: true });
    } catch (err) {
      console.error(err);
      showToast(err.message || 'Ошибка NDVI', 'error');
    } finally {
      this.loading = false;
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Обновить NDVI';
      }
    }
  },

  _applyPayload(payload, { silent = false, repaintLayer = true } = {}) {
    const valuesMap = {};
    (payload.values || []).forEach((v) => {
      valuesMap[v.id] = v;
    });

    const mosaicInfo = payload.mosaic || {};
    this.hasMosaics = !!(mosaicInfo.enabled && (payload.values || []).some((v) => v.mosaic));
    if (mosaicInfo.opacity != null) {
      this.mosaicOpacity = Math.min(0.85, Math.max(0.35, Number(mosaicInfo.opacity) || 0.6));
    }

    const meta = {
      period: payload.period,
      custom_month: payload.custom_month,
      start: payload.start,
      end: payload.end,
      label: payload.label,
      source: payload.source,
      generated_at: payload.generated_at,
      updatedAt: payload.generated_at || new Date().toISOString(),
      mosaic: {
        enabled: this.hasMosaics,
        count: mosaicInfo.count || 0,
        opacity: this.mosaicOpacity
      }
    };

    this._applyValuesMap(valuesMap, meta, repaintLayer);
    this.lastMeta = meta;

    localStorage.setItem(
      this.CACHE_KEY,
      JSON.stringify({ meta, values: payload.values })
    );

    this.enabled = true;
    if (repaintLayer) {
      this.renderLayer();
      this.renderMosaicLayer();
      if (this.hasMosaics) {
        RubinLayers.setVisible('ndvi_mosaic', true);
      } else {
        RubinLayers.setVisible('ndvi', true);
      }
    }

    if (!silent) {
      const srcLabel = this._isRealNdviSource(payload.source)
        ? 'Sentinel-2 / Google Earth Engine'
        : payload.source === 'demo_fallback'
          ? 'демо (GEE недоступен)'
          : 'демо-данные';
      const mosaicNote = this.hasMosaics
        ? `, мозаика ${meta.mosaic.count || ''} полей`
        : '';

      showToast(
        `NDVI обновлён (${payload.label || meta.period}, ${srcLabel}${mosaicNote})`,
        this._isRealNdviSource(payload.source) ? 'success' : 'info'
      );
    }
  },

  async _fetchNdvi() {
    const opts = {
      period: this.period,
      customMonth: this.customMonth
    };

    try {
      return await RubinGee.fetchNdviBatch(RubinFields.features, opts);
    } catch (apiErr) {
      console.warn('NDVI API unavailable, local demo', apiErr);
      const seed = this._periodSeed();
      const values = RubinGee.computeDemoNdvi(RubinFields.features, seed);
      const now = new Date();
      let start;
      let end;
      let label;

      if (this.period === 'last_year') {
        end = now.toISOString().slice(0, 10);
        const y = new Date(now);
        y.setFullYear(y.getFullYear() - 1);
        start = y.toISOString().slice(0, 10);
        label = 'последний год';
      } else if (this.period === 'custom' && this.customMonth) {
        start = `${this.customMonth}-01`;
        label = this.customMonth;
        end = start;
      } else {
        const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        start = d.toISOString().slice(0, 10);
        const d2 = new Date(now.getFullYear(), now.getMonth(), 0);
        end = d2.toISOString().slice(0, 10);
        label = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      }

      return {
        period: this.period,
        custom_month: this.customMonth,
        start,
        end,
        label,
        source: 'demo',
        mosaic: { enabled: false },
        values
      };
    }
  },

  _applyValuesMap(valuesMap, meta, repaint) {
    RubinFields.features.forEach((f) => {
      const row = valuesMap[f.id];
      if (!row) return;
      f.properties.ndvi = row.ndvi;
      f.properties.ndviStatus = row.status || ndviStatusLabel(row.ndvi);
      f.properties.ndviPeriod = meta?.label || meta?.period;
      f.properties.ndviSource = meta?.source;
      f.properties.ndviUpdated = meta?.updatedAt;
      if (row.mosaic && row.bbox) {
        f.properties.ndviMosaic = {
          url: row.mosaic,
          bbox: row.bbox
        };
      } else {
        delete f.properties.ndviMosaic;
      }
    });

    RubinFields._syncFieldsData();
    if (typeof RubinCrops !== 'undefined') RubinCrops.renderAll();
    else this.renderFieldsTable();

    if (repaint) {
      this.renderLayer();
      const sel = RubinFields.getSelectedFeature();
      if (sel) {
        document.dispatchEvent(new CustomEvent('rubin:fieldSelected', { detail: { feature: sel } }));
      }
    }
  },

  /** Слой среднего NDVI — однотонная заливка по полю */
  renderLayer() {
    const coll = RubinLayers.getCollection('ndvi');
    if (!coll) return;
    coll.removeAll();

    const fillOpacity = this.hasMosaics ? 0.22 : 0.65;

    RubinFields.features.forEach((feature) => {
      if (feature.properties.ndvi == null) return;
      const coords = geoJsonToYmapsCoords(feature.geometry);
      const fill = RubinStyling.getNdviColor(feature.properties.ndvi);
      const poly = new ymaps.Polygon(
        [coords],
        {
          hintContent: `${feature.properties.name} — NDVI ${feature.properties.ndvi}`,
          balloonContent: `NDVI ${feature.properties.ndvi} (${feature.properties.ndviStatus || ''})`
        },
        {
          fillColor: fill,
          fillOpacity,
          strokeColor: fill,
          strokeWidth: 1,
          strokeOpacity: 0.35
        }
      );
      poly.events.add('click', (e) => {
        e.stopPropagation();
        RubinFields.select(feature.id);
      });
      coll.add(poly);
    });

    if (RubinLayers.isVisible('ndvi')) {
      RubinLayers._syncCollectionOnMap('ndvi');
    }
  },

  clearMosaicOverlays() {
    const coll = RubinLayers.getCollection('ndvi_mosaic');
    if (coll) coll.removeAll();
    this.mosaicOverlays = [];
    this._mosaicDrawn = false;
  },

  /**
   * Внутрипольные PNG-мозаики: прямоугольник по bbox + fillImageHref
   * (PNG уже обрезан по полю с прозрачностью снаружи — так сохраняется геопривязка).
   */
  renderMosaicLayer() {
    this.clearMosaicOverlays();
    const coll = RubinLayers.getCollection('ndvi_mosaic');
    if (!coll) return;

    const hasAny = RubinFields.features.some((f) => f.properties?.ndviMosaic?.url);
    this.hasMosaics = hasAny;
    if (!hasAny) return;

    let drawn = 0;
    RubinFields.features.forEach((feature) => {
      const m = feature.properties.ndviMosaic;
      if (!m?.url || !m.bbox) return;
      const b = m.bbox;
      if (![b.west, b.south, b.east, b.north].every((n) => Number.isFinite(Number(n)))) return;

      const imageUrl = this._mosaicImageUrl(m.url);
      const rect = new ymaps.Rectangle(
        [
          [Number(b.south), Number(b.west)],
          [Number(b.north), Number(b.east)]
        ],
        {
          hintContent: `${feature.properties.name} — NDVI ${feature.properties.ndvi ?? '—'} (мозаика)`,
          balloonContent: `Средний NDVI ${feature.properties.ndvi ?? '—'} (${feature.properties.ndviStatus || ''})`
        },
        {
          fillImageHref: imageUrl,
          fillMethod: 'stretch',
          fillOpacity: this.mosaicOpacity,
          stroke: false,
          strokeWidth: 0,
          strokeOpacity: 0,
          cursor: 'pointer',
          // не перехватывать лишние события вне непрозрачных пикселей — клик по полю
          interactivityModel: 'default#transparent'
        }
      );
      rect.events.add('click', (e) => {
        e.stopPropagation();
        RubinFields.select(feature.id);
      });
      coll.add(rect);
      this.mosaicOverlays.push(rect);
      drawn += 1;
    });

    this._mosaicDrawn = drawn > 0;
    this.hasMosaics = drawn > 0;

    if (RubinMap.map && RubinLayers.isVisible('ndvi_mosaic')) {
      RubinLayers._syncCollectionOnMap('ndvi_mosaic');
      this._updateBaseForMosaic(true);
      this._showNdviLegend();
    }
  },

  /** Включить мозаику и приблизить к выбранному полю */
  showMosaicForField(featureOrId) {
    const feature =
      typeof featureOrId === 'object'
        ? featureOrId
        : RubinFields.features.find((f) => String(f.id) === String(featureOrId));
    if (!feature?.properties?.ndviMosaic) {
      showToast('Для этого поля нет NDVI-мозаики — нажмите «Обновить NDVI»', 'info');
      return;
    }
    RubinLayers.setVisible('ndvi_mosaic', true);
    if (feature.geometry && RubinMap.map) {
      RubinMap.fitToFields([feature]);
    }
    showToast(`Мозаика NDVI: ${feature.properties.name || feature.id}`, 'success');
  },

  renderFieldsTable() {
    const wrap = document.getElementById('fields-table-wrap');
    const tbody = document.getElementById('fields-table-body');
    if (!tbody) return;

    const rows = RubinFields.features
      .map((f) => {
        const p = f.properties;
        const ndvi =
          p.ndvi != null
            ? `<span class="ndvi-val" style="color:${RubinStyling.getNdviColor(p.ndvi)}">${p.ndvi}</span>`
            : '—';
        const area = p.sq != null ? `${p.sq}` : '—';
        return `<tr data-field-id="${escapeAttr(f.id)}">
          <td>${escapeHtml(p.name || f.id)}</td>
          <td>${area}</td>
          <td>—</td>
          <td>—</td>
          <td>${ndvi}</td>
        </tr>`;
      })
      .join('');

    tbody.innerHTML = rows || '<tr><td colspan="5">Нет полей</td></tr>';

    if (wrap) wrap.hidden = RubinFields.features.length === 0;

    tbody.querySelectorAll('tr[data-field-id]').forEach((tr) => {
      tr.addEventListener('click', () => {
        const id = tr.getAttribute('data-field-id');
        if (id) RubinFields.select(id);
      });
    });
  }
};

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = String(s);
  return d.innerHTML;
}

function escapeAttr(s) {
  return String(s).replace(/"/g, '&quot;');
}
