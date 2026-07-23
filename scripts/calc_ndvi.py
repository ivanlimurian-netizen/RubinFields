#!/usr/bin/env python3
"""
Расчёт NDVI по полям ООО «Рубин» через Google Earth Engine.

1) Средний NDVI по полю → data/ndvi_latest.json
2) Внутрипольная мозаика (цветной PNG + bbox) → data/ndvi_mosaics/{field_id}.png

Источник: Sentinel-2 SR (COPERNICUS/S2_SR_HARMONIZED), B8 (NIR), B4 (RED).
Маска облаков: QA60 (биты 10 — opaque clouds, 11 — cirrus).
Формула: NDVI = (B8 - B4) / (B8 + B4)

Запуск из корня проекта:
  pip install -r requirements-gee.txt
  python scripts/calc_ndvi.py
  python scripts/calc_ndvi.py --days 7           # скользящие 7 дней (еженедельно)
  python scripts/calc_ndvi.py --limit 5          # тест на 5 полях
  python scripts/calc_ndvi.py --no-mosaic        # только среднее

Ключ сервисного аккаунта: credentials.json в корне (или rubin-gis-*.json).
"""
from __future__ import annotations

import argparse
import json
import logging
import math
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CREDENTIALS = [
    ROOT / "credentials.json",
    ROOT / "rubin-gis-1554cf5032e2.json",
]
FIELDS_CANDIDATES = [
    ROOT / "data" / "fields.geojson",
    ROOT / "fields.geojson",
]
OUT_PATH = ROOT / "data" / "ndvi_latest.json"
STATUS_PATH = ROOT / "data" / "ndvi_status.json"
MOSAIC_DIR = ROOT / "data" / "ndvi_mosaics"
MOSAIC_REL_DIR = "data/ndvi_mosaics"
PROJECT_ID = "rubin-gis"
SOURCE_LABEL = "Sentinel-2 / Google Earth Engine"
COLLECTION_ID = "COPERNICUS/S2_SR_HARMONIZED"
SCALE_M = 10  # среднее по полю
MOSAIC_MAX_DIM = 384  # длинная сторона PNG (баланс качество / размер)
MOSAIC_VIS_MIN = 0.0
MOSAIC_VIS_MAX = 0.8
# Красный → зелёный (как в js/styling.js)
MOSAIC_PALETTE = ["b71c1c", "e53935", "ff9800", "fdd835", "9ccc65", "2e7d32"]
BBOX_PAD_DEG = 0.00012  # ~10–13 м, чтобы PNG совпал с GroundOverlay

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("calc_ndvi")


def find_credentials_path() -> Path:
    env = __import__("os").environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    if env:
        p = Path(env)
        if p.is_file():
            return p
        log.warning("GOOGLE_APPLICATION_CREDENTIALS задан, но файл не найден: %s", env)

    for p in DEFAULT_CREDENTIALS:
        if p.is_file():
            return p

    raise FileNotFoundError(
        "Не найден ключ сервисного аккаунта. Положите credentials.json в корень проекта "
        "или задайте GOOGLE_APPLICATION_CREDENTIALS."
    )


def find_fields_path() -> Path:
    for p in FIELDS_CANDIDATES:
        if p.is_file():
            return p
    raise FileNotFoundError(
        "Не найден GeoJSON полей: data/fields.geojson или fields.geojson"
    )


def last_month_range(today: date | None = None) -> tuple[str, str, str]:
    """Последний полный календарный месяц → start, end (inclusive), label YYYY-MM."""
    today = today or date.today()
    first_this = today.replace(day=1)
    end = first_this - timedelta(days=1)
    start = end.replace(day=1)
    label = f"{start.year}-{start.month:02d}"
    return start.isoformat(), end.isoformat(), label


def rolling_days_range(days: int, today: date | None = None) -> tuple[str, str, str]:
    """Скользящее окно: последние N дней включительно → start, end, label."""
    if days < 1:
        raise ValueError("--days должен быть >= 1")
    today = today or date.today()
    end = today
    start = today - timedelta(days=days - 1)
    label = f"{days}d"
    return start.isoformat(), end.isoformat(), label


def load_fields(path: Path) -> list[dict]:
    log.info("Загрузка полей: %s", path)
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    features = data.get("features") or []
    if not features:
        raise ValueError(f"В {path} нет features")
    log.info("Полигонов: %d", len(features))
    return features


def field_id(feature: dict, index: int) -> str:
    props = feature.get("properties") or {}
    raw = feature.get("id") if feature.get("id") is not None else props.get("pk") or props.get("id")
    if raw is not None and raw != "":
        return str(raw)
    return f"field-{index}"


def _iter_coords(geom: dict):
    gtype = geom.get("type")
    coords = geom.get("coordinates") or []
    if gtype == "Polygon":
        for ring in coords:
            for pt in ring:
                yield pt
    elif gtype == "MultiPolygon":
        for poly in coords:
            for ring in poly:
                for pt in ring:
                    yield pt


def bbox_from_geojson(geom: dict, pad: float = BBOX_PAD_DEG) -> dict | None:
    pts = list(_iter_coords(geom))
    if not pts:
        return None
    lons = [float(p[0]) for p in pts]
    lats = [float(p[1]) for p in pts]
    return {
        "west": round(min(lons) - pad, 6),
        "south": round(min(lats) - pad, 6),
        "east": round(max(lons) + pad, 6),
        "north": round(max(lats) + pad, 6),
    }


def geojson_to_ee_geometry(geom: dict):
    import ee

    gtype = geom.get("type")
    coords = geom.get("coordinates")
    if not coords:
        return None
    if gtype == "Polygon":
        return ee.Geometry.Polygon(coords)
    if gtype == "MultiPolygon":
        return ee.Geometry.MultiPolygon(coords)
    log.warning("Неподдерживаемая геометрия: %s", gtype)
    return None


def init_earth_engine(credentials_path: Path) -> None:
    import ee

    with open(credentials_path, encoding="utf-8") as fh:
        key_data = json.load(fh)

    email = key_data.get("client_email")
    project = key_data.get("project_id") or PROJECT_ID
    if not email:
        raise ValueError("В JSON ключа нет client_email")

    log.info("Инициализация GEE: project=%s, account=%s", project, email)
    credentials = ee.ServiceAccountCredentials(email, str(credentials_path))
    ee.Initialize(credentials, project=project)


def build_ndvi_composite(start_date: str, end_date: str):
    """
    Композит NDVI за период: медиана по сценам после маски QA60.
    filterDate: end_date exclusive → +1 день.
    """
    import ee

    end_exclusive = (datetime.fromisoformat(end_date) + timedelta(days=1)).strftime("%Y-%m-%d")
    log.info("Период Sentinel-2: %s … %s", start_date, end_date)

    collection = (
        ee.ImageCollection(COLLECTION_ID)
        .filterDate(start_date, end_exclusive)
        .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 60))
    )

    def mask_qa60(img):
        qa = img.select("QA60")
        cloud_bit = 1 << 10  # opaque clouds
        cirrus_bit = 1 << 11
        clear = (
            qa.bitwiseAnd(cloud_bit)
            .eq(0)
            .And(qa.bitwiseAnd(cirrus_bit).eq(0))
        )
        return img.updateMask(clear)

    def add_ndvi(img):
        # NDVI = (B8 - B4) / (B8 + B4)
        return img.addBands(img.normalizedDifference(["B8", "B4"]).rename("NDVI"))

    count = collection.size().getInfo()
    log.info("Сцен Sentinel-2 в периоде (до маски): %s", count)

    composite = collection.map(mask_qa60).map(add_ndvi).select("NDVI").median()
    return composite


def mean_ndvi_for_geometry(composite, ee_geometry) -> float | None:
    import ee

    stats = composite.reduceRegion(
        reducer=ee.Reducer.mean(),
        geometry=ee_geometry,
        scale=SCALE_M,
        maxPixels=int(1e13),
        bestEffort=True,
    )
    val = stats.get("NDVI")
    if val is None:
        return None
    ndvi = val.getInfo()
    if ndvi is None:
        return None
    return round(float(ndvi), 4)


def _hex_to_rgb(hex_color: str) -> tuple[int, int, int]:
    h = hex_color.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def ndvi_to_rgba(value: float | None) -> tuple[int, int, int, int]:
    """Цвет пикселя NDVI (красный → зелёный), маска → прозрачный."""
    if value is None or value <= -9000:
        return (0, 0, 0, 0)
    t = (float(value) - MOSAIC_VIS_MIN) / (MOSAIC_VIS_MAX - MOSAIC_VIS_MIN)
    t = max(0.0, min(1.0, t))
    colors = [_hex_to_rgb(c) for c in MOSAIC_PALETTE]
    if len(colors) == 1:
        r, g, b = colors[0]
        return (r, g, b, 255)
    pos = t * (len(colors) - 1)
    i = min(int(pos), len(colors) - 2)
    frac = pos - i
    r = int(colors[i][0] + (colors[i + 1][0] - colors[i][0]) * frac)
    g = int(colors[i][1] + (colors[i + 1][1] - colors[i][1]) * frac)
    b = int(colors[i][2] + (colors[i + 1][2] - colors[i][2]) * frac)
    return (r, g, b, 255)


def export_field_mosaic(composite, ee_geom, geom: dict, fid: str) -> dict | None:
    """
    Цветной PNG NDVI через sampleRectangle + Pillow
    (без getThumbURL — не требует earthengine.thumbnails.create).
    Снаружи полигона — прозрачность (unmask / defaultValue).
    """
    import ee
    from PIL import Image

    bbox = bbox_from_geojson(geom)
    if not bbox:
        return None

    MOSAIC_DIR.mkdir(parents=True, exist_ok=True)
    out_name = f"{fid}.png"
    out_path = MOSAIC_DIR / out_name
    rel_path = f"{MOSAIC_REL_DIR}/{out_name}"

    mid_lat = (bbox["north"] + bbox["south"]) / 2.0
    width_m = (bbox["east"] - bbox["west"]) * 111320.0 * math.cos(math.radians(mid_lat))
    height_m = (bbox["north"] - bbox["south"]) * 111320.0
    scale_m = max(12.0, max(width_m, height_m) / float(MOSAIC_MAX_DIM))

    region = ee.Geometry.Rectangle(
        [bbox["west"], bbox["south"], bbox["east"], bbox["north"]],
        proj="EPSG:4326",
        geodesic=False,
    )
    # clip → вне поля masked; unmask(-9999) → прозрачные пиксели в PNG
    band = (
        composite.select("NDVI")
        .clip(ee_geom)
        .unmask(-9999)
        .reproject(crs="EPSG:3857", scale=scale_m)
    )
    sampled = band.sampleRectangle(region=region, defaultValue=-9999)
    rows = sampled.get("NDVI").getInfo()
    if not rows or not rows[0]:
        return None

    height = len(rows)
    width = len(rows[0])
    img = Image.new("RGBA", (width, height))
    pixels = img.load()
    for y, row in enumerate(rows):
        for x, val in enumerate(row):
            try:
                v = float(val) if val is not None else -9999.0
            except (TypeError, ValueError):
                v = -9999.0
            pixels[x, y] = ndvi_to_rgba(v)

    img.save(out_path, optimize=True)
    size_kb = round(out_path.stat().st_size / 1024, 1)
    return {
        "url": rel_path,
        "bbox": bbox,
        "size_kb": size_kb,
        "scale_m": round(scale_m, 1),
        "pixels": [width, height],
    }


def compute_all(
    features: list[dict],
    composite,
    *,
    export_mosaic: bool = True,
) -> list[dict]:
    calc_date = date.today().isoformat()
    results: list[dict] = []
    errors = 0
    mosaic_ok = 0

    if export_mosaic:
        MOSAIC_DIR.mkdir(parents=True, exist_ok=True)
        log.info(
            "Мозаики → %s (max dim=%d, palette red→green)",
            MOSAIC_DIR,
            MOSAIC_MAX_DIM,
        )

    for i, feat in enumerate(features):
        fid = field_id(feat, i)
        geom = feat.get("geometry")
        if not geom:
            log.warning("[%d/%d] %s — нет geometry", i + 1, len(features), fid)
            results.append(
                {
                    "field_id": fid,
                    "ndvi": None,
                    "date": calc_date,
                    "source": SOURCE_LABEL,
                    "error": "no_geometry",
                }
            )
            errors += 1
            continue

        ee_geom = geojson_to_ee_geometry(geom)
        if ee_geom is None:
            results.append(
                {
                    "field_id": fid,
                    "ndvi": None,
                    "date": calc_date,
                    "source": SOURCE_LABEL,
                    "error": "invalid_geometry",
                }
            )
            errors += 1
            continue

        row: dict = {
            "field_id": fid,
            "ndvi": None,
            "date": calc_date,
            "source": SOURCE_LABEL,
        }

        try:
            row["ndvi"] = mean_ndvi_for_geometry(composite, ee_geom)
        except Exception as exc:
            log.error("[%d/%d] %s — среднее: %s", i + 1, len(features), fid, exc)
            row["error"] = str(exc)
            errors += 1

        if export_mosaic and row.get("ndvi") is not None:
            try:
                mosaic = export_field_mosaic(composite, ee_geom, geom, fid)
                if mosaic:
                    row["mosaic"] = mosaic["url"]
                    row["bbox"] = mosaic["bbox"]
                    mosaic_ok += 1
            except Exception as exc:
                log.warning("[%d/%d] %s — мозаика: %s", i + 1, len(features), fid, exc)
                row["mosaic_error"] = str(exc)

        results.append(row)
        if (i + 1) % 20 == 0 or i == 0 or i == len(features) - 1:
            log.info(
                "[%d/%d] %s → NDVI %s%s",
                i + 1,
                len(features),
                fid,
                row["ndvi"] if row["ndvi"] is not None else "—",
                f", mosaic {row['mosaic']}" if row.get("mosaic") else "",
            )

    ok = sum(1 for r in results if r.get("ndvi") is not None)
    log.info(
        "Готово: %d/%d полей с NDVI, мозаик: %d, ошибок/пусто: %d",
        ok,
        len(features),
        mosaic_ok,
        errors,
    )
    return results


def save_results(
    records: list[dict],
    period_label: str,
    start_date: str,
    end_date: str,
    *,
    mosaics: bool,
) -> None:
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    mosaic_count = sum(1 for r in records if r.get("mosaic"))
    ok_count = sum(1 for r in records if r.get("ndvi") is not None)
    generated_at = datetime.now().isoformat(timespec="seconds")
    payload = {
        "generated_at": generated_at,
        "period": {
            "label": period_label,
            "start": start_date,
            "end": end_date,
        },
        "collection": COLLECTION_ID,
        "cloud_mask": "QA60 bits 10,11",
        "formula": "(B8 - B4) / (B8 + B4)",
        "project": PROJECT_ID,
        "count": len(records),
        "mosaic": {
            "enabled": mosaics,
            "dir": MOSAIC_REL_DIR,
            "count": mosaic_count,
            "max_dim": MOSAIC_MAX_DIM,
            "vis_min": MOSAIC_VIS_MIN,
            "vis_max": MOSAIC_VIS_MAX,
            "palette": MOSAIC_PALETTE,
            "opacity_hint": 0.6,
        },
        "fields": records,
    }
    with open(OUT_PATH, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)
    log.info("Сохранено: %s (мозаик в индексе: %d)", OUT_PATH, mosaic_count)

    status = {
        "ok": ok_count > 0,
        "updated_at": generated_at,
        "period": {
            "label": period_label,
            "start": start_date,
            "end": end_date,
        },
        "fields_total": len(records),
        "fields_with_ndvi": ok_count,
        "mosaics": mosaic_count,
        "collection": COLLECTION_ID,
        "project": PROJECT_ID,
    }
    with open(STATUS_PATH, "w", encoding="utf-8") as fh:
        json.dump(status, fh, ensure_ascii=False, indent=2)
    log.info("Статус: %s", STATUS_PATH)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="NDVI среднее + мозаики полей (GEE)")
    p.add_argument(
        "--days",
        type=int,
        default=0,
        help="Скользящее окно N дней (например 7). Без флага — последний полный месяц.",
    )
    p.add_argument("--limit", type=int, default=0, help="Обработать только N первых полей (тест)")
    p.add_argument("--no-mosaic", action="store_true", help="Не экспортировать PNG-мозаики")
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        creds = find_credentials_path()
        fields_path = find_fields_path()
        features = load_fields(fields_path)
        if args.limit and args.limit > 0:
            features = features[: args.limit]
            log.info("Режим --limit: %d полей", len(features))

        if args.days and args.days > 0:
            start, end, label = rolling_days_range(args.days)
            log.info("Период: скользящие %d дн. (%s … %s)", args.days, start, end)
        else:
            start, end, label = last_month_range()
            log.info("Период: последний полный месяц (%s)", label)

        export_mosaic = not args.no_mosaic

        init_earth_engine(creds)
        composite = build_ndvi_composite(start, end)
        records = compute_all(features, composite, export_mosaic=export_mosaic)
        save_results(records, label, start, end, mosaics=export_mosaic)
        return 0
    except FileNotFoundError as exc:
        log.error("%s", exc)
        return 2
    except Exception as exc:
        log.exception("Сбой расчёта NDVI: %s", exc)
        return 1


if __name__ == "__main__":
    sys.exit(main())
