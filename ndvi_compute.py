"""
Расчёт среднего NDVI по полигонам полей (Sentinel-2 через Google Earth Engine).
При отсутствии GEE — детерминированные демо-значения для отладки UI.
"""
from __future__ import annotations

import hashlib
import os
import random
from calendar import monthrange
from datetime import date, datetime, timedelta
from typing import Any


def parse_period(period: str, custom_month: str | None = None) -> tuple[str, str, str]:
    """
    Возвращает (start_iso, end_iso, label) для запроса.
    period: last_month | last_year | custom
    custom_month: YYYY-MM
    """
    today = date.today()

    if period == "last_year":
        end = today
        start = today - timedelta(days=365)
        label = f"год до {end.isoformat()}"
        return start.isoformat(), end.isoformat(), label

    if period == "custom" and custom_month:
        try:
            y, m = map(int, custom_month.split("-")[:2])
            last_day = monthrange(y, m)[1]
            start = date(y, m, 1)
            end = date(y, m, last_day)
            label = f"{y}-{m:02d}"
            return start.isoformat(), end.isoformat(), label
        except (ValueError, TypeError):
            pass

    # last_month — последний полный календарный месяц
    first_this = today.replace(day=1)
    end = first_this - timedelta(days=1)
    start = end.replace(day=1)
    label = f"{start.year}-{start.month:02d}"
    return start.isoformat(), end.isoformat(), label


def ndvi_status(ndvi: float | None) -> str:
    if ndvi is None:
        return "нет данных"
    if ndvi < 0.2:
        return "плохое"
    if ndvi < 0.35:
        return "слабое"
    if ndvi < 0.55:
        return "среднее"
    return "хорошее"


def demo_ndvi(feature_id: str, seed: str) -> float:
    """Стабильный псевдо-NDVI 0.1–0.8 для демо без спутника."""
    raw = hashlib.md5(f"{feature_id}:{seed}".encode()).hexdigest()
    rnd = random.Random(raw)
    return round(0.1 + rnd.random() * 0.7, 3)


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
    return None


def gee_available() -> bool:
    try:
        import ee  # noqa: F401

        return True
    except ImportError:
        return False


def _init_earth_engine() -> None:
    import ee
    import json as json_lib

    project = os.environ.get("GEE_PROJECT") or os.environ.get("GOOGLE_CLOUD_PROJECT")
    sa_key = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")

    if sa_key and os.path.isfile(sa_key):
        with open(sa_key, encoding="utf-8") as fh:
            key_data = json_lib.load(fh)
        email = key_data.get("client_email")
        credentials = ee.ServiceAccountCredentials(email, sa_key)
        ee.Initialize(credentials, project=project)
    elif project:
        ee.Initialize(project=project)
    else:
        ee.Initialize()


def compute_ndvi_gee(
    features: list[dict],
    start_date: str,
    end_date: str,
) -> tuple[list[dict], str]:
    """
    Средний NDVI (медиана по сценам Sentinel-2 SR) внутри каждого полигона.
    """
    import ee

    _init_earth_engine()

    # exclusive end date for GEE filterDate
    end_exclusive = (datetime.fromisoformat(end_date) + timedelta(days=1)).strftime("%Y-%m-%d")

    collection = (
        ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
        .filterDate(start_date, end_exclusive)
        .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 35))
    )

    def mask_clouds(img):
        scl = img.select("SCL")
        # 4 — растительность, 5 — голая почва, 6 — вода
        mask = scl.eq(4).Or(scl.eq(5))
        return img.updateMask(mask)

    def add_ndvi(img):
        return img.addBands(img.normalizedDifference(["B8", "B4"]).rename("NDVI"))

    composite = collection.map(mask_clouds).map(add_ndvi).select("NDVI").median()

    results = []
    for feat in features:
        fid = str(feat.get("id", ""))
        geom = feat.get("geometry")
        if not geom:
            results.append({"id": fid, "ndvi": None})
            continue

        ee_geom = geojson_to_ee_geometry(geom)
        if ee_geom is None:
            results.append({"id": fid, "ndvi": None})
            continue

        try:
            stats = composite.reduceRegion(
                reducer=ee.Reducer.mean(),
                geometry=ee_geom,
                scale=20,
                maxPixels=int(1e13),
                bestEffort=True,
            )
            val = stats.get("NDVI")
            ndvi = val.getInfo() if val is not None else None
            if ndvi is not None:
                ndvi = round(float(ndvi), 3)
        except Exception:
            ndvi = None

        results.append({"id": fid, "ndvi": ndvi})

    return results, "gee"


def compute_ndvi_batch(
    features: list[dict],
    period: str = "last_month",
    custom_month: str | None = None,
    force_demo: bool = False,
) -> dict[str, Any]:
    start, end, label = parse_period(period, custom_month)
    seed = f"{start}_{end}"

    use_gee = not force_demo and os.environ.get("RUBIN_NDVI_DEMO", "").lower() not in (
        "1",
        "true",
        "yes",
    )

    source = "demo"
    values: list[dict]

    if use_gee and gee_available():
        try:
            values, source = compute_ndvi_gee(features, start, end)
        except Exception as exc:
            print(f"GEE NDVI failed, using demo: {exc}", flush=True)
            values = [
                {"id": str(f.get("id", "")), "ndvi": demo_ndvi(str(f.get("id", "")), seed)}
                for f in features
            ]
            source = "demo_fallback"
    else:
        values = [
            {"id": str(f.get("id", "")), "ndvi": demo_ndvi(str(f.get("id", "")), seed)}
            for f in features
        ]

    for item in values:
        item["status"] = ndvi_status(item.get("ndvi"))

    return {
        "period": period,
        "custom_month": custom_month,
        "start": start,
        "end": end,
        "label": label,
        "source": source,
        "values": values,
    }
