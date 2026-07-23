#!/usr/bin/env python3
from __future__ import annotations

import base64
import json
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
            body = resp.read(4000)
            return resp.status, dict(resp.headers), body
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), (e.read(2000) if e.fp else b"")
    except Exception as e:
        return None, {}, str(e).encode()


def main():
    # Check auth challenge
    status, headers, body = req("https://sokolmeteo.com/api/devices")
    print("noauth", status, headers.get("WWW-Authenticate"), body[:200])

    auth = base64.b64encode(f"{UID}:{PWD}".encode()).decode()
    status, headers, body = req(
        "https://sokolmeteo.com/api/devices",
        headers={"Authorization": f"Basic {auth}"},
    )
    print("basic uid:2211", status, headers.get("WWW-Authenticate"), body[:300])

    # Try IMEI:password as basic
    auth2 = base64.b64encode(f"{IMEI}:{PWD}".encode()).decode()
    status, headers, body = req(
        "https://sokolmeteo.com/api/devices",
        headers={"Authorization": f"Basic {auth2}"},
    )
    print("basic imei:2211", status, body[:300])

    # Platform login with UUID as login
    for login_type in ("email", "phone", "login", "uuid", "id"):
        payload = json.dumps(
            {"loginType": login_type, "login": UID, "password": PWD}
        ).encode()
        status, headers, body = req(
            "https://sokolmeteo.com/platform/api/user/login",
            method="POST",
            data=payload,
            headers={"Content-Type": "application/json"},
        )
        print("login", login_type, status, body[:300], "set-cookie", headers.get("Set-Cookie", "")[:120])

    # Try without loginType
    payload = json.dumps({"login": UID, "password": PWD}).encode()
    status, headers, body = req(
        "https://sokolmeteo.com/platform/api/user/login",
        method="POST",
        data=payload,
        headers={"Content-Type": "application/json"},
    )
    print("login plain", status, body[:400])

    # Probe more API paths with basic
    paths = [
        "/api/",
        "/api/v1/",
        "/api/device",
        f"/api/device/{IMEI}/data",
        f"/api/device/{IMEI}/lastMessage",
        f"/api/device/{IMEI}/messages",
        "/api/message/last",
        f"/api/message/last?imei={IMEI}",
        "/api/swagger",
        "/api/swagger.json",
        "/v2/api-docs",
        "/swagger-ui.html",
        "/platform/api/device",
        "/platform/api/devices",
        "/platform/api/message",
        "/platform/api/messages",
    ]
    for p in paths:
        status, headers, body = req(
            "https://sokolmeteo.com" + p,
            headers={"Authorization": f"Basic {auth}"},
        )
        ctype = headers.get("Content-Type", "")
        print(f"{status} {p} {ctype} {body[:120]!r}")


if __name__ == "__main__":
    main()
