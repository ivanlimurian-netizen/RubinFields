/**
 * Культуры и посевной план по годам: хранение, сводки, таблицы, история.
 */
const RubinCrops = {
  STORAGE_KEY: 'rubin_gis_sowing_plans',
  VIEW_YEAR_KEY: 'rubin_gis_sowing_view_year',

  /** Справочник культур (id → название) */
  CROP_COLORS: {
    wheat_soft: '#e8c547',
    pea: '#7cb342',
    brome: '#aed581',
    rapeseed: '#ffee58',
    flax: '#4db6ac',
    oats: '#dce775',
    barley: '#ffb74d',
    fallow: '#9e9e9e'
  },

  CROP_LIST: [
    { id: 'wheat_soft', label: 'Пшеница мягкая яровая' },
    { id: 'pea', label: 'Горох посевной' },
    { id: 'brome', label: 'Кострец безостый' },
    { id: 'rapeseed', label: 'Рапс яровой' },
    { id: 'flax', label: 'Лен масличный' },
    { id: 'oats', label: 'Овес яровой' },
    { id: 'barley', label: 'Ячмень яровой' },
    { id: 'fallow', label: 'Пар' }
  ],

  viewYear: null,
  plans: {},

  init() {
    this._loadPlans();
    this.viewYear = this._loadViewYear();
    this._ensureYear(this.viewYear);
    this._migrateCropsFromFeatures();
    this._bindUi();
    this.applyYearToFields(this.viewYear);
    this.renderAll();
    return this;
  },

  _currentCalendarYear() {
    return new Date().getFullYear();
  },

  _loadPlans() {
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      const data = raw ? JSON.parse(raw) : { plans: {} };
      this.plans = data.plans || {};
    } catch (e) {
      console.warn('Sowing plans load error', e);
      this.plans = {};
    }
  },

  _savePlans() {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify({ plans: this.plans }));
      return true;
    } catch (e) {
      showToast('Не удалось сохранить посевной план', 'error');
      return false;
    }
  },

  _loadViewYear() {
    const saved = localStorage.getItem(this.VIEW_YEAR_KEY);
    const y = parseInt(saved, 10);
    return Number.isFinite(y) ? y : this._currentCalendarYear();
  },

  _saveViewYear(year) {
    localStorage.setItem(this.VIEW_YEAR_KEY, String(year));
  },

  _ensureYear(year) {
    if (!this.plans[String(year)]) {
      this.plans[String(year)] = {};
    }
  },

  getCropLabel(cropId) {
    if (!cropId) return '— не указана —';
    const c = this.CROP_LIST.find((x) => x.id === cropId);
    return c ? c.label : cropId;
  },

  /** Площадь поля в га */
  getFieldAreaHa(feature) {
    const p = feature.properties || {};
    if (p.sq != null && !Number.isNaN(Number(p.sq))) return Number(p.sq);
    return polygonAreaHa(feature.geometry);
  },

  getCropForField(fieldId, year) {
    const y = String(year ?? this.viewYear);
    return this.plans[y]?.[fieldId] || '';
  },

  setCropForField(fieldId, cropId, year) {
    const y = String(year ?? this.viewYear);
    this._ensureYear(y);
    if (!cropId) {
      delete this.plans[y][fieldId];
    } else {
      this.plans[y][fieldId] = cropId;
    }
    this._savePlans();

    if (y === String(this.viewYear)) {
      const f = RubinFields.features.find((x) => x.id === fieldId);
      if (f) {
        f.properties.crop = cropId || '';
        f.properties.sowingYear = Number(y);
        RubinFields._syncFieldsData();
      }
    }
    this.renderAll();
  },

  /** Применить культуру выбранного года к properties полей (для карты и инфопанели) */
  applyYearToFields(year) {
    const y = String(year ?? this.viewYear);
    this._ensureYear(y);
    RubinFields.features.forEach((f) => {
      const crop = this.getCropForField(f.id, y);
      f.properties.crop = crop;
      f.properties.sowingYear = Number(y);
    });
    RubinFields._syncFieldsData();
  },

  setViewYear(year) {
    this.viewYear = Number(year);
    this._saveViewYear(this.viewYear);
    this._ensureYear(this.viewYear);
    this.applyYearToFields(this.viewYear);
    this.renderCropLayer();

    const yearSel = document.getElementById('sowing-year');
    const yearSelDialog = document.getElementById('sowing-plan-year');
    if (yearSel) yearSel.value = String(this.viewYear);
    if (yearSelDialog) yearSelDialog.value = String(this.viewYear);

    this.renderAll();
    RubinFields.applyStyles();
  },

  getYearsList() {
    const years = new Set(Object.keys(this.plans).map(Number));
    years.add(this._currentCalendarYear());
    years.add(this.viewYear);
    return [...years].sort((a, b) => a - b);
  },

  addYear(year) {
    const y = Number(year);
    if (!Number.isFinite(y) || y < 1990 || y > 2100) {
      showToast('Некорректный год', 'error');
      return;
    }
    this._ensureYear(y);
    this._savePlans();
    this._refreshYearSelects();
    this.setViewYear(y);
    showToast(`Добавлен план на ${y} год`, 'success');
  },

  /** Сводка посевов за год: площади по культурам и итого */
  computeSummary(year) {
    const y = String(year ?? this.viewYear);
    const byCrop = {};
    let totalHa = 0;
    let assignedHa = 0;
    let unassignedHa = 0;
    let fieldCount = 0;

    this.CROP_LIST.forEach((c) => {
      byCrop[c.id] = { label: c.label, ha: 0, count: 0 };
    });
    byCrop._unassigned = { label: 'Не назначено', ha: 0, count: 0 };

    RubinFields.features.forEach((f) => {
      const ha = this.getFieldAreaHa(f);
      totalHa += ha;
      fieldCount += 1;
      const cropId = this.getCropForField(f.id, y);

      if (!cropId) {
        byCrop._unassigned.ha += ha;
        byCrop._unassigned.count += 1;
        unassignedHa += ha;
        return;
      }

      if (!byCrop[cropId]) {
        byCrop[cropId] = { label: this.getCropLabel(cropId), ha: 0, count: 0 };
      }
      byCrop[cropId].ha += ha;
      byCrop[cropId].count += 1;
      assignedHa += ha;
    });

    Object.keys(byCrop).forEach((k) => {
      byCrop[k].ha = +byCrop[k].ha.toFixed(2);
    });

    return {
      year: Number(y),
      byCrop,
      totalHa: +totalHa.toFixed(2),
      assignedHa: +assignedHa.toFixed(2),
      unassignedHa: +unassignedHa.toFixed(2),
      fieldCount
    };
  },

  /** HTML <option> для select культур */
  buildCropOptions(selectedId) {
    const empty = `<option value="">— не выбрана —</option>`;
    const opts = this.CROP_LIST.map(
      (c) =>
        `<option value="${escapeAttr(c.id)}"${c.id === selectedId ? ' selected' : ''}>${escapeHtml(c.label)}</option>`
    ).join('');
    return empty + opts;
  },

  /** Перенос crop из properties полей в план текущего года (если плана ещё нет) */
  _migrateCropsFromFeatures() {
    const y = String(this.viewYear);
    this._ensureYear(y);
    RubinFields.features.forEach((f) => {
      if (!this.plans[y][f.id] && f.properties?.crop) {
        this.plans[y][f.id] = f.properties.crop;
      }
    });
    this._savePlans();
  },

  _bindUi() {
    const yearSel = document.getElementById('sowing-year');
    const btnPlan = document.getElementById('btn-sowing-plan');
    const dialog = document.getElementById('sowing-plan-dialog');
    const planYearSel = document.getElementById('sowing-plan-year');
    const btnAddYear = document.getElementById('btn-add-sowing-year');
    const newYearInp = document.getElementById('sowing-new-year');
    const btnClosePlan = document.getElementById('sowing-plan-close');

    this._refreshYearSelects();
    if (yearSel) {
      yearSel.value = String(this.viewYear);
      yearSel.addEventListener('change', () => this.setViewYear(Number(yearSel.value)));
    }

    btnPlan?.addEventListener('click', () => this.openPlanDialog());
    btnClosePlan?.addEventListener('click', () => dialog?.close());
    planYearSel?.addEventListener('change', () => this.renderPlanDialog());
    btnAddYear?.addEventListener('click', () => {
      const y = parseInt(newYearInp?.value, 10);
      if (y) this.addYear(y);
      else showToast('Введите год', 'error');
    });
  },

  _refreshYearSelects() {
    const years = this.getYearsList();
    const html = years
      .map((y) => `<option value="${y}">${y}</option>`)
      .join('');

    ['sowing-year', 'sowing-plan-year'].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      const cur = el.value;
      el.innerHTML = html;
      el.value = years.includes(Number(cur)) ? cur : String(this.viewYear);
    });

    const newYearInp = document.getElementById('sowing-new-year');
    if (newYearInp && !newYearInp.value) {
      newYearInp.value = String(this._currentCalendarYear() + 1);
    }
  },

  renderAll() {
    this.renderSummaryTable();
    this.renderFieldsTable();
    this.renderCropLayer();
  },

  /** Слой культур (посев) — отдельно от границ полей */
  renderCropLayer() {
    const coll = RubinLayers.getCollection('crops');
    if (!coll) return;
    coll.removeAll();

    const y = String(this.viewYear);
    RubinFields.features.forEach((feature) => {
      const cropId = this.getCropForField(feature.id, y);
      if (!cropId) return;
      const coords = geoJsonToYmapsCoords(feature.geometry);
      const fill = this.CROP_COLORS[cropId] || '#888888';
      const label = this.getCropLabel(cropId);
      const poly = new ymaps.Polygon(
        [coords],
        { hintContent: `${feature.properties.name}: ${label}`, balloonContent: label },
        {
          fillColor: fill,
          fillOpacity: 0.55,
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

    if (RubinLayers.isVisible('crops')) {
      RubinLayers._syncCollectionOnMap('crops');
    }
  },

  /** Итоговая таблица: сколько га по каждой культуре */
  renderSummaryTable() {
    const tbody = document.getElementById('crop-summary-body');
    const totalEl = document.getElementById('crop-summary-total');
    const yearLabel = document.getElementById('crop-summary-year');
    if (!tbody) return;

    const summary = this.computeSummary(this.viewYear);
    if (yearLabel) yearLabel.textContent = String(summary.year);

    const rows = [];

    this.CROP_LIST.forEach((c) => {
      const row = summary.byCrop[c.id];
      if (!row || row.ha <= 0) return;
      rows.push(
        `<tr>
          <td>${escapeHtml(c.label)}</td>
          <td class="num">${row.ha}</td>
          <td class="num muted">${row.count}</td>
        </tr>`
      );
    });

    const un = summary.byCrop._unassigned;
    if (un && un.ha > 0) {
      rows.push(
        `<tr class="row-unassigned">
          <td>${escapeHtml(un.label)}</td>
          <td class="num">${un.ha}</td>
          <td class="num muted">${un.count}</td>
        </tr>`
      );
    }

    tbody.innerHTML =
      rows.join('') || '<tr><td colspan="3">Нет данных по культурам</td></tr>';

    if (totalEl) {
      totalEl.textContent = `${summary.totalHa} га (${summary.fieldCount} полей)`;
    }
  },

  /** Таблица полей: название, га, культура, NDVI */
  renderFieldsTable() {
    const wrap = document.getElementById('fields-table-wrap');
    const tbody = document.getElementById('fields-table-body');
    if (!tbody) return;

    const rows = RubinFields.features
      .map((f) => {
        const p = f.properties;
        const crop = this.getCropLabel(p.crop);
        const soilJpg = p.soilMapLabel
          ? `<span title="${escapeHtml(p.soilMapLabel)}">${escapeHtml(p.soilMapLabel.slice(0, 12))}${p.soilMapLabel.length > 12 ? '…' : ''}</span>`
          : '—';
        const ndvi =
          p.ndvi != null
            ? `<span class="ndvi-val" style="color:${RubinStyling.getNdviColor(p.ndvi)}">${p.ndvi}</span>`
            : '—';
        const area = this.getFieldAreaHa(f);
        const areaStr = area != null ? area.toFixed(2) : '—';
        return `<tr data-field-id="${escapeAttr(f.id)}">
          <td>${escapeHtml(p.name || f.id)}</td>
          <td class="num">${areaStr}</td>
          <td class="crop-cell">${escapeHtml(crop)}</td>
          <td class="crop-cell">${soilJpg}</td>
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
  },

  openPlanDialog() {
    const dialog = document.getElementById('sowing-plan-dialog');
    const planYearSel = document.getElementById('sowing-plan-year');
    if (!dialog) return;
    if (planYearSel) planYearSel.value = String(this.viewYear);
    this.renderPlanDialog();
    dialog.showModal();
  },

  /** Раздел истории и плана: все поля × культура для выбранного года */
  renderPlanDialog() {
    const planYearSel = document.getElementById('sowing-plan-year');
    const tbody = document.getElementById('sowing-plan-body');
    const badge = document.getElementById('sowing-plan-badge');
    if (!tbody || !planYearSel) return;

    const year = Number(planYearSel.value);
    const cal = this._currentCalendarYear();
    let badgeText = 'текущий сезон';
    let badgeClass = 'badge--current';
    if (year < cal) {
      badgeText = 'история';
      badgeClass = 'badge--past';
    } else if (year > cal) {
      badgeText = 'план';
      badgeClass = 'badge--future';
    }
    if (badge) {
      badge.textContent = badgeText;
      badge.className = `sowing-badge ${badgeClass}`;
    }

    const rows = RubinFields.features
      .map((f) => {
        const cropId = this.getCropForField(f.id, year);
        const ha = this.getFieldAreaHa(f);
        return `<tr data-plan-field="${escapeAttr(f.id)}">
          <td>${escapeHtml(f.properties.name || f.id)}</td>
          <td class="num">${ha.toFixed(2)}</td>
          <td>
            <select class="plan-crop-select" data-field-id="${escapeAttr(f.id)}">
              ${this.buildCropOptions(cropId)}
            </select>
          </td>
        </tr>`;
      })
      .join('');

    tbody.innerHTML = rows || '<tr><td colspan="3">Нет полей</td></tr>';

    tbody.querySelectorAll('.plan-crop-select').forEach((sel) => {
      sel.addEventListener('change', () => {
        const fieldId = sel.getAttribute('data-field-id');
        this.setCropForField(fieldId, sel.value, year);
        if (year === this.viewYear) {
          this.applyYearToFields(this.viewYear);
        }
        this.renderPlanDialog();
        showToast('Культура сохранена', 'success');
      });
    });

    const summary = this.computeSummary(year);
    const foot = document.getElementById('sowing-plan-summary');
    if (foot) {
      const lines = this.CROP_LIST.filter((c) => summary.byCrop[c.id]?.ha > 0)
        .map((c) => `${c.label}: ${summary.byCrop[c.id].ha} га`)
        .join(' · ');
      foot.innerHTML = `
        <strong>Итого за ${year}:</strong> ${summary.totalHa} га
        ${lines ? `<br><span class="ndvi-muted">${lines}</span>` : ''}`;
    }
  },

  /** При удалении поля — убрать из всех годов */
  removeFieldFromAllPlans(fieldId) {
    Object.keys(this.plans).forEach((y) => {
      delete this.plans[y][fieldId];
    });
    this._savePlans();
    this.renderAll();
  },

  /** Заполнить select в форме атрибутов */
  fillAttrCropSelect(selectEl, cropId) {
    if (!selectEl) return;
    selectEl.innerHTML = this.buildCropOptions(cropId || '');
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
