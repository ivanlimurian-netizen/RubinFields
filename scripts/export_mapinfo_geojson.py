"""
Однократный экспорт MapInfo → GeoJSON для статического режима (без Flask).
Запуск из корня проекта: python scripts/export_mapinfo_geojson.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from server import LAYER_FILES, find_tab_path, tab_to_geojson  # noqa: E402

OUT = {
    "fields": ROOT / "data" / "mapinfo_polya.geojson",
    "soils": ROOT / "data" / "mapinfo_pochvy.geojson",
}


def main() -> None:
    for layer, out_path in OUT.items():
        tab_name = LAYER_FILES[layer]
        tab_path = find_tab_path(tab_name)
        if not tab_path:
            print(f"SKIP {layer}: {tab_name} не найден")
            continue
        print(f"Reading {tab_path} …")
        data = tab_to_geojson(tab_path)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        with open(out_path, "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False)
        print(f"  → {out_path} ({len(data['features'])} объектов)")


if __name__ == "__main__":
    main()
