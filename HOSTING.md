# Размещение на https://kubokilina.ru

## Что загрузить на хостинг

Скопируйте **всю** папку проекта в `/RubinFields/` на сервере:

- `index.html`, `css/`, `js/`, `fields.geojson`
- `data/sample_fields.json`, `data/soil_map_legend.json`
- **`data/mapinfo_polya.geojson`** и **`data/mapinfo_pochvy.geojson`** (см. ниже)
- по желанию: `почвенная карта с легендой.jpg`

## MapInfo без Python на хостинге

На обычном хостинге **нет** Flask и `/api/mapinfo/…` — это нормально.

1. На своём ПК: `python scripts/export_mapinfo_geojson.py`
2. Загрузите на сайт файлы `data/mapinfo_polya.geojson` и `data/mapinfo_pochvy.geojson`
3. В ГИС нажмите **«Загрузить MapInfo»**

## Пути

Приложение само определяет базовый путь `/RubinFields` из URL браузера.
Все запросы идут как `https://kubokilina.ru/RubinFields/data/...`, а не в корень сайта.

При необходимости задайте вручную в `index.html` перед скриптами:

```html
<script>window.RUBIN_APP_BASE = '/RubinFields';</script>
```

## Слои карты

В боковой панели **«Слои карты»** (как TrueFields):

- **Границы полей** — всегда включены (контуры без заливки)
- NDVI, культуры, почва JPG, MapInfo почвы, TIF — отдельно, без наложения заливки на базу
