/**
 * Распознавание типов почв с JPG почвенной карты:
 * геопривязка → сэмплирование цвета внутри контура поля → сопоставление с легендой.
 */
const RubinSoilMap = {
  STORAGE_KEY: 'rubin_gis_soil_map_georef',
  DEFAULT_IMAGE_PATHS: [
    'почвенная карта с легендой.jpg',
    'data/почвенная карта с легендой.jpg',
    'soil_map.jpg',
    'data/soil_map.jpg'
  ],

  image: null,
  imageUrl: null,
  canvas: null,
  ctx: null,
  width: 0,
  height: 0,

  /** WGS84: west, south, east, north */
  bounds: null,
  legend: { entries: [], borderColors: [], maxColorDistance: 85 },

  polygons: {},

  async init() {
    await this._loadLegend();
    this._loadGeoref();
    this._bindUi();
    this._restoreFromFields();
    return this;
  },

  /** Если в полях уже есть результаты распознавания — восстановить слой */
  _restoreFromFields() {
    const has = RubinFields.features?.some((f) => f.properties?.soilMapLabel);
    if (!has) return;
    this.renderSoilLayer();
    RubinLayers.setVisible('soil_jpg', true);
    this._tryLoadDefaultImage().then(() => {
      if (this.bounds) this.showOverlay();
    }).catch(() => {});
  },

  async _loadLegend() {
    try {
      const data = await fetchJson('data/soil_map_legend.json');
      this.legend.entries = data.entries || [];
      this.legend.borderColors = data.borderColors || [];
      this.legend.maxColorDistance = data.maxColorDistance ?? 85;
    } catch (e) {
      console.warn('soil_map_legend.json не загружен', e);
      this.legend.entries = [
        { id: 'chernozem', label: 'Чернозём', texture: 'loamy', rgb: [180, 60, 50] },
        { id: 'clay_loam', label: 'Суглинок', texture: 'clay_loam', rgb: [240, 210, 60] },
        { id: 'loam', label: 'Супесь', texture: 'loamy', rgb: [255, 240, 120] }
      ];
    }
    this._renderLegendEditor();
  },

  _loadGeoref() {
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      if (raw) this.bounds = JSON.parse(raw);
    } catch (_) {}
  },

  _saveGeoref() {
    if (this.bounds) {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.bounds));
    }
  },

  _bindUi() {
    document.getElementById('btn-soil-map')?.addEventListener('click', () => this.openDialog());
    document.getElementById('btn-soil-map-file')?.addEventListener('click', () => {
      document.getElementById('input-soil-jpg')?.click();
    });
    document.getElementById('input-soil-jpg')?.addEventListener('change', (e) => this._onFileSelected(e));
    document.getElementById('btn-soil-map-run')?.addEventListener('click', () => this.runRecognition());
    document.getElementById('btn-soil-map-auto-bounds')?.addEventListener('click', () => this.autoBounds());
    document.getElementById('btn-soil-map-close')?.addEventListener('click', () => {
      document.getElementById('soil-map-dialog')?.close();
    });

    ['georef-west', 'georef-east', 'georef-south', 'georef-north'].forEach((id) => {
      document.getElementById(id)?.addEventListener('change', () => this._readBoundsFromForm());
    });

    document.getElementById('soil-map-preview')?.addEventListener('click', (e) => this._onPreviewClick(e));
  },

  /** Границы по экстенту всех полей */
  autoBounds() {
    const b = this._computeFieldsBounds(RubinFields.features);
    if (!b) {
      showToast('Нет полей для привязки', 'error');
      return;
    }
    this.bounds = b;
    this._fillBoundsForm();
    this._saveGeoref();
    this._drawPreview();
    showToast('Границы установлены по контурам полей', 'success');
  },

  _computeFieldsBounds(features) {
    if (!features?.length) return null;
    let west = Infinity;
    let east = -Infinity;
    let south = Infinity;
    let north = -Infinity;

    features.forEach((f) => {
      const ring = geometryCoordinates(f.geometry)[0] || [];
      ring.forEach(([lon, lat]) => {
        west = Math.min(west, lon);
        east = Math.max(east, lon);
        south = Math.min(south, lat);
        north = Math.max(north, lat);
      });
    });

    if (!Number.isFinite(west)) return null;

    const padLon = (east - west) * 0.02 || 0.01;
    const padLat = (north - south) * 0.02 || 0.01;
    return {
      west: west - padLon,
      east: east + padLon,
      south: south - padLat,
      north: north + padLat
    };
  },

  _fillBoundsForm() {
    if (!this.bounds) return;
    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.value = val.toFixed(6);
    };
    set('georef-west', this.bounds.west);
    set('georef-east', this.bounds.east);
    set('georef-south', this.bounds.south);
    set('georef-north', this.bounds.north);
  },

  _readBoundsFromForm() {
    const num = (id) => parseFloat(document.getElementById(id)?.value);
    const west = num('georef-west');
    const east = num('georef-east');
    const south = num('georef-south');
    const north = num('georef-north');
    if ([west, east, south, north].every(Number.isFinite)) {
      this.bounds = { west, east, south, north };
      this._saveGeoref();
    }
  },

  async openDialog() {
    const dialog = document.getElementById('soil-map-dialog');
    if (!dialog) return;

    if (!this.image) {
      const loaded = await this._tryLoadDefaultImage();
      if (!loaded) {
        showToast('JPG не найден. Положите «почвенная карта с легендой.jpg» в папку проекта или выберите файл.', 'info');
      }
    }

    if (!this.bounds) this.autoBounds();
    else this._fillBoundsForm();

    this._drawPreview();
    dialog.showModal();
  },

  async _tryLoadDefaultImage() {
    for (const path of this.DEFAULT_IMAGE_PATHS) {
      try {
        await this._loadImageFromUrl(appUrl(path));
        return true;
      } catch (_) {}
    }
    return false;
  },

  _onFileSelected(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const url = URL.createObjectURL(file);
    this._loadImageFromUrl(url, true).then(() => {
      this.autoBounds();
      this._drawPreview();
      document.getElementById('soil-map-dialog')?.showModal();
      showToast(`Загружено: ${file.name}`, 'success');
    }).catch((err) => showToast(err.message, 'error'));
  },

  _loadImageFromUrl(url, isBlob = false) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      if (!isBlob) img.crossOrigin = 'anonymous';
      img.onload = () => {
        this.image = img;
        this.imageUrl = url;
        this.width = img.naturalWidth;
        this.height = img.naturalHeight;
        this.canvas = document.createElement('canvas');
        this.canvas.width = this.width;
        this.canvas.height = this.height;
        this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
        this.ctx.drawImage(img, 0, 0);
        resolve(img);
      };
      img.onerror = () => reject(new Error(`Не удалось загрузить изображение: ${url}`));
      img.src = url;
    });
  },

  /** WGS84 → пиксель [x, y] */
  lonLatToPixel(lon, lat) {
    const b = this.bounds;
    const x = ((lon - b.west) / (b.east - b.west)) * this.width;
    const y = ((b.north - lat) / (b.north - b.south)) * this.height;
    return [x, y];
  },

  _getPixelRgb(px, py) {
    const x = Math.max(0, Math.min(this.width - 1, Math.floor(px)));
    const y = Math.max(0, Math.min(this.height - 1, Math.floor(py)));
    const d = this.ctx.getImageData(x, y, 1, 1).data;
    return [d[0], d[1], d[2]];
  },

  _colorDistance(a, b) {
    return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
  },

  _isBorderRgb(rgb) {
    for (const b of this.legend.borderColors) {
      if (this._colorDistance(rgb, b) < 25) return true;
    }
    if (rgb[0] > 250 && rgb[1] > 250 && rgb[2] > 250) return true;
    return false;
  },

  _matchLegend(rgb) {
    let best = null;
    let bestDist = Infinity;
    for (const entry of this.legend.entries) {
      const d = this._colorDistance(rgb, entry.rgb);
      if (d < bestDist) {
        bestDist = d;
        best = entry;
      }
    }
    if (!best || bestDist > this.legend.maxColorDistance) {
      return {
        id: 'unknown',
        label: 'Не определено',
        texture: 'loamy',
        rgb,
        distance: bestDist
      };
    }
    return { ...best, distance: bestDist, matchedRgb: best.rgb };
  },

  _pointInPixelRing(px, py, ringPx) {
    let inside = false;
    for (let i = 0, j = ringPx.length - 1; i < ringPx.length; j = i++) {
      const xi = ringPx[i][0];
      const yi = ringPx[i][1];
      const xj = ringPx[j][0];
      const yj = ringPx[j][1];
      if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    return inside;
  },

  /**
   * Доминирующий цвет внутри полигона поля на JPG
   */
  sampleFieldDominantColor(feature) {
    const ring = geometryCoordinates(feature.geometry)[0];
    if (!ring?.length || !this.ctx || !this.bounds) return null;

    const ringPx = ring.map(([lon, lat]) => this.lonLatToPixel(lon, lat));

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    ringPx.forEach(([x, y]) => {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    });

    const step = Math.max(2, Math.floor(Math.min(maxX - minX, maxY - minY) / 40));
    const buckets = {};

    for (let py = minY; py <= maxY; py += step) {
      for (let px = minX; px <= maxX; px += step) {
        if (!this._pointInPixelRing(px, py, ringPx)) continue;
        const rgb = this._getPixelRgb(px, py);
        if (this._isBorderRgb(rgb)) continue;
        const key = `${Math.round(rgb[0] / 12) * 12},${Math.round(rgb[1] / 12) * 12},${Math.round(rgb[2] / 12) * 12}`;
        buckets[key] = (buckets[key] || 0) + 1;
      }
    }

    let topKey = null;
    let topCount = 0;
    Object.entries(buckets).forEach(([k, c]) => {
      if (c > topCount) {
        topCount = c;
        topKey = k;
      }
    });

    if (!topKey) return null;
    const [r, g, b] = topKey.split(',').map(Number);
    return this._matchLegend([r, g, b]);
  },

  async runRecognition() {
    if (!this.image || !this.ctx) {
      showToast('Сначала загрузите JPG почвенной карты', 'error');
      return;
    }
    if (!RubinFields.features?.length) {
      showToast('Нет векторных полей', 'error');
      return;
    }

    this._readBoundsFromForm();
    if (!this.bounds) {
      showToast('Задайте границы привязки (WGS84)', 'error');
      return;
    }

    showToast('Распознавание почв по карте…', 'info');
    const btn = document.getElementById('btn-soil-map-run');
    if (btn) btn.disabled = true;

    let ok = 0;
    let fail = 0;

    try {
      RubinFields.features.forEach((feature) => {
        const match = this.sampleFieldDominantColor(feature);
        if (!match) {
          fail += 1;
          return;
        }
        const color = this._rgbToHex(match.matchedRgb || match.rgb);
        feature.properties.soilMapType = match.id;
        feature.properties.soilMapLabel = match.label;
        feature.properties.soilMapColor = color;
        feature.properties.texture = match.texture || feature.properties.texture;
        ok += 1;
      });

      RubinFields._syncFieldsData();
      if (!RubinFields.bulkDataset) RubinFields.persist();

      this.renderSoilLayer();
      RubinLayers.setVisible('soil_jpg', true);
      this.showOverlay();
      RubinLayers.setVisible('soil_jpg_raster', true);

      showToast(`Распознано: ${ok} полей, без совпадения: ${fail}`, 'success');
      document.getElementById('soil-map-dialog')?.close();

      if (typeof RubinCrops !== 'undefined') RubinCrops.renderAll();
      if (typeof RubinNdvi !== 'undefined') RubinNdvi.renderFieldsTable();
    } catch (err) {
      console.error(err);
      showToast(err.message || 'Ошибка распознавания', 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  },

  _rgbToHex(rgb) {
    if (!rgb) return '#888888';
    const h = (n) => n.toString(16).padStart(2, '0');
    return `#${h(rgb[0])}${h(rgb[1])}${h(rgb[2])}`;
  },

  /** Отдельный слой — закраска полей по распознанным почвам */
  renderSoilLayer() {
    const coll = RubinLayers.getCollection('soil_jpg');
    if (!coll) return;
    coll.removeAll();
    this.polygons = {};

    RubinFields.features.forEach((feature) => {
      if (!feature.properties.soilMapLabel) return;
      const coords = geoJsonToYmapsCoords(feature.geometry);
      const fill = feature.properties.soilMapColor || '#8a8a8a';

      const poly = new ymaps.Polygon(
        [coords],
        {
          hintContent: `${feature.properties.name}: ${feature.properties.soilMapLabel}`,
          balloonContent: `<strong>${feature.properties.name}</strong><br>Почва (карта): ${feature.properties.soilMapLabel}`
        },
        {
          fillColor: fill,
          fillOpacity: 0.72,
          strokeColor: '#333333',
          strokeWidth: 1,
          strokeOpacity: 0.5
        }
      );

      poly.events.add('click', (e) => {
        e.stopPropagation();
        RubinFields.select(feature.id);
      });

      this.polygons[feature.id] = poly;
      coll.add(poly);
    });

    if (RubinLayers.isVisible('soil_jpg')) {
      RubinLayers._syncCollectionOnMap('soil_jpg');
    }
  },

  showOverlay() {
    if (!this.imageUrl || !this.bounds || !RubinMap.map) return;
    const b = this.bounds;
    const boundsLatLon = [
      [b.south, b.west],
      [b.north, b.east]
    ];
    if (RubinMap.soilMapOverlay) {
      RubinMap.map.geoObjects.remove(RubinMap.soilMapOverlay);
    }
    RubinMap.soilMapOverlay = new ymaps.GroundOverlay(boundsLatLon, {
      imageUrl: this.imageUrl,
      opacity: 0.45
    });
    if (RubinLayers.isVisible('soil_jpg_raster')) {
      RubinMap.map.geoObjects.add(RubinMap.soilMapOverlay);
    }
  },

  _drawPreview() {
    const canvas = document.getElementById('soil-map-preview');
    if (!canvas || !this.image) return;
    const maxW = 640;
    const scale = Math.min(1, maxW / this.width);
    canvas.width = Math.floor(this.width * scale);
    canvas.height = Math.floor(this.height * scale);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(this.image, 0, 0, canvas.width, canvas.height);
    canvas.dataset.scale = String(scale);
  },

  /** Пипетка: клик по превью — добавить цвет в легенду */
  _onPreviewClick(e) {
    const canvas = document.getElementById('soil-map-preview');
    if (!canvas || !this.ctx) return;
    const rect = canvas.getBoundingClientRect();
    const scale = parseFloat(canvas.dataset.scale || '1');
    const x = Math.floor((e.clientX - rect.left) / scale);
    const y = Math.floor((e.clientY - rect.top) / scale);
    const rgb = this._getPixelRgb(x, y);
    const label = prompt(
      `RGB(${rgb.join(', ')})\nВведите название типа почвы для легенды:`,
      'Новый тип'
    );
    if (!label) return;
    const texture = prompt('Код текстуры (sandy/loamy/clay_loam/clay):', 'loamy') || 'loamy';
    this.legend.entries.push({
      id: `custom_${Date.now()}`,
      label,
      texture,
      rgb
    });
    this._renderLegendEditor();
    showToast(`Добавлено в легенду: ${label}`, 'success');
  },

  _renderLegendEditor() {
    const el = document.getElementById('soil-legend-list');
    if (!el) return;
    el.innerHTML = this.legend.entries
      .map(
        (e) =>
          `<div class="legend-item">
            <span class="legend-swatch" style="background:rgb(${e.rgb.join(',')})"></span>
            <span>${e.label}</span>
          </div>`
      )
      .join('');
  }
};
