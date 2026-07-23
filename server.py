"""
Локальный сервер ГИС «Рубин»: статика + API чтения MapInfo (.TAB) из папки Maps vector.
Запуск: python server.py  →  http://127.0.0.1:5000
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS

APP_ROOT = Path(__file__).resolve().parent
MAPS_DIR = APP_ROOT / "Maps vector"

LAYER_FILES = {
    "fields": "Поля_Рубин.TAB",
    "soils": "Почвы_Рубин.TAB",
}

REQUIRED_SIDECAR = {
    "fields": [".DAT", ".ID", ".MAP"],
    "soils": [".DAT", ".ID", ".MAP"],
}


def find_tab_path(filename: str) -> Path | None:
    if not MAPS_DIR.is_dir():
        return None
    direct = MAPS_DIR / filename
    if direct.is_file():
        return direct
    target = filename.lower()
    for entry in MAPS_DIR.iterdir():
        if entry.is_file() and entry.name.lower() == target:
            return entry
    return None


def check_sidecar_files(tab_path: Path, layer_key: str) -> list[str]:
    missing = []
    stem = tab_path.stem
    parent = tab_path.parent
    for ext in REQUIRED_SIDECAR.get(layer_key, []):
        found = False
        for entry in parent.iterdir():
            if entry.stem.lower() == stem.lower() and entry.suffix.lower() == ext.lower():
                found = True
                break
        if not found:
            missing.append(f"{stem}{ext}")
    return missing


def tab_to_geojson(tab_path: Path) -> dict:
    try:
        import fiona
        from fiona.warp import transform_geom
    except ImportError as exc:
        raise RuntimeError(
            "Установите зависимости: pip install -r requirements.txt"
        ) from exc

    features = []
    with fiona.open(tab_path, encoding="utf-8") as src:
        src_crs = src.crs
        for idx, feat in enumerate(src):
            geom = feat.get("geometry")
            if geom is None:
                continue
            if src_crs:
                try:
                    geom = transform_geom(
                        src_crs,
                        "EPSG:4326",
                        geom,
                        antimeridian_cutting=True,
                    )
                except Exception:
                    geom = transform_geom(src_crs, "EPSG:4326", geom)

            props = {}
            for key, val in (feat.get("properties") or {}).items():
                if isinstance(val, bytes):
                    try:
                        val = val.decode("utf-8")
                    except UnicodeDecodeError:
                        val = val.decode("cp1251", errors="replace")
                props[str(key)] = val

            features.append(
                {
                    "type": "Feature",
                    "id": feat.get("id", idx),
                    "properties": props,
                    "geometry": geom,
                }
            )

    return {"type": "FeatureCollection", "features": features}


app = Flask(__name__, static_folder=str(APP_ROOT), static_url_path="")
CORS(app)


@app.route("/")
def index():
    return send_from_directory(APP_ROOT, "index.html")


@app.route("/api/mapinfo")
def mapinfo_status():
    status = {}
    for key, filename in LAYER_FILES.items():
        tab_path = find_tab_path(filename)
        entry = {
            "file": filename,
            "found": tab_path is not None,
            "path": str(tab_path) if tab_path else None,
            "missing_sidecar": [],
        }
        if tab_path:
            entry["missing_sidecar"] = check_sidecar_files(tab_path, key)
        status[key] = entry
    return jsonify(
        {
            "maps_dir": str(MAPS_DIR),
            "maps_dir_exists": MAPS_DIR.is_dir(),
            "layers": status,
        }
    )


@app.route("/api/mapinfo/<layer>")
def mapinfo_layer(layer: str):
    if layer not in LAYER_FILES:
        return jsonify({"error": f"Неизвестный слой: {layer}"}), 404

    tab_path = find_tab_path(LAYER_FILES[layer])
    if not tab_path:
        return (
            jsonify(
                {
                    "error": f"Файл {LAYER_FILES[layer]} не найден в «Maps vector»",
                    "maps_dir": str(MAPS_DIR),
                }
            ),
            404,
        )

    missing = check_sidecar_files(tab_path, layer)
    if missing:
        return (
            jsonify(
                {
                    "error": "Не хватает файлов MapInfo рядом с .TAB",
                    "missing": missing,
                    "tab": str(tab_path),
                }
            ),
            400,
        )

    try:
        collection = tab_to_geojson(tab_path)
        return jsonify(collection)
    except Exception as exc:
        return jsonify({"error": str(exc), "tab": str(tab_path)}), 500


@app.route("/api/parse-mapinfo")
def parse_mapinfo_legacy():
    """Совместимость с ТЗ: ?layer=fields|soils"""
    layer = request.args.get("layer", "fields")
    return mapinfo_layer(layer)


@app.route("/api/weather", methods=["GET"])
def api_weather():
    """Актуальная погода со станции Сокол-М (sokolmeteo.com)."""
    force = request.args.get("force") in ("1", "true", "yes")
    try:
        from sokol_weather import fetch_sokol_weather

        return jsonify(fetch_sokol_weather(force=force))
    except Exception as exc:
        return jsonify({"error": str(exc), "source": "sokol"}), 503


@app.route("/api/ndvi", methods=["POST", "GET"])
def api_ndvi():
    """
    Расчёт среднего NDVI по полигонам (Sentinel-2 / Google Earth Engine).
    POST JSON: { features: [{id, geometry}], period, custom_month }
    """
    if request.method == "GET":
        from ndvi_compute import gee_available

        return jsonify(
            {
                "gee_installed": gee_available(),
                "demo_env": os.environ.get("RUBIN_NDVI_DEMO", ""),
                "hint": "POST с GeoJSON полями; для GEE: pip install earthengine-api && earthengine authenticate",
            }
        )

    body = request.get_json(silent=True) or {}
    features = body.get("features") or []
    period = body.get("period") or "last_month"
    custom_month = body.get("custom_month")

    if not features:
        return jsonify({"error": "Нет полей (features) в запросе"}), 400

    try:
        from ndvi_compute import compute_ndvi_batch

        result = compute_ndvi_batch(features, period=period, custom_month=custom_month)
        return jsonify(result)
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@app.route("/<path:asset_path>")
def static_asset(asset_path: str):
    target = APP_ROOT / asset_path
    if target.is_file():
        return send_from_directory(APP_ROOT, asset_path)
    return jsonify({"error": "Not found"}), 404


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5000"))
    print(f"Rubin GIS: http://127.0.0.1:{port}")
    print(f"MapInfo folder: {MAPS_DIR}")
    if not MAPS_DIR.is_dir():
        print("WARNING: папка «Maps vector» не найдена", file=sys.stderr)
    app.run(host="127.0.0.1", port=port, debug=True)
