@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Экспорт MapInfo в GeoJSON для хостинга...
python scripts\export_mapinfo_geojson.py
if errorlevel 1 (
  echo.
  echo Ошибка. Установите Python и выполните:
  echo   pip install -r requirements.txt
  echo   python scripts\export_mapinfo_geojson.py
  pause
  exit /b 1
)
echo.
echo Готово. Загрузите на хостинг:
echo   data\mapinfo_polya.geojson
echo   data\mapinfo_pochvy.geojson
pause
