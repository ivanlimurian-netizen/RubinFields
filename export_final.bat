@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo ВНИМАНИЕ: старый способ (fiona без пересчёта CRS) ломал карту.
echo Используйте правильный экспорт:
echo.
python scripts\export_mapinfo_geojson.py
if errorlevel 1 (
  echo.
  echo Если Python/fiona недоступны — на сайте координаты исправятся
  echo автоматически в браузере (обновите index.html и js/utils.js).
  echo Перезалейте папку rubin-gis на хостинг.
  pause
  exit /b 1
)
echo.
echo Готово: data\mapinfo_polya.geojson и data\mapinfo_pochvy.geojson в WGS84
pause
