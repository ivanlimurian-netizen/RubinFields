Для хостинга https://kubokilina.ru/RubinFields/ (без Python на сервере)

Положите в эту папку два файла (создаются на своём ПК):

  mapinfo_polya.geojson   — из Поля_Рубин.TAB
  mapinfo_pochvy.geojson  — из Почвы_Рубин.TAB

Команда на компьютере с Python:

  cd путь\к\rubin-gis
  pip install -r requirements.txt
  python scripts/export_mapinfo_geojson.py

НЕ используйте export_final.bat со старым однострочным fiona —
он сохранял координаты в метрах (Web Mercator), из‑за этого на карте
«паутина» и площадь миллиарды гектаров. Правильный экспорт пересчитывает в WGS84.
В новых версиях ГИС пересчёт также делается в браузере автоматически.

Затем загрузите оба .geojson на хостинг в папку RubinFields/data/

После этого кнопка «Загрузить MapInfo» в ГИС будет работать без ошибки 404.
