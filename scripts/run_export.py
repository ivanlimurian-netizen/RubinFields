import json
import os
import fiona

os.makedirs('data', exist_ok=True)

print('Opening fields...')
src = fiona.open('Maps vector/Поля_Рубин.TAB', 'r')
features = []
for f in src:
    features.append({
        'type': 'Feature',
        'geometry': dict(f.geometry),
        'properties': dict(f.properties)
    })
src.close()

geojson = {'type': 'FeatureCollection', 'features': features}
with open('data/mapinfo_polya.geojson', 'w', encoding='utf-8') as out:
    json.dump(geojson, out, ensure_ascii=False, indent=2)
print(f'Fields saved: {len(features)}')

print('Opening soils...')
src = fiona.open('Maps vector/Почвы_Рубин.TAB', 'r')
features = []
for f in src:
    features.append({
        'type': 'Feature',
        'geometry': dict(f.geometry),
        'properties': dict(f.properties)
    })
src.close()

geojson = {'type': 'FeatureCollection', 'features': features}
with open('data/mapinfo_pochvy.geojson', 'w', encoding='utf-8') as out:
    json.dump(geojson, out, ensure_ascii=False, indent=2)
print(f'Soils saved: {len(features)}')

print('Done!')