/**
 * Управление слоями карты (как в TrueFields / Агроноут):
 * базовый слой — только границы полей; аналитика — отдельными включаемыми слоями.
 */
const RubinLayers = {
  STORAGE_KEY: 'rubin_gis_layers_state',

  /** Порядок снизу вверх */
  DEFINITIONS: [
    { id: 'tif', label: 'Растр TIF / подложка', group: 'raster', defaultVisible: false },
    { id: 'soil_jpg_raster', label: 'Подложка почвенной карты (JPG)', group: 'raster', defaultVisible: false },
    { id: 'overlay_zones', label: 'Overlay зоны (SHP)', group: 'overlay', defaultVisible: true },
    { id: 'mapinfo_soils', label: 'Почвенные разности MapInfo', group: 'overlay', defaultVisible: false },
    { id: 'soil_jpg', label: 'Тип почвы с JPG', group: 'overlay', defaultVisible: false },
    { id: 'ndvi', label: 'NDVI среднее (заливка)', group: 'overlay', defaultVisible: false },
    { id: 'crops', label: 'Культуры (посев)', group: 'overlay', defaultVisible: false },
    { id: 'base', label: 'Границы полей', group: 'base', defaultVisible: true, locked: true },
    // Мозаика поверх контуров (заливка base при мозаике обнуляется)
    { id: 'ndvi_mosaic', label: 'NDVI мозаика (внутри поля)', group: 'overlay', defaultVisible: false }
  ],

  collections: {},
  state: {},
  _inited: false,

  init() {
    if (!RubinMap.map || this._inited) return this;
    this._inited = true;
    this._loadState();

    this.DEFINITIONS.forEach((def) => {
      this.collections[def.id] = new ymaps.GeoObjectCollection({}, { geodesic: true });
      if (this.state[def.id] === undefined) {
        this.state[def.id] = def.defaultVisible;
      }
    });

    this._applyZOrder();
    this.renderPanel();
    this._bindRasterLayers();
    return this;
  },

  _bindRasterLayers() {
    document.addEventListener('rubin:layerVisibility', (e) => {
      const { id, visible } = e.detail || {};
      if (!RubinMap.map) return;
      if (id === 'tif' && RubinMap.groundOverlay) {
        if (visible) RubinMap.map.geoObjects.add(RubinMap.groundOverlay);
        else RubinMap.map.geoObjects.remove(RubinMap.groundOverlay);
      }
      if (id === 'soil_jpg_raster' && RubinMap.soilMapOverlay) {
        if (visible) RubinMap.map.geoObjects.add(RubinMap.soilMapOverlay);
        else RubinMap.map.geoObjects.remove(RubinMap.soilMapOverlay);
      }
    });
  },

  _loadState() {
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      if (raw) this.state = JSON.parse(raw);
    } catch (_) {
      this.state = {};
    }
  },

  _saveState() {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.state));
    } catch (_) {}
  },

  getCollection(id) {
    return this.collections[id];
  },

  isVisible(id) {
    return !!this.state[id];
  },

  setVisible(id, visible) {
    const def = this.DEFINITIONS.find((d) => d.id === id);
    if (!def || def.locked) return;

    this.state[id] = visible;
    this._saveState();
    this._syncCollectionOnMap(id);
    this.renderPanel();

    document.dispatchEvent(
      new CustomEvent('rubin:layerVisibility', { detail: { id, visible } })
    );
  },

  toggle(id) {
    this.setVisible(id, !this.isVisible(id));
  },

  _applyZOrder() {
    if (!RubinMap.map) return;
    Object.values(this.collections).forEach((c) => {
      try {
        RubinMap.map.geoObjects.remove(c);
      } catch (_) {}
    });
    this.DEFINITIONS.forEach((def) => {
      const coll = this.collections[def.id];
      if (coll && this.isVisible(def.id)) {
        RubinMap.map.geoObjects.add(coll);
      }
    });
  },

  _syncCollectionOnMap(id) {
    const coll = this.collections[id];
    if (!coll || !RubinMap.map) return;
    const onMap = RubinMap.map.geoObjects.indexOf(coll) >= 0;
    if (this.isVisible(id) && !onMap) {
      RubinMap.map.geoObjects.add(coll);
    }
    if (!this.isVisible(id) && onMap) {
      RubinMap.map.geoObjects.remove(coll);
    }
  },

  /** Перестроить порядок после изменений */
  refreshZOrder() {
    this._applyZOrder();
  },

  renderPanel() {
    const host = document.getElementById('layers-panel');
    if (!host) return;

    const html = this.DEFINITIONS.map((def) => {
      const checked = this.isVisible(def.id) ? 'checked' : '';
      const disabled = def.locked ? 'disabled' : '';
      const hint =
        def.id === 'base'
          ? 'контуры без заливки — основа карты'
          : def.group === 'raster'
            ? 'подложка под полями'
            : 'отдельный слой поверх границ';
      return `<label class="layer-row" title="${hint}">
        <input type="checkbox" data-layer-id="${def.id}" ${checked} ${disabled}>
        <span>${def.label}</span>
      </label>`;
    }).join('');

    host.innerHTML = html;

    host.querySelectorAll('input[data-layer-id]').forEach((inp) => {
      inp.addEventListener('change', () => {
        const id = inp.getAttribute('data-layer-id');
        this.setVisible(id, inp.checked);
      });
    });
  },

  /** Стили базового контура поля (с учётом overlay окраски) */
  getBaseFieldOptions(feature, selected = false) {
    const overlay = typeof RubinOverlayStyling !== 'undefined' ? RubinOverlayStyling : null;
    const overlayOpts = overlay?.getPolygonOptions?.(feature, selected);
    if (overlayOpts) return overlayOpts;

    return {
      fillColor: '#6b8cae',
      fillOpacity: 0.06,
      strokeColor: selected ? '#ffffff' : '#d8dee9',
      strokeWidth: selected ? 3 : 2,
      strokeOpacity: 1
    };
  }
};
