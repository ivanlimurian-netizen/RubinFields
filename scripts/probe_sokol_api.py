#!/usr/bin/env python3
"""Probe sokolmeteo.com API endpoints with Basic Auth."""
from __future__ import annotations

import base64
import json
import re
import ssl
import urllib.error
import urllib.request

UID = "9c291fa6-845f-4526-82a4-3822551c3bca"
PWD = "2211"
IMEI = "861937065189277"
CTX = ssl.create_default_context()
AUTH = base64.b64encode(f"{UID}:{PWD}".encode()).decode()


def fetch(url: str, headers: dict | None = None, data: bytes | None = None, method: str | None = None):
    hdrs = {"User-Agent": "Mozilla/5.0", "Accept": "application/json, text/plain, */*"}
    if headers:
        hdrs.update(headers)
    req = urllib.request.Request(url, data=data, headers=hdrs, method=method)
    try:
        with urllib.request.urlopen(req, timeout=20, context=CTX) as r:
            body = r.read(2000)
            return r.status, dict(r.headers), body
    except urllib.error.HTTPError as e:
        body = e.read(800) if e.fp else b""
        return e.code, dict(e.headers), body
    except Exception as e:
        return None, {}, str(e).encode()


def main() -> None:
    print("=== service page links ===")
    status, _, body = fetch("https://sokolmeteo.ru/servis/")
    print("status", status)
    if isinstance(body, bytes) and status == 200:
        html = body.decode("utf-8", "replace")
        for m in re.findall(r'href=["\']([^"\']+)["\']', html, re.I):
            low = m.lower()
            if any(x in low for x in ("api", "pdf", "upload", "wp-content", "rukovod")):
                print(" link:", m)

    print("\n=== API candidates ===")
    candidates = [
        f"https://sokolmeteo.com/api/devices",
        f"https://sokolmeteo.com/api/v1/devices",
        f"https://sokolmeteo.com/api/device/{IMEI}",
        f"https://sokolmeteo.com/api/v1/devices/{IMEI}",
        f"https://sokolmeteo.com/api/v1/devices/{IMEI}/messages",
        f"https://sokolmeteo.com/api/v1/devices/{IMEI}/last",
        f"https://sokolmeteo.com/api/messages?imei={IMEI}",
        f"https://sokolmeteo.com/api/archive?imei={IMEI}",
        f"https://sokolmeteo.com/rest/devices",
        f"https://sokolmeteo.com/gateway/api/devices",
        f"https://api.sokolmeteo.com/api/devices",
        f"https://sokolmeteo.com/api/auth/login",
    ]
    for url in candidates:
        status, headers, body = fetch(url, headers={"Authorization": f"Basic {AUTH}"})
        snippet = body[:180] if isinstance(body, bytes) else body
        ctype = headers.get("Content-Type", "")
        print(f"{status} {url}\n  {ctype}\n  {snippet!r}\n")

    print("=== login POST ===")
    for url, payload in [
        ("https://sokolmeteo.com/api/auth/login", json.dumps({"login": UID, "password": PWD}).encode()),
        ("https://sokolmeteo.com/api/login", json.dumps({"username": UID, "password": PWD}).encode()),
        ("https://sokolmeteo.com/login", f"login={UID}&password={PWD}".encode()),
    ]:
        status, headers, body = fetch(
            url,
            headers={"Content-Type": "application/json" if url.endswith(("login",)) and b"{" in payload else "application/x-www-form-urlencoded"},
            data=payload,
            method="POST",
        )
        print(status, url, body[:200] if isinstance(body, bytes) else body)


if __name__ == "__main__":
    main()
