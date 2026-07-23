/**

 * Погода на полях:

 * 1) Сокол-М «РУБИН 1» через прокси /api/weather (sokolmeteo.com)

 * 2) запасной вариант — Open-Meteo по координатам поля (без ключа)

 */

const RubinWeather = {

  CACHE_KEY: 'rubin_gis_weather_cache_v3',

  CACHE_TTL_MS: 20 * 60 * 1000, // чаще 30 мин шлёт станция — кэш 20 мин

  STALE_MS: 90 * 60 * 1000,



  async getForField(field, forceRefresh = false) {

    const cacheKey = 'sokol-rubin-1';



    if (!forceRefresh) {

      const cached = this._readCache(cacheKey);

      if (cached) return cached;

    }



    // 1) Сокол-М через наш прокси (Flask или PHP)

    try {

      const sokol = await this._fetchSokol(forceRefresh);

      this._writeCache(cacheKey, sokol);

      return sokol;

    } catch (e) {

      console.warn('Sokol weather unavailable', e);

    }



    // 2) Open-Meteo по центроиду поля — актуальная погода местности

    try {

      const [lon, lat] = centroidOfPolygon(field.geometry);

      const om = await this._fetchOpenMeteo(lat, lon);

      this._writeCache(`om:${lat.toFixed(3)},${lon.toFixed(3)}`, om);

      return om;

    } catch (e) {

      console.warn('Open-Meteo error', e);

    }



    // 3) последнее известное значение Сокол (даже просроченное)

    const stale = this._readCache(cacheKey, true);

    if (stale) {

      return { ...stale, isStale: true, description: 'последние сохранённые данные Сокол-М' };

    }



    throw new Error('Погода недоступна');

  },



  async _fetchSokol(forceRefresh = false) {

    const urls = [

      appUrl(`api/weather.php${forceRefresh ? '?force=1' : ''}`),

      appUrl(`api/weather${forceRefresh ? '?force=1' : ''}`),

    ];

    if (isLocalApiHost()) {

      urls.push(`http://127.0.0.1:5000/api/weather${forceRefresh ? '?force=1' : ''}`);

    }



    let lastErr = null;

    for (const url of urls) {

      try {

        const res = await fetch(url, { cache: 'no-store' });

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {

          lastErr = new Error(data.error || `HTTP ${res.status}`);

          continue;

        }

        if (data.error) {

          lastErr = new Error(data.error);

          continue;

        }

        return {

          source: 'sokol',

          stationName: data.stationName || 'РУБИН 1',

          imei: data.imei || '',

          temp: data.temp,

          humidity: data.humidity,

          pressure: data.pressure,

          wind: data.wind,

          precipitation: data.precipitation ?? 0,

          description: data.description || 'данные метеостанции Сокол-М',

          isDemo: false,

          isStale: !!data.isStale,

          updatedAt: data.updatedAt || Date.now(),

          ageMinutes: data.ageMinutes,

          lastDataReceivedDt: data.lastDataReceivedDt,

        };

      } catch (e) {

        lastErr = e;

      }

    }

    throw lastErr || new Error('Сокол-М недоступен');

  },



  async _fetchOpenMeteo(lat, lon) {

    const url =

      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +

      `&current=temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,surface_pressure` +

      `&timezone=auto&wind_speed_unit=ms`;

    const res = await fetch(url);

    if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);

    const j = await res.json();

    const c = j.current || {};

    return {

      source: 'open-meteo',

      stationName: 'Open-Meteo (координаты поля)',

      temp: c.temperature_2m != null ? Math.round(c.temperature_2m * 10) / 10 : null,

      humidity: c.relative_humidity_2m != null ? Math.round(c.relative_humidity_2m) : null,

      pressure: c.surface_pressure != null ? Math.round(c.surface_pressure * 10) / 10 : null,

      wind: c.wind_speed_10m != null ? Math.round(c.wind_speed_10m * 10) / 10 : null,

      precipitation: c.precipitation != null ? Math.round(c.precipitation * 100) / 100 : 0,

      description: this._weatherCodeRu(c.weather_code),

      isDemo: false,

      isStale: false,

      updatedAt: Date.now(),

    };

  },



  _weatherCodeRu(code) {

    const map = {

      0: 'ясно',

      1: 'преимущественно ясно',

      2: 'переменная облачность',

      3: 'пасмурно',

      45: 'туман',

      48: 'изморозь',

      51: 'морось',

      61: 'небольшой дождь',

      63: 'дождь',

      65: 'сильный дождь',

      71: 'снег',

      80: 'ливень',

      95: 'гроза',

    };

    return map[code] || 'погода по координатам поля';

  },



  _readCache(key, allowExpired = false) {

    try {

      const all = JSON.parse(localStorage.getItem(this.CACHE_KEY) || '{}');

      const entry = all[key];

      if (!entry) return null;

      const age = Date.now() - (entry.updatedAt || 0);

      if (!allowExpired && age > this.CACHE_TTL_MS) return null;

      return entry;

    } catch {

      return null;

    }

  },



  _writeCache(key, data) {

    try {

      const all = JSON.parse(localStorage.getItem(this.CACHE_KEY) || '{}');

      all[key] = data;

      localStorage.setItem(this.CACHE_KEY, JSON.stringify(all));

    } catch (_) {}

  },



  _fmt(v, unit = '', digits = 1) {

    if (v == null || Number.isNaN(Number(v))) return '—';

    const n = Number(v);

    const s = Number.isInteger(digits) ? n.toFixed(digits) : String(n);

    return `${s}${unit}`;

  },



  renderHtml(weather) {

    const updated = new Date(weather.updatedAt).toLocaleString('ru-RU');

    const sourceLabel =

      weather.source === 'sokol'

        ? `Сокол-М · ${weather.stationName || 'РУБИН 1'}`

        : weather.source === 'open-meteo'

          ? 'Open-Meteo (поле)'

          : 'Погода';



    let note = '';

    if (weather.source === 'sokol' && weather.isStale) {

      note = `<p class="weather-demo-note">Станция давно не выходила на связь (слабый GSM / батарея). Показано последнее обновление: ${updated}${

        weather.ageMinutes != null ? ` (${weather.ageMinutes} мин назад)` : ''

      }.</p>`;

    } else if (weather.source === 'open-meteo') {

      note =

        '<p class="weather-demo-note">Сокол-М временно недоступен — показана погода Open-Meteo по координатам поля. Для Сокол укажите email/пароль аккаунта в data/weather_config.json.</p>';

    }



    return `

      <div class="weather-block">

        <h3>${sourceLabel}</h3>

        <div class="weather-grid weather-grid--5">

          <div><span>Темп.</span><strong>${this._fmt(weather.temp, ' °C', 1)}</strong></div>

          <div><span>Влажн.</span><strong>${this._fmt(weather.humidity, ' %', 0)}</strong></div>

          <div><span>Давлен.</span><strong>${this._fmt(weather.pressure, ' гПа', 1)}</strong></div>

          <div><span>Ветер</span><strong>${this._fmt(weather.wind, ' м/с', 1)}</strong></div>

          <div><span>Осадки</span><strong>${this._fmt(weather.precipitation, ' мм', 2)}</strong></div>

        </div>

        <p style="margin:8px 0 0;font-size:0.85rem">${weather.description || ''}</p>

        <p style="margin:4px 0 0;font-size:0.75rem;color:var(--muted)">Обновлено: ${updated}</p>

        ${note}

      </div>`;

  },

};


