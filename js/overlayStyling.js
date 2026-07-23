/**
 * Overlay-окраска базовых полей по атрибутам spatial join слоёв.
 *
 * Источник значений: feature.properties.overlays[layerId][attrKey]
 * Рисуем ЗАЛИВКУ на базовом слое (границы полей).
 */
const RubinOverlayStyling = {
  STORAGE_KEY: 'rubin_gis_overlay_style_v1',
  state: {
    enabled: false,
    layerId: '',
    attrKey: '',
    scheme: 'categorical', // categorical | quantile
    palette: ['#d32f2f', '#f57c00', '#fbc02d', '#7cb342', '#388e3c', '#1b5e20']
  },

  initUi() {
    this._load();
    this._renderLayerOptions();
    this._bindUi();
    this._syncAttrOptions();
    if (this.state.enabled) {
      this.apply(this.state.layerId, this.state.attrKey, { silent: true });
    }
  },

  _load() {
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      if (raw) this.state = { ...this.state, ...JSON.parse(raw) };
    } catch (_) {}
  },

  _save() {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.state));
    } catch (_) {}
  },

  _bindUi() {
    const selLayer = document.getElementById('overlay-layer');
    const selAttr = document.getElementById('overlay-attr');
    const btnApply = document.getElementById('btn-overlay-apply');
    const btnReset = document.getElementById('btn-overlay-reset');

    selLayer?.addEventListener('change', () => {
      this.state.layerId = selLayer.value;
      this._save();
      this._syncAttrOptions();
    });

    selAttr?.addEventListener('change', () => {
      this.state.attrKey = selAttr.value;
      this._save();
    });

    btnApply?.addEventListener('click', () => {
      const layerId = selLayer?.value || '';
      const attrKey = selAttr?.value || '';
      this.apply(layerId, attrKey);
    });

    btnReset?.addEventListener('click', () => this.reset());
  },

  _renderLayerOptions() {
    const el = document.getElementById('overlay-layer');
    if (!el) return;
    const layers = RubinOverlayRegistry.load();
    const options = [
      `<option value="">— выберите —</option>`,
      ...layers.map((l) => `<option value="${l.id}">${escapeHtml(l.label || l.id)}</option>`)
    ];
    el.innerHTML = options.join('');
    if (this.state.layerId) el.value = this.state.layerId;
  },

  _syncAttrOptions() {
    const layerId = this.state.layerId;
    const el = document.getElementById('overlay-attr');
    if (!el) return;
    if (!layerId) {
      el.innerHTML = `<option value="">—</option>`;
      return;
    }

    const keys = new Set();
    (RubinFields?.features || []).forEach((f) => {
      const attrs = f?.properties?.overlays?.[layerId];
      if (!attrs) return;
      Object.keys(attrs).forEach((k) => {
        if (!k.startsWith('_')) keys.add(k);
      });
    });

    const list = [...keys].sort((a, b) => a.localeCompare(b));
    el.innerHTML = [`<option value="">— выберите —</option>`, ...list.map((k) => `<option value="${k}">${escapeHtml(k)}</option>`)].join('');
    if (this.state.attrKey && list.includes(this.state.attrKey)) el.value = this.state.attrKey;
  },

  apply(layerId, attrKey, opts = {}) {
    if (!layerId || !attrKey) {
      showToast('Выберите overlay слой и атрибут', 'error');
      return;
    }

    const values = [];
    RubinFields.features.forEach((f) => {
      const v = f?.properties?.overlays?.[layerId]?.[attrKey];
      if (v == null || v === '') return;
      values.push(v);
    });

    if (!values.length) {
      showToast('Нет значений этого атрибута на полях (join не сработал)', 'error');
      return;
    }

    const numeric = values.every((v) => !Number.isNaN(Number(v)));
    const unique = new Set(values.map((v) => String(v))).size;

    this.state.enabled = true;
    this.state.layerId = layerId;
    this.state.attrKey = attrKey;
    this.state.scheme = numeric && unique > 10 ? 'quantile' : 'categorical';
    this._save();

    this._buildScale(values);
    RubinFields.applyStyles();

    // Зоны: если есть исходные полигоны слоя — рисуем их поверх, с цветом по атрибуту
    this.renderZones(layerId, attrKey);

    if (!opts.silent) showToast('Окрас по overlay включён', 'success');
  },

  reset() {
    this.state.enabled = false;
    this._save();
    this.scale = null;
    this._renderLegend(null);
    this.clearZones();
    RubinFields.applyStyles();
    showToast('Overlay окрас сброшен', 'info');
  },

  clearZones() {
    const coll = RubinMap?.getOverlayZonesCollection?.();
    if (coll) coll.removeAll();
  },

  renderZones(layerId, attrKey) {
    const coll = RubinMap?.getOverlayZonesCollection?.();
    if (!coll) return;
    coll.removeAll();

    if (!RubinOverlayData?.get?.(layerId)) {
      // Нечего рисовать — слой только атрибутный (join) без геометрии
      return;
    }

    const features = RubinOverlayData.get(layerId) || [];
    const max = 8000; // защита от перегруза
    let added = 0;

    for (const f of features) {
      if (added >= max) break;
      const v = f?.properties?.[attrKey];
      if (v == null || v === '') continue;
      const g = normalizeGeometry(ensureWgs84Geometry(f.geometry));
      const coords = geoJsonToYmapsCoords(g);
      const fillColor = this._colorFor(v);
      const poly = new ymaps.Polygon(
        [coords],
        {
          hintContent: `${attrKey}: ${String(v)}`,
          balloonContent: `${attrKey}: ${String(v)}`
        },
        {
          fillColor,
          fillOpacity: 0.62,
          strokeColor: '#101820',
          strokeOpacity: 0.45,
          strokeWidth: 1
        }
      );
      coll.add(poly);
      added += 1;
    }

    RubinLayers.setVisible('overlay_zones', true);
    RubinLayers.refreshZOrder();
  },

  _buildScale(values) {
    const palette = this.state.palette;
    const scheme = this.state.scheme;

    if (scheme === 'quantile') {
      const nums = values.map((v) => Number(v)).filter((v) => !Number.isNaN(v)).sort((a, b) => a - b);
      const k = 5;
      const breaks = [];
      for (let i = 1; i < k; i++) {
        const idx = Math.floor((nums.length * i) / k);
        breaks.push(nums[Math.min(idx, nums.length - 1)]);
      }
      this.scale = { scheme, breaks, colors: palette.slice(0, k) };
      this._renderLegend({
        title: `${this._layerLabel(this.state.layerId)} → ${this.state.attrKey}`,
        items: this._legendItemsForQuantile(breaks, palette.slice(0, k))
      });
      return;
    }

    const uniq = [...new Set(values.map((v) => String(v)))].sort((a, b) => a.localeCompare(b, 'ru'));
    const colors = uniq.map((_, i) => palette[i % palette.length]);
    const map = {};
    uniq.forEach((k, i) => (map[k] = colors[i]));
    this.scale = { scheme, map, colors };
    this._renderLegend({
      title: `${this._layerLabel(this.state.layerId)} → ${this.state.attrKey}`,
      items: uniq.slice(0, 20).map((k) => ({ label: k, color: map[k] }))
    });
  },

  _legendItemsForQuantile(breaks, colors) {
    const items = [];
    let prev = null;
    for (let i = 0; i < colors.length; i++) {
      const b = breaks[i] ?? null;
      const label =
        i === 0
          ? `≤ ${formatNum(b)}`
          : i === colors.length - 1
            ? `> ${formatNum(prev)}`
            : `${formatNum(prev)} – ${formatNum(b)}`;
      items.push({ label, color: colors[i] });
      prev = b;
    }
    return items;
  },

  _layerLabel(layerId) {
    const meta = RubinOverlayRegistry.load().find((l) => l.id === layerId);
    return meta?.label || layerId;
  },

  _renderLegend(legend) {
    const bottom = document.getElementById('bottom-legend');
    if (!bottom) return;
    if (!legend) {
      bottom.innerHTML = '';
      return;
    }
    const html = legend.items
      .map(
        (item) =>
          `<div class="legend-item"><span class="legend-swatch" style="background:${item.color}"></span><span>${escapeHtml(item.label)}</span></div>`
      )
      .join('');
    bottom.innerHTML = `<strong>${escapeHtml(legend.title)}:</strong>${html}`;
  },

  getPolygonOptions(feature, selected) {
    if (!this.state.enabled || !this.scale || !feature) return null;
    const layerId = this.state.layerId;
    const attrKey = this.state.attrKey;
    const raw = feature?.properties?.overlays?.[layerId]?.[attrKey];
    const has = raw != null && raw !== '';
    // Если рисуем зоны, базовые поля делаем почти прозрачными, чтобы зоны читались
    const zonesOn = RubinLayers?.isVisible?.('overlay_zones');
    const fillColor = has ? this._colorFor(raw) : '#455a64';
    return {
      fillColor,
      fillOpacity: zonesOn ? 0.06 : has ? (selected ? 0.72 : 0.58) : 0.04,
      strokeColor: selected ? '#ffffff' : '#d8dee9',
      strokeWidth: selected ? 3 : 2,
      strokeOpacity: 1
    };
  },

  _colorFor(v) {
    if (this.scale.scheme === 'categorical') {
      return this.scale.map[String(v)] || '#607d8b';
    }
    const x = Number(v);
    if (Number.isNaN(x)) return '#607d8b';
    const breaks = this.scale.breaks;
    let idx = 0;
    while (idx < breaks.length && x > breaks[idx]) idx += 1;
    return this.scale.colors[Math.min(idx, this.scale.colors.length - 1)] || '#607d8b';
  }
};

function formatNum(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  const x = Number(n);
  return Math.abs(x) >= 10 ? x.toFixed(0) : x.toFixed(2);
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

