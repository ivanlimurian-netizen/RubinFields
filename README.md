# Веб-ГИС полей ООО «Рубин»

Прототип веб-ГИС для управления сельхозполями (НСО, Краснозерский район, с. Половинное).

## Запуск

### Режим с MapInfo (рекомендуется)

Чтение `.TAB/.DAT/.MAP/.ID` из папки `Maps vector` выполняется через Flask + GDAL (fiona):

```bash
cd C:\Users\Ivan\Projects\rubin-gis
pip install -r requirements.txt
python server.py
```

Откройте **http://127.0.0.1:5000** → кнопка **«Загрузить MapInfo»**.

### Только статика (без MapInfo)

```bash
python -m http.server 8080
# или: npx serve .
```

Откройте `http://localhost:8080`. Для MapInfo без Flask сначала экспортируйте слои:

```bash
pip install -r requirements.txt
python scripts/export_mapinfo_geojson.py
```

Появятся `data/mapinfo_polya.geojson` и `data/mapinfo_pochvy.geojson` — их подхватит кнопка «Загрузить MapInfo».

> Не открывайте `index.html` через `file://` — `fetch` к JSON и API не сработает.

## Стек

- [Yandex Maps API 2.1](https://yandex.ru/dev/maps/jsapi/) — карта, полигоны, геокодер, GroundOverlay
- Vanilla JavaScript (ES6+)
- [shpjs](https://github.com/calvinmetcalf/shapefile-js) — импорт SHP (zip)
- [geotiff.js](https://geotiffjs.github.io/) — наложение GeoTIFF
- [Turf.js](https://turfjs.org/) — расчёт площади
- LocalStorage — сохранение полей и кэш погоды

## Функции

| Функция | Описание |
|--------|----------|
| Карта | Центр: с. Половинное; при старте — контуры из `fields.geojson` (~179 полей) |
| Закраска | Почва / гумус / рейтинг + легенда слева и снизу |
| CRUD | Рисование полигона, редактирование вершин, атрибуты, удаление |
| SHP | Загрузка `.zip` с shapefile (shp+dbf+shx) |
| MapInfo | `Поля_Рубин` / `Почвы_Рубин` из `Maps vector` (Flask API или GeoJSON) |
| TIF | GeoTIFF как полупрозрачный растр |
| Погода | Демо-данные; для API — ключ в `js/weather.js` |
| NDVI | Sentinel-2 через Google Earth Engine (или демо); закраска, таблица, инфопанель |
| Посевы | 8 культур + пар; план по годам, сводка в га, история и будущий план |
| Почва JPG | Распознавание типа почвы по цвету на `почвенная карта с легендой.jpg` |
| Экспорт | JSON всех полей |

## Исходные контуры полей

Файл **`fields.geojson`** в корне проекта загружается автоматически при первом открытии (через HTTP-сервер). Свойства из источника:

- `name` — название поля (например, R1-35)
- `sq` / `sq_acc` — площадь по данным и по учёту (га)
- `rating` — буквенный класс A–E (в приложении отображается как рейтинг 1–5)

Кнопка **«Перезагрузить fields.geojson»** сбрасывает локальные правки и снова подтягивает контуры с сервера.

> Большой набор полей не сохраняется в LocalStorage (лимит браузера); правки в сессии работают до перезагрузки страницы.

## MapInfo (Поля_Рубин / Почвы_Рубин)

В папке **`Maps vector`** должны лежать полные наборы файлов:

| Слой | Файлы |
|------|--------|
| Поля | `Поля_Рубин.TAB`, `.DAT`, `.MAP`, `.ID` |
| Почвы | `Почвы_Рубин.TAB`, `.DAT`, `.MAP`, `.ID` (`.IND` опционально) |

- **Поля** — красные контуры (`source: mapinfo`), атрибуты `Number`, `Area_ha` из `.DAT`
- **Почвы** — отдельный слой, вкл/выкл кнопкой «Почвы MapInfo», клик → тип почвы и гран. состав
- Данные полей попадают в `RubinFields` и **`window.fieldsData`**
- Закраска по почве/гумусу/рейтингу работает и для MapInfo

**Почему не в браузере:** готового лёгкого JS-парсера MapInfo Native нет; возможен только тяжёлый GDAL WASM (`geoimport` / `gdal3.js`). Для надёжности используется Python + fiona.

API: `GET /api/mapinfo/fields`, `GET /api/mapinfo/soils`, `GET /api/mapinfo` (статус файлов).

## NDVI (вегетационный индекс)

Реализован **гибрид**: демо-режим работает сразу; для реальных данных — **Google Earth Engine** на сервере.

1. Боковая панель → **«Обновить NDVI»** (период: последний месяц / год / выбор месяца).
2. Включите **«Показать NDVI на карте»** или режим закраски **NDVI** в шапке.
3. Значения сохраняются в `properties.ndvi` каждого поля и в `window.fieldsData`.
4. Таблица полей в сайдбаре — колонка NDVI; клик по строке выделяет поле.
5. В инфопанели: `NDVI = 0.XX — состояние: хорошее/среднее/…`

### Реальный GEE (Sentinel-2)

```bash
pip install -r requirements.txt
pip install -r requirements-gee.txt
earthengine authenticate
set GEE_PROJECT=ваш-google-cloud-project
python server.py
```

Проверка: `GET http://127.0.0.1:5000/api/ndvi`

Принудительно демо: `set RUBIN_NDVI_DEMO=1` перед запуском сервера.

### Модули

| Файл | Назначение |
|------|------------|
| `js/gee.js` | Запросы к `/api/ndvi`, локальный демо-фолбэк |
| `js/ndvi.js` | UI, кэш, таблица, перекраска |
| `ndvi_compute.py` | Расчёт NDVI (GEE или демо) |

## Почвенная карта (JPG)

1. Положите в корень проекта файл **`почвенная карта с легендой.jpg`** (или выберите через «Выбрать JPG…»).
2. **«Распознать почвенную карту»** → проверьте привязку углов (кнопка «Привязать по полям»).
3. **«Распознать почвы»** — для каждого векторного поля берётся доминирующий цвет внутри контура на JPG и сопоставляется с легендой (`data/soil_map_legend.json`).
4. На карте появляется **отдельный слой** закраски (вкл/выкл) и опционально **подложка** с JPG.
5. В свойствах поля: `soilMapLabel`, `soilMapColor`, `texture` (обновляется по легенде).

Клик по превью карты в диалоге — **пипетка** для добавления цвета в легенду.

## Посевы и культуры

Справочник: пшеница яровая, горох, кострец, рапс, лен, овёс, ячмень, **пар**.

- В **редакторе поля** — выбор культуры на выбранный сезон (год).
- В сайдбаре — **сводная таблица** (га и число полей по каждой культуре + итого).
- **«История и план посевов»** — все поля по годам (прошлое / текущий / будущий план).
- Данные в `localStorage` (`rubin_gis_sowing_plans`) и в `properties.crop` полей.

## Загрузка ваших данных

- **SHP:** упакуйте `fields.shp`, `fields.dbf`, `fields.shx` (и при необходимости `.prj`) в `fields.zip` → «Загрузить SHP».
- **TIF:** `soil.tif` с геопривязкой → «Загрузить TIF».

Атрибуты из DBF маппятся на `name`, `texture`, `humus`, `rating` (см. `js/fileLoader.js`).

## API-ключи

- Яндекс.Карты: указан в `index.html` (из ТЗ).
- OpenWeatherMap (опционально): задайте `RubinWeather.OPENWEATHER_API_KEY` в `js/weather.js`.

## Структура

```
rubin-gis/
├── index.html
├── css/style.css
├── Maps vector/          ← MapInfo TAB/DAT/MAP/ID
├── server.py
├── requirements.txt
├── scripts/export_mapinfo_geojson.py
├── js/
│   ├── map.js
│   ├── mapinfoLayers.js
│   ├── gee.js
│   ├── ndvi.js
│   ├── fields.js
│   ├── styling.js
│   ├── fileLoader.js
│   ├── weather.js
│   ├── utils.js
│   └── app.js
├── fields.geojson
├── data/sample_fields.json
│   ├── mapinfo_polya.geojson   (после export_mapinfo_geojson.py)
│   └── mapinfo_pochvy.geojson
└── README.md
```

## Самопроверка (из ТЗ)

- [x] Нарисовать полигон и задать гумус/рейтинг
- [x] Цвет меняется при переключении закраски по гумусу
- [x] Загрузка SHP (zip) отображает поля
- [x] Попап показывает погоду (демо или OpenWeather)
