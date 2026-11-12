# Загрузка папки rubin-gis на хостинг

Сайт: **https://kubokilina.ru

## Что загружать

Залейте **содержимое** папки `rubin-gis` в каталог `RubinFields` на сервере (чтобы открывалось `.../RubinFields/index.html`).

### Обязательно

| Путь | Зачем |
|------|--------|
| `index.html` | Главная страница |
| `css/` | Стили |
| `js/` | Вся логика ГИС |
| `fields.geojson` | Контуры полей при первом открытии |
| `data/sample_fields.json` | Запасной пример |
| `data/soil_map_legend.json` | Легенда для JPG-карты |
| `data/ndvi_latest.json` | Средний NDVI по полям + индекс мозаик |
| `data/ndvi_mosaics/*.png` | Внутрипольные NDVI-мозаики (PNG) |

### Для кнопки «Загрузить MapInfo» (без Python на сервере)

Перед загрузкой **на своём ПК** выполните:

```bat
pip install -r requirements.txt
python scripts\export_mapinfo_geojson.py
```

Затем загрузите на хостинг:

- `data/mapinfo_polya.geojson`
- `data/mapinfo_pochvy.geojson`

Без этих двух файлов MapInfo на хостинге выдаст ошибку 404 — это нормально для статического сайта.

### По желанию

| Путь | Зачем |
|------|--------|
| `почвенная карта с легендой.jpg` | Распознавание почв с JPG |
| `.htaccess` | Тип MIME для .geojson (Apache) |

### Можно не загружать (экономия места)

- `Maps vector/` — только для экспорта GeoJSON на ПК
- `server.py`, `ndvi_compute.py`, `requirements*.txt` — локальная разработка
- `scripts/` — только для экспорта на ПК
- `README.md`, `HOSTING.md` — документация

## NDVI (Sentinel-2) — среднее + мозаика

На хостинге нет Python/GEE. Считаем на ПК, на сайт кладём готовые файлы.

**На своём ПК** (раз в месяц или по необходимости):

```bat
pip install -r requirements-gee.txt
python scripts\calc_ndvi.py
```

Появится:

- `data/ndvi_latest.json` — средний NDVI по каждому полю + bbox мозаик
- `data/ndvi_mosaics/{field_id}.png` — цветная растровая мозаика внутри поля (красный → зелёный)

Тест на нескольких полях: `python scripts\calc_ndvi.py --limit 5`  
Только среднее (без PNG): `python scripts\calc_ndvi.py --no-mosaic`

**На хостинг** залейте:

- `data/ndvi_latest.json`
- папку `data/ndvi_mosaics/` целиком
- обновлённые `js/gee.js`, `js/ndvi.js`, `js/layers.js`, `js/app.js`, `index.html`, `css/style.css`

В ГИС:

1. **Слои карты → NDVI мозаика** — зоны внутри полей (прозрачность ~60%)
2. **NDVI среднее** — однотонная заливка (обзор)
3. Клик по полю → среднее в инфопанели + кнопка **Показать мозаику NDVI**

Ключ GEE (`credentials.json`, `rubin-gis-*.json`) **на хостинг не загружать**.

## Автообновление раз в неделю (без ручной догрузки)

См. подробную инструкцию: [docs/NDVI_AUTO.md](docs/NDVI_AUTO.md)

Кратко: GitHub Actions в репозитории  
https://github.com/ivanlimurian-netizen/RubinFields  
каждое воскресенье считает `python scripts/calc_ndvi.py --days 7` и заливает `data/` на хостинг по FTP.

Нужно один раз прописать Secrets: `GEE_CREDENTIALS_JSON`, `FTP_HOST`, `FTP_USER`, `FTP_PASS`, `FTP_REMOTE_DIR`.

## Погода Сокол-М «РУБИН 1»

1. Скопируйте `data/weather_config.example.json` → `data/weather_config.json`
2. Укажите **email и пароль входа** на https://sokolmeteo.com/login  
   (это **не** пароль станции `2211`, и **не** User ID UUID)
3. IMEI уже: `861937065189277`
4. На хостинг залейте также папку `api/weather.php` (прокси, иначе браузер не сможет ходить на sokolmeteo из‑за CORS)

После этого в инфопанели поля появятся: t, HM, PR, WV, RN.  
Если Сокол недоступен — показывается Open-Meteo по координатам поля.

## Проверка после загрузки

1. https://kubokilina.ru/RubinFields/ — карта и поля
2. https://kubokilina.ru/RubinFields/fields.geojson — должен открыться JSON
3. https://kubokilina.ru/RubinFields/data/mapinfo_polya.geojson — после экспорта на ПК
4. В ГИС: **Загрузить MapInfo** → без ошибки 404
5. Панель **Слои карты** — включение NDVI, культур, почв
6. Клик по полю → погода Сокол-М (или Open-Meteo)

## Если сайт в другой подпапке

В `index.html` уже есть автоопределение пути. При проблемах укажите явно:

```html
<script>window.RUBIN_APP_BASE = '/RubinFields';</script>
```

(перед подключением `js/utils.js`)
