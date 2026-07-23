/**
 * Загрузка SHP (zip/shp через shpjs) и GeoTIFF (geotiff.js)
 */
const RubinFileLoader = {
  _inited: false,
  MAPINFO_STATIC: {
    fields: 'data/mapinfo_polya.geojson',
    soils: 'data/mapinfo_pochvy.geojson'
  },
  init() {
    if (this._inited) return;
    this._inited = true;
    const shpInput = document.getElementById('input-shp');
    const tifInput = document.getElementById('input-tif');
    if (!shpInput || !tifInput) {
      console.error('File inputs #input-shp / #input-tif not found');
      return;
    }
    shpInput.addEventListener('change', (e) => this._onShp(e));
    tifInput.addEventListener('change', (e) => this._onTif(e));
  },

  async _onShp(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    showToast(`Чтение SHP: ${file.name}…`, 'info');

    try {
      if (!RubinMap.map || !RubinFields.features) {
        throw new Error('Приложение не инициализировано. Обновите страницу (F5).');
      }
      const features = await this.parseShpFile(file);
      if (!features.length) {
        showToast('В файле не найдено полигонов', 'error');
        return;
      }

      // Overlay analysis: добавляем атрибуты к базовым полям, а не новые поля
      const layerId = safeLayerId('shp', file.name);
      const layerMeta = { id: layerId, label: `SHP: ${file.name}`, source: 'shp' };

      const overlay = features
        .filter((f) => f?.geometry)
        .map((f) => ({
          type: 'Feature',
          properties: f.properties || {},
          geometry: normalizeGeometry(ensureWgs84Geometry(f.geometry))
        }));

      // Сохраняем геометрию слоя для отрисовки зон (как на примере)
      RubinOverlayData.set(layerId, overlay);

      const { matches, stats } = spatialJoinOverlayToFields(RubinFields.features, overlay, {
        minScoreField: 0.6,
        minScoreOverlay: 0.75,
        pickProps: (props) => ({ ...props })
      });

      RubinFields.applyOverlayAttributes(layerMeta, matches);

      showToast(
        `Overlay слой добавлен: ${layerMeta.label}. Совпадений: ${stats.matched}/${stats.totalFields}. ` +
          `Кликните по полю — атрибуты появятся в инфопанели.`,
        stats.matched ? 'success' : 'error'
      );
    } catch (err) {
      console.error(err);
      showToast(`Ошибка SHP: ${err.message}`, 'error');
    }
  },

  async parseShpFile(file) {
    const parser = window.shp || window.shpjs;
    if (!parser) {
      throw new Error('Библиотека shpjs не загружена. Проверьте интернет и обновите страницу.');
    }

    const buffer = await file.arrayBuffer();
    const name = file.name.toLowerCase();

    if (name.endsWith('.zip')) {
      const geojson = await parser(buffer);
      return this._flattenGeoJson(geojson);
    }

    throw new Error('Упакуйте .shp, .dbf и .shx в один .zip и загрузите архив');
  },

  _flattenGeoJson(geojson) {
    if (geojson.type === 'FeatureCollection') {
      return geojson.features.filter((f) => f.geometry?.type === 'Polygon' || f.geometry?.type === 'MultiPolygon');
    }
    if (geojson.type === 'Feature') return [geojson];
    if (Array.isArray(geojson)) {
      return geojson.flatMap((g) => this._flattenGeoJson(g));
    }
    return [];
  },

  _mapShpFeature(feature, index) {
    const geometry = normalizeGeometry(feature.geometry);

    const props = feature.properties || {};
    const name =
      props.name || props.NAME || props.Name || props['Название'] || `Поле ${index + 1}`;

    return {
      type: 'Feature',
      id: generateId(),
      properties: {
        name: String(name),
        texture: this._guessTexture(props),
        humus: this._guessHumus(props),
        rating: this._guessRating(props)
      },
      geometry
    };
  },

  _guessTexture(props) {
    return guessTextureFromText(props.texture || props.soil || props.TEXTURE || props.Gran_Sostav);
  },

  _guessHumus(props) {
    const h = parseFloat(props.humus || props.gumus || props.HUMUS);
    if (!isNaN(h)) {
      if (h < 2) return 'low';
      if (h <= 4) return 'medium';
      return 'high';
    }
    return 'medium';
  },

  _guessRating(props) {
    return letterRatingToNumber(props.rating || props.RATING || props.class);
  },

  async _onTif(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    showToast(`Чтение TIF: ${file.name}…`, 'info');

    try {
      if (!RubinMap.map) {
        throw new Error('Карта не инициализирована');
      }
      await this.parseTifFile(file);
      RubinLayers.setVisible('tif', true);
      showToast('Почвенная карта (TIF) наложена', 'success');
    } catch (err) {
      console.error(err);
      showToast(`Ошибка TIF: ${err.message}`, 'error');
    }
  },

  async parseTifFile(file) {
    if (typeof GeoTIFF === 'undefined') {
      throw new Error('Библиотека geotiff.js не загружена');
    }

    const buffer = await file.arrayBuffer();
    const tiff = await GeoTIFF.fromArrayBuffer(buffer);
    const image = await tiff.getImage();
    const bbox = image.getBoundingBox();
    const width = image.getWidth();
    const height = image.getHeight();
    const raster = await image.readRasters({ interleave: true });

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const imgData = ctx.createImageData(width, height);
    const bands = image.getSamplesPerPixel();

    for (let i = 0; i < width * height; i++) {
      const idx = i * 4;
      if (bands >= 3) {
        imgData.data[idx] = raster[i * bands] || 0;
        imgData.data[idx + 1] = raster[i * bands + 1] || 0;
        imgData.data[idx + 2] = raster[i * bands + 2] || 0;
      } else {
        const v = raster[i] || 0;
        imgData.data[idx] = v;
        imgData.data[idx + 1] = v;
        imgData.data[idx + 2] = v;
      }
      imgData.data[idx + 3] = 200;
    }
    ctx.putImageData(imgData, 0, 0);

    const dataUrl = canvas.toDataURL('image/png');
    // bbox: [minX, minY, maxX, maxY] в lon/lat
    const bounds = [
      [bbox[1], bbox[0]],
      [bbox[3], bbox[2]]
    ];
    RubinMap.setGroundOverlay(dataUrl, bounds);
    RubinMap.fitToFields([
      {
        geometry: {
          coordinates: [
            [
              [bbox[0], bbox[1]],
              [bbox[2], bbox[1]],
              [bbox[2], bbox[3]],
              [bbox[0], bbox[3]],
              [bbox[0], bbox[1]]
            ]
          ]
        }
      }
    ]);
  },

  /**
   * Загрузка слоёв MapInfo из папки «Maps vector» (через Flask) или из data/*.geojson
   */
  async loadMapInfoFields() {
    if (!RubinMap.map || !RubinFields.features) {
      throw new Error('Приложение не инициализировано. Обновите страницу (F5).');
    }

    showToast('Чтение MapInfo (Поля_Рубин, Почвы_Рубин)…', 'info');

    const [fieldsGeo, soilsGeo] = await Promise.all([
      this._fetchMapInfoLayer('fields'),
      this._fetchMapInfoLayer('soils')
    ]);

    ensureMapInfoGeoJsonCollection(fieldsGeo);
    ensureMapInfoGeoJsonCollection(soilsGeo);

    const fieldFeatures = (fieldsGeo.features || []).map((f, i) => mapMapinfoFieldFeature(f, i));
    const soilFeatures = (soilsGeo.features || []).map((f, i) => mapMapinfoSoilFeature(f, i));

    if (!fieldFeatures.length) {
      throw new Error('В слое «Поля_Рубин» не найдено полигонов');
    }

    // Overlay analysis: НЕ импортируем новые поля, а привязываем атрибуты MapInfo к базовому слою
    const mapinfoLayerMeta = { id: 'mapinfo_fields', label: 'MapInfo: Поля_Рубин', source: 'mapinfo' };
    const { matches: mapinfoMatches, stats: mapinfoStats } = spatialJoinOverlayToFields(
      RubinFields.features,
      fieldFeatures,
      {
        minScore: 0.7,
        pickProps: (props) => ({
          Number: props.number ?? props.Number ?? props.NAME ?? props.Name ?? '',
          Area_ha: props.sq ?? props.Area_ha ?? null
        })
      }
    );
    RubinFields.applyOverlayAttributes(mapinfoLayerMeta, mapinfoMatches);

    if (soilFeatures.length && typeof RubinMapInfoLayers !== 'undefined') {
      RubinMapInfoLayers.loadFeatures(soilFeatures);
    }

    // Дополнительно: привязываем почвенную разность к базовым полям (для инфопанели)
    if (soilFeatures.length) {
      const soilsMeta = { id: 'mapinfo_soils_join', label: 'MapInfo: Почвы_Рубин (join)', source: 'mapinfo' };
      const { matches: soilMatches } = spatialJoinOverlayToFields(RubinFields.features, soilFeatures, {
        minScore: 0.35,
        pickProps: (props) => ({
          Name_soil: props.soilType ?? props.Name_soil ?? props.name_soil ?? props.name ?? '',
          Gran_Sostav: props.granSostav ?? props.Gran_Sostav ?? props.gran_sostav ?? ''
        })
      });
      RubinFields.applyOverlayAttributes(soilsMeta, soilMatches);
    }

    showToast(
      `MapInfo overlay: атрибуты полей ${mapinfoStats.matched}/${mapinfoStats.totalFields}, ` +
        `почвенных полигонов: ${soilFeatures.length}.`,
      'success'
    );

    return { fields: fieldFeatures, soils: soilFeatures };
  },

  async _fetchMapInfoLayer(layer) {
    let lastError = null;

    const staticUrl = this.MAPINFO_STATIC[layer];
    if (staticUrl) {
      try {
        const data = await fetchJson(staticUrl);
        if (data?.features?.length) {
          showToast(`MapInfo загружен: ${staticUrl}`, 'success');
          return data;
        }
      } catch (e) {
        lastError = e;
      }
    }

    if (isLocalApiHost()) {
      const apiUrls = [
        appUrl(`api/mapinfo/${layer}`),
        `http://127.0.0.1:5000/api/mapinfo/${layer}`
      ];
      for (const url of apiUrls) {
        try {
          const data = await fetchJson(url);
          if (data?.features?.length) return data;
          if (data?.error) throw new Error(data.error);
        } catch (e) {
          lastError = e;
        }
      }
    }

    const base = getAppBasePath() || '/RubinFields';
    throw new Error(
      `На сервере нет ${staticUrl} (${lastError?.message || 'HTTP 404'}). ` +
        `Перед загрузкой папки на хостинг на ПК запустите export_mapinfo.bat ` +
        `и залейте data/mapinfo_polya.geojson и data/mapinfo_pochvy.geojson. ` +
        `Контуры полей уже есть в fields.geojson — MapInfo нужен для слоя «Почвы» и атрибутов из MapInfo.`
    );
  }
};
