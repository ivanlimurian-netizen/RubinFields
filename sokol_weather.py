"""
Клиент API sokolmeteo.com для метеостанции Сокол-М / Сокол-М1.

Официальный поток (Sokolmeteo_API.doc):
  1) POST /platform/api/user/login  → cookie JSESSIONID
  2) POST /api/device               → список устройств (IMEI, dataSnapshot, lastDataReceivedDt)
  3) POST /api/analytics/record     → показания t, HM, PR, WV, RN

Важно:
  - login/password — это email и пароль аккаунта на sokolmeteo.com
  - пароль станции 2211 нужен только при регистрации устройства, не для API
  - User ID (UUID) — идентификатор владельца, не логин
"""
from __future__ import annotations

import json
import os
import re
from datetime import datetime, timedelta, timezone
from http.cookiejar import CookieJar
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import HTTPCookieProcessor, Request, build_opener

APP_ROOT = Path(__file__).resolve().parent
CONFIG_PATH = APP_ROOT / "data" / "weather_config.json"
BASE = "https://sokolmeteo.com"

PARAM_CODES = ("t", "HM", "PR", "WV", "RN")


def load_weather_config() -> dict:
    cfg: dict[str, Any] = {
        "sokol": {
            "enabled": True,
            "login": os.environ.get("SOKOL_LOGIN", ""),
            "password": os.environ.get("SOKOL_PASSWORD", ""),
            "imei": os.environ.get("SOKOL_IMEI", "861937065189277"),
            "stationName": os.environ.get("SOKOL_STATION_NAME", "РУБИН 1"),
            "userId": os.environ.get("SOKOL_USER_ID", "9c291fa6-845f-4526-82a4-3822551c3bca"),
        }
    }
    if CONFIG_PATH.is_file():
        try:
            file_cfg = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
            if isinstance(file_cfg, dict):
                sokol = {**cfg["sokol"], **(file_cfg.get("sokol") or {})}
                cfg["sokol"] = sokol
        except Exception:
            pass
    return cfg


def _opener():
    jar = CookieJar()
    return build_opener(HTTPCookieProcessor(jar)), jar


def _request(opener, method: str, url: str, body: bytes | None = None, headers: dict | None = None):
    hdrs = {
        "User-Agent": "RubinGIS/1.0 (Sokol-M weather)",
        "Accept": "application/json, */*",
    }
    if headers:
        hdrs.update(headers)
    req = Request(url, data=body, headers=hdrs, method=method)
    with opener.open(req, timeout=90) as resp:
        raw = resp.read()
        return resp.status, dict(resp.headers), raw


def _login(opener, login: str, password: str) -> None:
    payload = json.dumps(
        {
            "loginType": "email",
            "login": login.strip(),
            "password": password,
        }
    ).encode("utf-8")
    try:
        status, _, raw = _request(
            opener,
            "POST",
            f"{BASE}/platform/api/user/login",
            body=payload,
            headers={"Content-Type": "application/json"},
        )
    except HTTPError as e:
        raw = e.read() if e.fp else b""
        try:
            err = json.loads(raw.decode("utf-8", "replace"))
            raise RuntimeError(err.get("message") or f"Ошибка входа Sokolmeteo ({e.code})")
        except (json.JSONDecodeError, UnicodeDecodeError):
            raise RuntimeError(f"Ошибка входа Sokolmeteo: HTTP {e.code}") from e

    if status != 200:
        raise RuntimeError(f"Ошибка входа Sokolmeteo: HTTP {status}")


def _list_devices(opener) -> list[dict]:
    status, _, raw = _request(
        opener,
        "POST",
        f"{BASE}/api/device?start=0&count=100",
        body=b"{}",
        headers={"Content-Type": "application/json"},
    )
    if status != 200:
        raise RuntimeError(f"Не удалось получить список устройств: HTTP {status}")
    data = json.loads(raw.decode("utf-8"))
    return list(data.get("data") or [])


def _find_device(devices: list[dict], imei: str, user_id: str = "") -> dict | None:
    imei = str(imei or "").strip()
    for d in devices:
        if str(d.get("imei") or "").strip() == imei:
            return d
    if user_id:
        for d in devices:
            if str(d.get("userId") or "") == user_id:
                return d
    return devices[0] if len(devices) == 1 else None


def _parse_snapshot(snapshot: Any) -> dict[str, Any]:
    """dataSnapshot может быть JSON-строкой, dict или текстом key=value."""
    if snapshot is None or snapshot == "":
        return {}
    if isinstance(snapshot, dict):
        return snapshot
    text = str(snapshot).strip()
    if not text:
        return {}
    try:
        obj = json.loads(text)
        if isinstance(obj, dict):
            return obj
    except json.JSONDecodeError:
        pass
    out: dict[str, Any] = {}
    for part in re.split(r"[;,\s]+", text):
        if "=" not in part and ":" not in part:
            continue
        sep = "=" if "=" in part else ":"
        k, v = part.split(sep, 1)
        k = k.strip()
        v = v.strip()
        if not k:
            continue
        try:
            out[k] = float(v.replace(",", "."))
        except ValueError:
            out[k] = v
    return out


def _fetch_records(opener, device_id: str, days: int = 3) -> list[dict]:
    end = datetime.now()
    start = end - timedelta(days=days)
    qs = urlencode(
        {
            "deviceId": device_id,
            "startDate": start.strftime("%d.%m.%Y"),
            "endDate": end.strftime("%d.%m.%Y"),
            "parameters": ",".join(PARAM_CODES),
        }
    )
    status, _, raw = _request(
        opener,
        "POST",
        f"{BASE}/api/analytics/record?{qs}",
        body=b"",
        headers={"Content-Type": "application/json"},
    )
    if status != 200:
        return []
    text = raw.decode("utf-8", "replace").strip()
    if not text:
        return []
    data = json.loads(text)
    if isinstance(data, list):
        return data
    if isinstance(data, dict) and isinstance(data.get("data"), list):
        return data["data"]
    return []


def _pick_num(src: dict, *keys: str):
    for k in keys:
        if k in src and src[k] is not None and src[k] != "":
            try:
                return float(src[k])
            except (TypeError, ValueError):
                continue
    return None


def _parse_dt(value: Any) -> int | None:
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        # ms or seconds
        ts = float(value)
        if ts > 1e12:
            return int(ts)
        if ts > 1e9:
            return int(ts * 1000)
    text = str(value).strip()
    try:
        # 2020-06-18T17:50:08+03:00
        dt = datetime.fromisoformat(text)
        return int(dt.timestamp() * 1000)
    except ValueError:
        pass
    for fmt in ("%d.%m.%Y %H:%M:%S", "%d.%m.%Y %H:%M", "%Y-%m-%d %H:%M:%S"):
        try:
            dt = datetime.strptime(text, fmt).replace(tzinfo=timezone.utc)
            return int(dt.timestamp() * 1000)
        except ValueError:
            continue
    return None


def fetch_sokol_weather(force: bool = False) -> dict:
    """
    Возвращает нормализованный объект погоды для фронтенда.
    force зарезервирован (кэш на стороне JS).
    """
    del force  # кэш на клиенте
    cfg = load_weather_config().get("sokol") or {}
    if not cfg.get("enabled", True):
        raise RuntimeError("Сокол-М отключён в weather_config.json")

    login = (cfg.get("login") or "").strip()
    password = cfg.get("password") or ""
    imei = str(cfg.get("imei") or "").strip()
    station_name = cfg.get("stationName") or "Сокол-М"
    user_id = str(cfg.get("userId") or "").strip()

    if not login or not password:
        raise RuntimeError(
            "Укажите email и пароль аккаунта sokolmeteo.com в data/weather_config.json "
            "(это НЕ пароль станции 2211)."
        )

    opener, _jar = _opener()
    _login(opener, login, password)
    devices = _list_devices(opener)
    if not devices:
        raise RuntimeError("В аккаунте Sokolmeteo нет устройств")

    device = _find_device(devices, imei, user_id)
    if not device:
        raise RuntimeError(f"Станция с IMEI {imei} не найдена в аккаунте")

    device_id = device.get("id") or device.get("idAsString")
    snapshot = _parse_snapshot(device.get("dataSnapshot"))
    records = _fetch_records(opener, str(device_id), days=3) if device_id else []
    last = records[-1] if records else {}

    # приоритет: последнее показание analytics, затем snapshot
    src = {**snapshot, **last}

    temp = _pick_num(src, "t", "T", "temp")
    humidity = _pick_num(src, "HM", "hm", "humidity")
    pressure = _pick_num(src, "PR", "pr", "pressure")
    wind = _pick_num(src, "WV", "wv", "wind")
    rain = _pick_num(src, "RN", "rn", "rain", "precipitation")

    updated_at = (
        _parse_dt(last.get("date"))
        or _parse_dt(device.get("lastDataReceivedDt"))
        or _parse_dt(src.get("date"))
        or int(datetime.now().timestamp() * 1000)
    )

    age_min = max(0, (datetime.now().timestamp() * 1000 - updated_at) / 60000)
    stale = age_min > 90  # станция шлёт ~каждые 30 мин; >90 мин — считаем устаревшим

    def fmt(v, digits=1):
        if v is None:
            return None
        return round(float(v), digits)

    return {
        "source": "sokol",
        "stationName": device.get("name") or station_name,
        "imei": device.get("imei") or imei,
        "temp": fmt(temp, 1),
        "humidity": fmt(humidity, 0),
        "pressure": fmt(pressure, 1),
        "wind": fmt(wind, 1),
        "precipitation": fmt(rain if rain is not None else 0, 2),
        "description": "данные метеостанции Сокол-М",
        "isDemo": False,
        "isStale": stale,
        "updatedAt": updated_at,
        "lastDataReceivedDt": device.get("lastDataReceivedDt"),
        "ageMinutes": int(age_min),
    }
