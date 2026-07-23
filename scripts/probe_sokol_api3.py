#!/usr/bin/env python3
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


def req(url, method="GET", data=None, headers=None):
    hdrs = {"User-Agent": "Mozilla/5.0", "Accept": "application/json, */*"}
    if headers:
        hdrs.update(headers)
    r = urllib.request.Request(url, data=data, headers=hdrs, method=method)
    try:
        with urllib.request.urlopen(r, timeout=25, context=CTX) as resp:
            return resp.status, dict(resp.headers), resp.read(3000)
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), (e.read(1500) if e.fp else b"")
    except Exception as e:
        return None, {}, str(e).encode()


def main():
    auth_variants = [
        ("Basic uid:pwd", {"Authorization": "Basic " + base64.b64encode(f"{UID}:{PWD}".encode()).decode()}),
        ("Basic uid:", {"Authorization": "Basic " + base64.b64encode(f"{UID}:".encode()).decode()}),
        ("Bearer uid", {"Authorization": f"Bearer {UID}"}),
        ("Token uid", {"Authorization": f"Token {UID}"}),
        ("X-Api-Key", {"X-Api-Key": UID}),
        ("X-Auth-Token", {"X-Auth-Token": UID}),
        ("apiKey header", {"apiKey": UID, "apiPassword": PWD}),
        ("login/password headers", {"login": UID, "password": PWD}),
        ("Basic email-like", {"Authorization": "Basic " + base64.b64encode(f"{UID}@sokol:{PWD}".encode()).decode()}),
    ]

    url = f"https://sokolmeteo.com/api/device/{IMEI}"
    for name, hdr in auth_variants:
        status, headers, body = req(url, headers=hdr)
        print(name, status, body[:160].decode("utf-8", "replace").replace("\n", " "))

    # Find API PDF links from service pages
    for page in [
        "https://sokolmeteo.ru/servis/",
        "https://esokol.com/servis/",
        "https://sokolmeteo.ru/",
    ]:
        status, _, body = req(page)
        print("\nPAGE", page, status)
        if status != 200:
            continue
        html = body.decode("utf-8", "replace")
        for m in re.findall(r'href=["\']([^"\']+)["\']', html, re.I):
            if any(x in m.lower() for x in ("api", ".pdf", "upload", "doc", "metod")):
                print(" ", m)

    # Search common upload paths for API pdf
    pdf_guesses = [
        "https://sokolmeteo.ru/wp-content/uploads/2023/01/API.pdf",
        "https://sokolmeteo.ru/wp-content/uploads/API.pdf",
        "https://sokolmeteo.ru/files/api.pdf",
        "https://sokolmeteo.ru/docs/api.pdf",
        "https://esokol.com/wp-content/uploads/API.pdf",
    ]
    print("\nPDF guesses:")
    for u in pdf_guesses:
        status, headers, body = req(u)
        print(status, u, headers.get("Content-Type"), len(body))


if __name__ == "__main__":
    main()
