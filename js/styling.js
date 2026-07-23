/**
 * Закраска полей и легенды по режиму: texture / humus / rating
 */
const RubinStyling = {
  MODES: {
    texture: {
      title: 'Гранулометрический состав',
      items: [
        { key: 'sandy', label: 'Песчаный', color: '#e8d4a8' },
        { key: 'loamy', label: 'Супесчаный', color: '#c9a86c' },
        { key: 'clay_loam', label: 'Суглинок', color: '#8b6914' },
        { key: 'clay', label: 'Глина', color: '#5c4033' }
      ]
    },
    humus: {
      title: 'Запас гумуса',
      items: [
        { key: 'low', label: 'Низкий (<2%)', color: '#c44d4d' },
        { key: 'medium', label: 'Средний (2–4%)', color: '#d4a017' },
        { key: 'high', label: 'Высокий (>4%)', color: '#3d8f5a' }
      ]
    },
    rating: {
      title: 'Рейтинг полей',
      items: [
        { key: '1', label: '1 ★ (класс E)', color: '#6b7280' },
        { key: '2', label: '2 ★★ (класс D)', color: '#9ca3af' },
        { key: '3', label: '3 ★★★ (класс C)', color: '#60a5fa' },
        { key: '4', label: '4 ★★★★ (класс B)', color: '#34d399' },
        { key: '5', label: '5 ★★★★★ (класс A)', color: '#059669' }
      ]
    },
    ndvi: {
      title: 'NDVI (вегетация)',
      items: [
        { key: 'bad', label: '< 0.2 — плохое', color: '#b71c1c' },
        { key: 'weak', label: '0.2–0.35 — слабое', color: '#e53935' },
        { key: 'mid', label: '0.35–0.55 — среднее', color: '#fdd835' },
        { key: 'good', label: '> 0.55 — хорошее', color: '#2e7d32' }
      ]
    }
  },

  /** Цвет заливки по значению NDVI (красный → зелёный) */
  getNdviColor(ndvi) {
    const v = Number(ndvi);
    if (Number.isNaN(v)) return '#7a8a9a';
    if (v < 0.2) return '#b71c1c';
    if (v < 0.35) return '#e53935';
    if (v < 0.45) return '#ff9800';
    if (v < 0.55) return '#fdd835';
    if (v < 0.65) return '#9ccc65';
    return '#2e7d32';
  },

  getColor(properties, mode) {
    if (mode === 'ndvi') {
      return this.getNdviColor(properties.ndvi);
    }

    const cfg = this.MODES[mode] || this.MODES.texture;
    let key;
    if (mode === 'rating') {
      key = String(properties.rating ?? 3);
    } else if (mode === 'humus') {
      key = properties.humus || 'medium';
    } else {
      key = properties.texture || 'loamy';
    }
    const item = cfg.items.find((i) => i.key === key);
    return item ? item.color : '#7a8a9a';
  },

  getPolygonOptions(properties, mode, selected = false) {
    const fill = this.getColor(properties, mode);

    if (mode === 'ndvi') {
      const stroke = properties.source === 'mapinfo' ? '#e53935' : '#1b5e20';
      return {
        fillColor: fill,
        fillOpacity: selected ? 0.75 : 0.62,
        strokeColor: selected ? '#ffffff' : stroke,
        strokeWidth: selected ? 3 : 2,
        strokeOpacity: 0.95
      };
    }

    if (properties.source === 'mapinfo') {
      return {
        fillColor: fill,
        fillOpacity: selected ? 0.35 : 0.18,
        strokeColor: selected ? '#ff8a80' : '#e53935',
        strokeWidth: selected ? 4 : 2.5,
        strokeOpacity: 1
      };
    }

    return {
      fillColor: fill,
      fillOpacity: selected ? 0.65 : 0.5,
      strokeColor: selected ? '#ffffff' : '#2d3a4f',
      strokeWidth: selected ? 3 : 2,
      strokeOpacity: 0.9
    };
  },

  /** Слой почвенных разностей MapInfo — полупрозрачная заливка */
  getSoilLayerOptions(properties, mode) {
    const fill = this.getColor(properties, mode);
    return {
      fillColor: fill,
      fillOpacity: 0.42,
      strokeColor: '#6d5a45',
      strokeWidth: 1,
      strokeOpacity: 0.65
    };
  },

  renderLegend(mode) {
    const cfg = this.MODES[mode] || this.MODES.texture;
    const html = cfg.items
      .map(
        (item) =>
          `<div class="legend-item"><span class="legend-swatch" style="background:${item.color}"></span><span>${item.label}</span></div>`
      )
      .join('');

    const sidebar = document.getElementById('legend-content');
    const bottom = document.getElementById('bottom-legend');
    if (sidebar) sidebar.innerHTML = html;
    if (bottom) {
      bottom.innerHTML = `<strong>${cfg.title}:</strong>${html}`;
    }
  }
};
