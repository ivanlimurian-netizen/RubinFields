/**
 * Слой почвенных разностей MapInfo (Почвы_Рубин) — отдельный включаемый слой
 */
const RubinMapInfoLayers = {
  features: [],
  polygons: {},

  init() {
    document.addEventListener('rubin:layerVisibility', (e) => {
      if (e.detail?.id === 'mapinfo_soils') this._syncOnMap();
    });
    return this;
  },

  clear() {
    const coll = RubinMap.getSoilsCollection();
    if (coll) coll.removeAll();
    this.polygons = {};
    this.features = [];
  },

  loadFeatures(features) {
    this.clear();
    this.features = features;
    this.renderAll();
    RubinLayers.setVisible('mapinfo_soils', true);
  },

  renderAll() {
    const coll = RubinMap.getSoilsCollection();
    if (!coll) return;
    coll.removeAll();
    this.polygons = {};

    this.features.forEach((feature) => {
      const poly = this._createPolygon(feature);
      this.polygons[feature.id] = poly;
      coll.add(poly);
    });
    this._syncOnMap();
  },

  _createPolygon(feature) {
    const coords = geoJsonToYmapsCoords(feature.geometry);
    const fill = RubinStyling.getColor(feature.properties, 'texture');

    const polygon = new ymaps.Polygon(
      [coords],
      {
        hintContent: feature.properties.name,
        balloonContent: feature.properties.name
      },
      {
        fillColor: fill,
        fillOpacity: 0.45,
        strokeColor: '#5c4a3a',
        strokeWidth: 1,
        strokeOpacity: 0.6
      }
    );

    polygon.events.add('click', (e) => {
      e.stopPropagation();
      RubinFields.clearSelection();
      document.dispatchEvent(new CustomEvent('rubin:soilSelected', { detail: { feature } }));
    });

    return polygon;
  },

  _syncOnMap() {
    if (!RubinLayers.isVisible('mapinfo_soils')) return;
    RubinLayers._syncCollectionOnMap('mapinfo_soils');
  },

  setVisible(visible) {
    RubinLayers.setVisible('mapinfo_soils', visible);
  },

  toggleVisible() {
    RubinLayers.toggle('mapinfo_soils');
  }
};
