/**

 * Яндекс.Карта, геокодер, растровые подложки (TIF, JPG)

 * Векторные слои — через RubinLayers (js/layers.js)

 */

const RubinMap = {

  map: null,

  searchResult: null,

  groundOverlay: null,

  soilMapOverlay: null,



  CENTER: [53.9833, 79.4833],

  ZOOM: 12,



  init() {

    return new Promise((resolve, reject) => {

      if (typeof ymaps === 'undefined') {

        reject(new Error('Yandex Maps API не загружен'));

        return;

      }

      ymaps.ready(() => {

        try {

          this.map = new ymaps.Map('map', {

            center: this.CENTER,

            zoom: this.ZOOM,

            controls: ['zoomControl', 'typeSelector', 'fullscreenControl', 'rulerControl']

          });

          RubinLayers.init();

          resolve(this.map);

        } catch (e) {

          reject(e);

        }

      });

    });

  },



  getCollection() {

    return RubinLayers.getCollection('base');

  },



  getSoilsCollection() {

    return RubinLayers.getCollection('mapinfo_soils');

  },

  getOverlayZonesCollection() {
    return RubinLayers.getCollection('overlay_zones');
  },



  setGroundOverlay(imageUrl, bounds) {

    this.removeGroundOverlay();

    this.groundOverlay = new ymaps.GroundOverlay(

      [

        [bounds[0][0], bounds[0][1]],

        [bounds[1][0], bounds[1][1]]

      ],

      { imageUrl, opacity: 0.55 }

    );

    if (RubinLayers.isVisible('tif')) {

      this.map.geoObjects.add(this.groundOverlay);

    }

  },



  removeGroundOverlay() {

    if (this.groundOverlay && this.map) {

      this.map.geoObjects.remove(this.groundOverlay);

      this.groundOverlay = null;

    }

  },



  toggleTifLayer(visible) {

    RubinLayers.setVisible('tif', visible);

    if (!this.groundOverlay) return;

    if (visible) this.map.geoObjects.add(this.groundOverlay);

    else this.map.geoObjects.remove(this.groundOverlay);

  },



  fitToFields(features) {

    if (!features.length || !this.map) return;

    const bounds = [];

    features.forEach((f) => {

      bounds.push(...geometryBoundsPoints(f.geometry));

    });

    if (bounds.length) {

      this.map.setBounds(ymaps.util.bounds.fromPoints(bounds), {

        checkZoomRange: true,

        zoomMargin: 40

      });

    }

  },



  async geocode(query) {

    return ymaps.geocode(query, { results: 1 }).then((res) => {

      const first = res.geoObjects.get(0);

      if (!first) throw new Error('Адрес не найден');

      return first;

    });

  },



  showSearchResult(geoObject) {

    if (this.searchResult) {

      this.map.geoObjects.remove(this.searchResult);

    }

    this.searchResult = geoObject;

    this.map.geoObjects.add(this.searchResult);

    this.map.setCenter(geoObject.geometry.getCoordinates(), 14, { duration: 300 });

  },



  getMap() {

    return this.map;

  }

};


