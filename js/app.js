/**
 * Связка модулей и UI
 */
(function initRubinGis() {
  const dialog = document.getElementById('attr-dialog');
  const attrForm = document.getElementById('attr-form');
  let pendingFeature = null;
  let pendingIsNew = false;

  // Скрипты в конце <body> часто выполняются ПОСЛЕ DOMContentLoaded — подписываемся безопасно
  function runWhenReady(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  }

  runWhenReady(async () => {
    try {
      await RubinMap.init();
      RubinMapInfoLayers.init();
      await RubinFields.init();
      RubinCrops.init();
      RubinNdvi.init();
      RubinSoilMap.init();
      if (typeof RubinOverlayStyling !== 'undefined') RubinOverlayStyling.initUi();
      bindUi();
      RubinFileLoader.init();
      const n = RubinFields.features.length;
      showToast(
        n > 10
          ? `Загружено ${n} полей из fields.geojson. Кликните на поле для информации.`
          : 'Карта загружена. Кликните на поле для информации.',
        'success'
      );
    } catch (e) {
      console.error(e);
      showToast(`Ошибка инициализации: ${e.message}`, 'error');
      // Кнопки и загрузка файлов всё равно должны работать после ошибки полей
      try {
        bindUi();
        RubinFileLoader.init();
      } catch (e2) {
        console.error(e2);
      }
    }
  });

  function bindUi() {
    document.getElementById('btn-add-field')?.addEventListener('click', () => {
      if (!RubinMap.map) {
        showToast('Карта ещё не готова. Обновите страницу.', 'error');
        return;
      }
      RubinFields.startDraw();
    });

    document.getElementById('btn-load-shp')?.addEventListener('click', () => {
      document.getElementById('input-shp')?.click();
    });
    document.getElementById('btn-load-tif')?.addEventListener('click', () => {
      document.getElementById('input-tif')?.click();
    });
    document.getElementById('btn-load-mapinfo')?.addEventListener('click', () => {
      if (!RubinMap.map) {
        showToast('Карта ещё не готова. Обновите страницу.', 'error');
        return;
      }
      RubinFileLoader.loadMapInfoFields().catch((err) => {
        console.error(err);
        showToast(err.message || 'Ошибка MapInfo', 'error');
      });
    });
    document.getElementById('btn-finish-draw')?.addEventListener('click', () => RubinFields.finishDraw());
    document.getElementById('btn-cancel-draw')?.addEventListener('click', () => RubinFields.cancelDraw());
    document.getElementById('btn-edit-geometry')?.addEventListener('click', () => RubinFields.startGeometryEdit());
    document.getElementById('btn-delete-field')?.addEventListener('click', () => RubinFields.deleteSelected());
    document.getElementById('btn-export-json')?.addEventListener('click', () => RubinFields.exportJson());
    document.getElementById('btn-reset-data')?.addEventListener('click', () => RubinFields.resetToSource());

    document.getElementById('btn-close-panel')?.addEventListener('click', () => RubinFields.clearSelection());

    document.getElementById('search-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const q = document.getElementById('search-input').value.trim();
      if (!q) return;
      try {
        const geo = await RubinMap.geocode(q);
        RubinMap.showSearchResult(geo);
      } catch (err) {
        showToast(err.message || 'Геокодирование не удалось', 'error');
      }
    });

    RubinMap.getMap()?.events.add('click', () => {
      if (!RubinFields.drawMode && !RubinFields.editingPolygon) {
        // клик по карте без поля — не сбрасываем, если кликнули полигон (stopPropagation)
      }
    });

    document.addEventListener('rubin:fieldSelected', (e) => showInfoPanel(e.detail.feature, 'field'));
    document.addEventListener('rubin:soilSelected', (e) => showInfoPanel(e.detail.feature, 'soil'));
    document.addEventListener('rubin:editAttributes', (e) => openAttrDialog(e.detail.feature, e.detail.isNew));

    document.getElementById('attr-cancel')?.addEventListener('click', () => {
      dialog.close();
      pendingFeature = null;
    });

    attrForm?.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!pendingFeature) return;
      const fd = new FormData(attrForm);
      const properties = {
        name: fd.get('name'),
        texture: fd.get('texture'),
        humus: fd.get('humus'),
        rating: parseInt(fd.get('rating'), 10),
        crop: fd.get('crop') || ''
      };
      if (pendingIsNew) {
        pendingFeature.properties = properties;
        RubinFields.addFeature(pendingFeature);
        if (properties.crop) {
          RubinCrops.setCropForField(pendingFeature.id, properties.crop, RubinCrops.viewYear);
        }
      } else {
        RubinFields.updateFeature(pendingFeature.id, properties);
        RubinCrops.setCropForField(pendingFeature.id, properties.crop, RubinCrops.viewYear);
      }
      dialog.close();
      pendingFeature = null;
      showToast('Сохранено', 'success');
    });
  }

  function openAttrDialog(feature, isNew) {
    pendingFeature = feature;
    pendingIsNew = isNew;
    document.getElementById('attr-dialog-title').textContent = isNew
      ? 'Новое поле — атрибуты'
      : 'Редактировать атрибуты';
    attrForm.name.value = feature.properties.name || '';
    attrForm.texture.value = feature.properties.texture || 'loamy';
    attrForm.humus.value = feature.properties.humus || 'medium';
    attrForm.rating.value = String(feature.properties.rating || 3);
    const cropId =
      feature.properties.crop ||
      RubinCrops.getCropForField(feature.id, RubinCrops.viewYear);
    RubinCrops.fillAttrCropSelect(document.getElementById('attr-crop'), cropId);
    const yearSpan = document.getElementById('attr-crop-year');
    if (yearSpan) yearSpan.textContent = String(RubinCrops.viewYear);
    dialog.showModal();
  }

  async function showInfoPanel(feature, kind = 'field') {
    const panel = document.getElementById('infopanel');
    const content = document.getElementById('infopanel-content');
    const app = document.getElementById('app');
    if (!panel || !content) return;

    const props = feature.properties;
    const areaCalc = polygonAreaHa(feature.geometry);
    const areaDisplay = props.sq != null ? `${props.sq} га` : `${areaCalc} га`;
    const isSoil = kind === 'soil' || props.source === 'mapinfo-soil';
    const isMapinfoField = props.source === 'mapinfo';

    let extraRows = '';
    if (isMapinfoField && props.number) {
      extraRows += `<dt>Номер (MapInfo)</dt><dd>${escapeHtml(props.number)}</dd>`;
    }
    if (isSoil) {
      extraRows += `<dt>Тип почвы</dt><dd>${escapeHtml(props.soilType || props.name)}</dd>`;
      if (props.granSostav) {
        extraRows += `<dt>Гран. состав</dt><dd>${escapeHtml(props.granSostav)}</dd>`;
      }
    }

    // Overlay analysis: атрибутные слои, привязанные spatial join’ом
    if (!isSoil && props.overlays && typeof props.overlays === 'object') {
      const layerEntries = Object.entries(props.overlays);
      layerEntries.forEach(([layerId, attrs]) => {
        if (!attrs || typeof attrs !== 'object') return;
        const title =
          attrs._source ? `${attrs._source}` : layerId;
        extraRows += `<dt class="overlay-sep">Слой</dt><dd><strong>${escapeHtml(title)}</strong></dd>`;
        const keys = Object.keys(attrs)
          .filter((k) => !k.startsWith('_'))
          .slice(0, 24);
        keys.forEach((k) => {
          const v = attrs[k];
          if (v == null || v === '') return;
          extraRows += `<dt class="overlay-k">${escapeHtml(k)}</dt><dd>${escapeHtml(String(v))}</dd>`;
        });
        if (attrs._score != null) {
          extraRows += `<dt class="overlay-k">Совпадение</dt><dd>${escapeHtml(String(attrs._score))}</dd>`;
        }
      });
    }

    const weatherBlock = isSoil
      ? ''
      : `<div id="weather-slot">Загрузка погоды…</div>
      <div class="infopanel-actions">
        <button type="button" class="primary" id="btn-edit-attrs">Редактировать</button>
        <button type="button" id="btn-refresh-weather">Обновить погоду</button>
      </div>`;

    const soilActions = isSoil
      ? '<p class="weather-demo-note">Почвенная разность MapInfo (слой «Почвы_Рубин»)</p>'
      : '';

    content.innerHTML = `
      <h2>${escapeHtml(props.name)}</h2>
      ${isMapinfoField ? '<p class="weather-demo-note">Контур поля MapInfo (красный)</p>' : ''}
      <dl>
        ${extraRows}
        <dt>Площадь</dt>
        <dd><span class="area-badge">${areaDisplay}</span>${props.sq_acc != null ? ` <span class="area-note">(учёт: ${props.sq_acc} га)</span>` : ''}</dd>
        <dt>Почва</dt>
        <dd>${TEXTURE_LABELS[props.texture] || props.texture}</dd>
        ${props.soilMapLabel ? `<dt>Почва (JPG)</dt><dd><span class="legend-swatch" style="background:${props.soilMapColor || '#888'};display:inline-block;vertical-align:middle"></span> ${escapeHtml(props.soilMapLabel)}</dd>` : ''}
        <dt>Гумус</dt>
        <dd>${HUMUS_LABELS[props.humus] || props.humus}</dd>
        ${!isSoil ? `<dt>Культура (${RubinCrops.viewYear})</dt><dd>${escapeHtml(RubinCrops.getCropLabel(props.crop || RubinCrops.getCropForField(feature.id, RubinCrops.viewYear)))}</dd>` : ''}
        <dt>Рейтинг</dt>
        <dd>${ratingLabel(props.rating)}</dd>
        ${buildNdviPanelRows(props)}
      </dl>
      ${soilActions}
      ${weatherBlock}`;

    panel.hidden = false;
    app.classList.add('infopanel-open');

    if (!isSoil) {
      document.getElementById('btn-edit-attrs')?.addEventListener('click', () => {
        openAttrDialog(feature, false);
      });

      document.getElementById('btn-show-ndvi-mosaic')?.addEventListener('click', () => {
        if (typeof RubinNdvi !== 'undefined') RubinNdvi.showMosaicForField(feature);
      });

      const loadWeather = async (force) => {
        const slot = document.getElementById('weather-slot');
        try {
          const w = await RubinWeather.getForField(feature, force);
          slot.innerHTML = RubinWeather.renderHtml(w);
        } catch (err) {
          slot.innerHTML = `<p class="weather-demo-note">Погода недоступна${err?.message ? `: ${escapeHtml(err.message)}` : ''}</p>`;
        }
      };

      document.getElementById('btn-refresh-weather')?.addEventListener('click', () => loadWeather(true));
      await loadWeather(false);
    }
  }

  function buildNdviPanelRows(props) {
    if (props.ndvi == null) {
      return `<dt>NDVI</dt><dd class="ndvi-muted">Данные подгружаются из data/ndvi_latest.json или по кнопке «Обновить NDVI»</dd>`;
    }
    const color = RubinStyling.getNdviColor(props.ndvi);
    const period = props.ndviPeriod ? ` (${props.ndviPeriod})` : '';
    const src =
      props.ndviSource === 'gee' || props.ndviSource === 'gee_static'
        ? 'Sentinel-2 / Google Earth Engine'
        : props.ndviSource === 'demo_fallback'
          ? 'демо (GEE недоступен)'
          : 'демо';
    const hasMosaic = !!(props.ndviMosaic && props.ndviMosaic.url);
    const mosaicBtn = hasMosaic
      ? `<button type="button" class="tool-btn tool-btn--small" id="btn-show-ndvi-mosaic">Показать мозаику NDVI</button>`
      : `<span class="ndvi-muted">Мозаика пока не рассчитана (запустите calc_ndvi.py)</span>`;
    return `
      <dt>NDVI (среднее)</dt>
      <dd>
        <span class="ndvi-badge" style="background:${color}">NDVI = ${props.ndvi}</span>
        — ${escapeHtml(props.ndviStatus || ndviStatusLabel(props.ndvi))}${period}
        <br><span class="ndvi-muted">${src}</span>
        <div class="ndvi-mosaic-actions">${mosaicBtn}</div>
      </dd>`;
  }

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }
})();
