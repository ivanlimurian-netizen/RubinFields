/**
 * CRUD полей: базовый слой — только границы (без аналитической заливки)
 */
const RubinFields = {
  features: [],
  polygons: {},
  selectedId: null,
  drawMode: false,
  drawCoords: [],
  drawPlacemarks: [],
  editingPolygon: null,
  bulkDataset: false,

  async init() {
    let collection = RubinStorage.load();
    const fromStorage = !!(collection?.features?.length);
    if (!fromStorage) {
      collection = await loadInitialFields();
      this.bulkDataset = collection.features.length > 10;
    }
    this.features = collection.features || [];
    this.renderAll();
    this._syncFieldsData();
    if (typeof RubinCrops !== 'undefined') RubinCrops.renderAll();
    else if (typeof RubinNdvi !== 'undefined') RubinNdvi.renderFieldsTable();
    if (this.features.length && !fromStorage && RubinMap.map) {
      RubinMap.fitToFields(this.features);
    }
    return this;
  },

  getCollectionGeoJson() {
    return { type: 'FeatureCollection', features: this.features };
  },

  persist() {
    if (this.bulkDataset) return false;
    return RubinStorage.save(this.getCollectionGeoJson());
  },

  _syncFieldsData() {
    syncWindowFieldsData(this.getCollectionGeoJson());
  },

  renderAll() {
    const coll = RubinMap.getCollection();
    if (!coll) return;
    coll.removeAll();
    this.polygons = {};

    this.features.forEach((feature) => {
      const poly = this._createPolygon(feature);
      this.polygons[feature.id] = poly;
      coll.add(poly);
    });
    this._syncFieldsData();
    if (typeof RubinNdvi !== 'undefined') {
      RubinNdvi.renderLayer();
      if (RubinNdvi.hasMosaics) RubinNdvi.renderMosaicLayer();
    }
    if (typeof RubinCrops !== 'undefined') RubinCrops.renderCropLayer();
    if (typeof RubinSoilMap !== 'undefined') RubinSoilMap.renderSoilLayer();
  },

  _createPolygon(feature) {
    const coords = geoJsonToYmapsCoords(feature.geometry);
    const selected = feature.id === this.selectedId;
    const opts = RubinLayers.getBaseFieldOptions(feature, selected);

    const hint = feature.properties.name;

    const polygon = new ymaps.Polygon([coords], { hintContent: hint, balloonContent: hint }, opts);

    polygon.events.add('click', (e) => {
      e.stopPropagation();
      this.select(feature.id);
    });

    polygon.properties.set('fieldId', feature.id);
    return polygon;
  },

  applyStyles() {
    const mosaicOn =
      typeof RubinNdvi !== 'undefined' &&
      RubinNdvi.hasMosaics &&
      typeof RubinLayers !== 'undefined' &&
      RubinLayers.isVisible('ndvi_mosaic');

    Object.entries(this.polygons).forEach(([id, polygon]) => {
      const selected = id === this.selectedId;
      const feature = this.features.find((f) => f.id === id);
      const opts = RubinLayers.getBaseFieldOptions(feature, selected);
      if (mosaicOn) {
        opts.fillOpacity = 0;
        opts.fillColor = '#00000000';
      }
      polygon.options.set(opts);
    });
  },

  select(id) {
    this.selectedId = id;
    this._updateToolbar();
    this.applyStyles();
    const feature = this.features.find((f) => f.id === id);
    if (feature) {
      document.dispatchEvent(new CustomEvent('rubin:fieldSelected', { detail: { feature } }));
    }
  },

  clearSelection() {
    this.selectedId = null;
    this._updateToolbar();
    this.applyStyles();
    document.getElementById('infopanel')?.setAttribute('hidden', '');
    document.getElementById('app')?.classList.remove('infopanel-open');
  },

  _updateToolbar() {
    const has = !!this.selectedId;
    document.getElementById('btn-edit-geometry').disabled = !has;
    document.getElementById('btn-delete-field').disabled = !has;
  },

  getSelectedFeature() {
    return this.features.find((f) => f.id === this.selectedId) || null;
  },

  startDraw() {
    if (!RubinMap.map) {
      showToast('Карта не инициализирована', 'error');
      return;
    }
    if (this.drawMode) return;
    this.clearSelection();
    this.stopGeometryEdit();
    this.drawMode = true;
    this.drawCoords = [];
    const hint = document.getElementById('draw-hint');
    if (hint) {
      hint.hidden = false;
      hint.style.display = 'block';
    }

    this._drawClickHandler = (e) => {
      const coords = e.get('coords');
      this.drawCoords.push(coords);
      const pm = new ymaps.Placemark(coords, {}, {
        preset: 'islands#greenCircleDotIcon',
        draggable: false
      });
      RubinMap.getMap().geoObjects.add(pm);
      this.drawPlacemarks.push(pm);
    };
    RubinMap.getMap().events.add('click', this._drawClickHandler);
    showToast('Режим рисования: кликайте по карте для вершин', 'info');
  },

  cancelDraw() {
    this.drawMode = false;
    const hint = document.getElementById('draw-hint');
    if (hint) {
      hint.hidden = true;
      hint.style.display = 'none';
    }
    if (this._drawClickHandler) {
      RubinMap.getMap().events.remove('click', this._drawClickHandler);
    }
    this.drawPlacemarks.forEach((pm) => RubinMap.getMap().geoObjects.remove(pm));
    this.drawPlacemarks = [];
    this.drawCoords = [];
  },

  finishDraw() {
    if (this.drawCoords.length < 3) {
      showToast('Нужно минимум 3 точки для полигона', 'error');
      return;
    }
    const ring = ymapsCoordsToGeoJson(this.drawCoords);
    this.cancelDraw();

    const feature = {
      type: 'Feature',
      id: generateId(),
      properties: {
        name: 'Новое поле',
        texture: 'loamy',
        humus: 'medium',
        rating: 3
      },
      geometry: { type: 'Polygon', coordinates: ring }
    };

    document.dispatchEvent(
      new CustomEvent('rubin:editAttributes', { detail: { feature, isNew: true } })
    );
  },

  addFeature(feature) {
    this.features.push(feature);
    const poly = this._createPolygon(feature);
    this.polygons[feature.id] = poly;
    RubinMap.getCollection().add(poly);
    this.persist();
    this.select(feature.id);
  },

  updateFeature(id, properties, geometry) {
    const idx = this.features.findIndex((f) => f.id === id);
    if (idx < 0) return;
    if (properties) this.features[idx].properties = { ...this.features[idx].properties, ...properties };
    if (geometry) this.features[idx].geometry = geometry;

    RubinMap.getCollection().remove(this.polygons[id]);
    const poly = this._createPolygon(this.features[idx]);
    this.polygons[id] = poly;
    RubinMap.getCollection().add(poly);
    this.persist();
    if (typeof RubinNdvi !== 'undefined') RubinNdvi.renderLayer();
    if (typeof RubinCrops !== 'undefined') RubinCrops.renderCropLayer();
    if (typeof RubinSoilMap !== 'undefined') RubinSoilMap.renderSoilLayer();
    if (this.selectedId === id) {
      document.dispatchEvent(
        new CustomEvent('rubin:fieldSelected', { detail: { feature: this.features[idx] } })
      );
    }
  },

  deleteSelected() {
    const id = this.selectedId;
    if (!id) return;
    const feature = this.getSelectedFeature();
    const name = feature?.properties?.name || 'поле';
    if (!confirm(`Удалить «${name}»?`)) return;

    const idx = this.features.findIndex((f) => f.id === id);
    if (idx >= 0) this.features.splice(idx, 1);
    if (typeof RubinCrops !== 'undefined') RubinCrops.removeFieldFromAllPlans(id);
    if (this.polygons[id]) {
      RubinMap.getCollection().remove(this.polygons[id]);
      delete this.polygons[id];
    }
    this.clearSelection();
    this.persist();
    showToast('Поле удалено', 'success');
  },

  startGeometryEdit() {
    const id = this.selectedId;
    if (!id || !this.polygons[id]) return;
    this.stopGeometryEdit();

    const polygon = this.polygons[id];
    polygon.editor.startEditing();
    this.editingPolygon = polygon;

    polygon.editor.events.add('geometrychange', () => {
      const coords = polygon.geometry.getCoordinates()[0];
      const ring = ymapsCoordsToGeoJson(coords);
      const feature = this.features.find((f) => f.id === id);
      if (feature) {
        feature.geometry.coordinates = ring;
        this.persist();
      }
    });

    showToast('Редактирование контура: перетащите вершины', 'info');
  },

  stopGeometryEdit() {
    if (this.editingPolygon) {
      try {
        this.editingPolygon.editor.stopEditing();
      } catch (_) {}
      this.editingPolygon = null;
    }
  },

  addFieldsFromGeoJSON(collection, replace = false) {
    const features = collection?.features || (Array.isArray(collection) ? collection : []);
    return this.importFeatures(features, replace);
  },

  importFeatures(newFeatures, replace = false) {
    if (replace) {
      this.features = newFeatures;
    } else {
      newFeatures.forEach((f) => {
        if (!f.id) f.id = generateId();
        this.features.push(f);
      });
    }
    this.bulkDataset = this.features.length > 10;
    this.renderAll();
    this.persist();
    if (typeof RubinCrops !== 'undefined') RubinCrops.renderAll();
    else if (typeof RubinNdvi !== 'undefined') RubinNdvi.renderFieldsTable();
    RubinMap.fitToFields(this.features);
    showToast(`Загружено полей: ${newFeatures.length}`, 'success');
  },

  /**
   * Overlay analysis: применить атрибуты слоя к базовым полям.
   * НИКОГДА не добавляет/не заменяет геометрию базового слоя.
   */
  applyOverlayAttributes(layerMeta, matches) {
    if (!layerMeta?.id) throw new Error('Overlay layer id missing');
    const layerId = layerMeta.id;
    let updated = 0;

    this.features.forEach((f) => {
      const m = matches.get(f.id);
      if (!m?.attrs) return;
      const props = f.properties || (f.properties = {});
      if (!props.overlays) props.overlays = {};
      props.overlays[layerId] = {
        ...m.attrs,
        _score: m.score != null ? +m.score.toFixed(3) : undefined,
        _source: layerMeta.source || layerMeta.label || layerId,
        _updatedAt: Date.now()
      };
      updated += 1;
    });

    RubinOverlayRegistry.upsert(layerMeta);
    this.persist();
    this._syncFieldsData();
    if (this.selectedId) {
      const feature = this.getSelectedFeature();
      if (feature) {
        document.dispatchEvent(new CustomEvent('rubin:fieldSelected', { detail: { feature } }));
      }
    }

    return { updated };
  },

  async resetToSource() {
    if (!confirm('Перезагрузить поля из fields.geojson? Локальные изменения будут потеряны.')) return;
    try {
      localStorage.removeItem(RubinStorage.KEY);
    } catch (_) {}
    const collection = (await loadProductionFields()) || (await loadSampleFields());
    this.features = collection.features;
    this.bulkDataset = this.features.length > 10;
    this.clearSelection();
    this.renderAll();
    RubinMap.fitToFields(this.features);
    showToast(`Загружено полей: ${this.features.length}`, 'success');
  },

  exportJson() {
    const blob = new Blob([JSON.stringify(this.getCollectionGeoJson(), null, 2)], {
      type: 'application/json'
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'rubin_fields_export.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }
};
