#!/usr/bin/env python3
"""
Загрузка результатов NDVI на хостинг по FTP/FTPS.

Ожидаемые переменные окружения (GitHub Secrets → env):
  FTP_HOST          — хост, например ftp.kubokilina.ru
  FTP_USER          — логин
  FTP_PASS          — пароль
  FTP_REMOTE_DIR    — каталог сайта на сервере, напр. /RubinFields или /public_html/RubinFields
  FTP_PORT          — опционально, по умолчанию 21
  FTP_TLS           — 1/true для FTPS (явный TLS)

Локально:
  set FTP_HOST=...
  set FTP_USER=...
  set FTP_PASS=...
  set FTP_REMOTE_DIR=/RubinFields
  python scripts/deploy_ndvi_ftp.py
"""
from __future__ import annotations

import ftplib
import logging
import os
import ssl
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
MOSAIC_DIR = DATA_DIR / "ndvi_mosaics"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("deploy_ndvi_ftp")


def env(name: str, default: str | None = None) -> str:
    val = os.environ.get(name, default)
    if val is None or str(val).strip() == "":
        raise SystemExit(f"Не задана переменная окружения {name}")
    return str(val).strip()


def connect_ftp() -> ftplib.FTP:
    host = env("FTP_HOST")
    user = env("FTP_USER")
    password = env("FTP_PASS")
    port = int(os.environ.get("FTP_PORT", "21") or "21")
    use_tls = os.environ.get("FTP_TLS", "").lower() in ("1", "true", "yes")

    if use_tls:
        ctx = ssl.create_default_context()
        ftp: ftplib.FTP = ftplib.FTP_TLS(context=ctx)
        ftp.connect(host, port, timeout=120)
        ftp.login(user, password)
        ftp.prot_p()
    else:
        ftp = ftplib.FTP()
        ftp.connect(host, port, timeout=120)
        ftp.login(user, password)

    ftp.set_pasv(True)
    log.info("FTP OK: %s@%s:%s", user, host, port)
    return ftp


def ensure_remote_dir(ftp: ftplib.FTP, path: str) -> None:
    """Создать вложенные каталоги относительно текущей позиции / абсолютного пути."""
    path = path.replace("\\", "/").rstrip("/")
    if not path or path == "/":
        return

    # абсолютный путь: идём с корня
    if path.startswith("/"):
        ftp.cwd("/")
        parts = [p for p in path.split("/") if p]
    else:
        parts = [p for p in path.split("/") if p]

    for part in parts:
        try:
            ftp.cwd(part)
        except ftplib.error_perm:
            try:
                ftp.mkd(part)
            except ftplib.error_perm as exc:
                # уже существует / нет прав — пробуем зайти
                log.debug("mkd %s: %s", part, exc)
            ftp.cwd(part)


def upload_file(ftp: ftplib.FTP, local: Path, remote_name: str) -> None:
    size = local.stat().st_size
    with open(local, "rb") as fh:
        ftp.storbinary(f"STOR {remote_name}", fh)
    log.info("↑ %s (%d KB)", remote_name, round(size / 1024))


def main() -> int:
    remote_root = env("FTP_REMOTE_DIR").rstrip("/")

    json_files = [
        DATA_DIR / "ndvi_latest.json",
        DATA_DIR / "ndvi_status.json",
    ]
    for p in json_files:
        if not p.is_file():
            raise SystemExit(f"Нет файла для выгрузки: {p}")

    pngs = sorted(MOSAIC_DIR.glob("*.png")) if MOSAIC_DIR.is_dir() else []
    log.info("К выгрузке: %d JSON, %d PNG", len(json_files), len(pngs))

    ftp = connect_ftp()
    try:
        # data/
        ensure_remote_dir(ftp, f"{remote_root}/data")
        for p in json_files:
            upload_file(ftp, p, p.name)

        # data/ndvi_mosaics/
        ensure_remote_dir(ftp, f"{remote_root}/data/ndvi_mosaics")
        for i, p in enumerate(pngs, 1):
            upload_file(ftp, p, p.name)
            if i % 40 == 0:
                log.info("Прогресс мозаик: %d/%d", i, len(pngs))
    finally:
        try:
            ftp.quit()
        except Exception:
            ftp.close()

    log.info("Деплой NDVI завершён → %s/data/", remote_root)
    return 0


if __name__ == "__main__":
    sys.exit(main())
