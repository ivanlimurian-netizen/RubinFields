# -*- coding: utf-8 -*-
import json
import os
import fiona

print("=" * 60)
print("Экспорт MapInfo в GeoJSON")
print("=" * 60)

# Создаём папку data
os.makedirs('data', exist_ok=True)

# Функция конвертации
def convert(tab_path, output_path, name):
    print(f"\n?? Обработка: {name}")
    print(f"   Файл: {tab_path}")
    
    if not os.path.exists(tab_path):
        print(f"   ? Файл не найден!")
        return False
    
    try:
        with fiona.open(tab_path, 'r') as source:
            features_list = []
            count = 0
            
            for feature in source:
                # Преобразуем в обычный словарь
                geom = feature.geometry
                if hasattr(geom, '__geo_interface__'):
                    geom_dict = geom.__geo_interface__
                else:
                    geom_dict = dict(geom)
                
                feature_dict = {
                    "type": "Feature",
                    "geometry": geom_dict,
                    "properties": dict(feature.properties)
                }
                features_list.append(feature_dict)
                count += 1
                if count % 10 == 0:
                    print(f"   Обработано {count} объектов...")
            
            geojson = {
                "type": "FeatureCollection",
                "features": features_list
            }
            
            # Сохраняем
            with open(output_path, 'w', encoding='utf-8') as f:
                json.dump(geojson, f, ensure_ascii=False, indent=2)
            
            print(f"   ? Успешно! Сохранено {count} объектов")
            print(f"   ?? {output_path}")
            return True
            
    except Exception as e:
        print(f"   ? Ошибка: {e}")
        import traceback
        traceback.print_exc()
        return False

# Конвертируем
convert("Maps vector/Поля_Рубин.TAB", "data/mapinfo_polya.geojson", "Поля")
convert("Maps vector/Почвы_Рубин.TAB", "data/mapinfo_pochvy.geojson", "Почвы")

print("\n" + "=" * 60)
print("? Готово!")
print("=" * 60)

# Проверяем результат
print("\n?? Проверка созданных файлов:")
for file in ["mapinfo_polya.geojson", "mapinfo_pochvy.geojson"]:
    path = f"data/{file}"
    if os.path.exists(path):
        size = os.path.getsize(path)
        print(f"   {file}: {size} байт")
        if size > 100:
            print(f"      ? Файл выглядит нормально")
        else:
            print(f"      ?? Файл подозрительно маленький")
    else:
        print(f"   {file}: не создан")