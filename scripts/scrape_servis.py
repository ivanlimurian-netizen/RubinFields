#!/usr/bin/env python3
import re, ssl, urllib.request

ctx = ssl.create_default_context()
req = urllib.request.Request(
    "https://sokolmeteo.ru/servis/",
    headers={"User-Agent": "Mozilla/5.0"},
)
html = urllib.request.urlopen(req, timeout=30, context=ctx).read().decode("utf-8", "replace")
open(r"C:\Users\Ivan\Projects\rubin-gis\scripts\sokol_servis.html", "w", encoding="utf-8").write(html)
# all hrefs
hrefs = sorted(set(re.findall(r'href=["\']([^"\']+)["\']', html, re.I)))
print("href count", len(hrefs))
for h in hrefs:
    print(h)
print("--- text snippets with API ---")
for m in re.finditer(r'.{0,80}API.{0,120}', html, re.I):
    print(m.group(0).replace("\n", " ")[:200])
print("--- data-file / download ---")
for m in re.finditer(r'(data-[a-z-]+|download|file)=["\'][^"\']+["\']', html, re.I):
    print(m.group(0))
