# Автообновление NDVI раз в неделю (GitHub Actions → FTP)

Репозиторий: https://github.com/ivanlimurian-netizen/RubinFields

Сайт остаётся статическим (`kubokilina.ru/RubinFields/`). Раз в неделю GitHub сам:
1. считает NDVI через Google Earth Engine (`--days 7`);
2. заливает `data/ndvi_latest.json`, `data/ndvi_status.json` и `data/ndvi_mosaics/*.png` на хостинг по FTP.

Ручная догрузка файлов после настройки **не нужна**.

## Что уже в проекте

| Файл | Назначение |
|------|------------|
| `.github/workflows/ndvi-weekly.yml` | cron каждое воскресенье 03:00 UTC + ручной запуск |
| `scripts/calc_ndvi.py --days 7` | скользящие 7 дней + `data/ndvi_status.json` |
| `scripts/deploy_ndvi_ftp.py` | выгрузка JSON + PNG на FTP |

## Шаг 1. Запушить код в GitHub

На ПК (если Git установлен):

```bat
cd C:\Users\Ivan\Projects\rubin-gis
git init
git remote add origin https://github.com/ivanlimurian-netizen/RubinFields.git
git add .
git commit -m "NDVI weekly automation via GitHub Actions"
git branch -M main
git push -u origin main
```

**Не коммитьте** `credentials.json`, `rubin-gis-*.json`, `data/weather_config.json` — они в `.gitignore`.

## Шаг 2. Secrets в GitHub

Откройте:  
https://github.com/ivanlimurian-netizen/RubinFields/settings/secrets/actions  
→ **New repository secret**

| Secret | Что вписать |
|--------|-------------|
| `GEE_CREDENTIALS_JSON` | **Весь** текст файла `rubin-gis-1554cf5032e2.json` (одной строкой / целиком) |
| `FTP_HOST` | хост FTP из панели хостинга (часто `ftp.kubokilina.ru` или IP) |
| `FTP_USER` | логин FTP |
| `FTP_PASS` | пароль FTP |
| `FTP_REMOTE_DIR` | путь к сайту на сервере, например `/RubinFields` или `/public_html/RubinFields` |

Опционально:

| Secret | Значение |
|--------|----------|
| `FTP_TLS` | `true` если хостинг требует FTPS |
| `FTP_PORT` | `21` (по умолчанию) |

`FTP_REMOTE_DIR` должен указывать на ту папку, где лежит `index.html` сайта (родитель каталога `data/`).

## Шаг 3. Первый пробный запуск

1. https://github.com/ivanlimurian-netizen/RubinFields/actions  
2. Workflow **NDVI weekly** → **Run workflow**  
3. Для теста можно: `limit = 3`, `days = 7`  
4. Если зелёный — запустите ещё раз с `limit = 0` (все 179 полей, ~20–30 мин)

## Шаг 4. Проверка на сайте

После успешного Action:

- https://kubokilina.ru/RubinFields/data/ndvi_status.json — `ok: true`, свежий `updated_at`
- https://kubokilina.ru/RubinFields/data/ndvi_latest.json — период `"label": "7d"`
- В ГИС: **Ctrl+F5** → **Обновить NDVI** → слой **NDVI мозаика**

## Расписание

По умолчанию: **каждое воскресенье 03:00 UTC**.  
Можно менять в `.github/workflows/ndvi-weekly.yml` (строка `cron`).

## Если FTP не подходит

Напишите, какой доступ есть (SFTP, FileZilla-логин, панель ISPmanager) — подстроим `deploy_ndvi_ftp.py` или перейдём на SFTP.
