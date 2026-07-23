import json
import os
import fiona

def convert_tab_to_geojson(tab_path, output_path):
    """Конвертирует TAB файл в GeoJSON"""
    try:
        print(f"  📖 Чтение: {os.path.basename(tab_path)}")
        
        with fiona.open(tab_path, 'r') as source:
            # Преобразуем Feature объекты в обычные словари
            features = []
            for feature in source:
                # Fiona объект нужно преобразовать в dict
                features.append(dict(feature))
            
            geojson = {
                "type": "FeatureCollection",
                "features": features
            }
            
            with open(output_path, 'w', encoding='utf-8') as f:
                json.dump(geojson, f, ensure_ascii=False, indent=2)
            
            print(f"  ✅ Сохранено {len(features)} объектов")
            print(f"  📁 {output_path}")
            return True
            
    except Exception as e:
        print(f"  ❌ Ошибка: {e}")
        return False

def main():
    os.makedirs('data', exist_ok=True)
    
    # Правильные пути к файлам
    polya_tab = "Maps vector/Поля_Рубин.TAB"
    pochvy_tab = "Maps vector/Почвы_Рубин.TAB"
    
    print("=" * 50)
    print("📁 Экспорт MapInfo в GeoJSON")
    print("=" * 50)
    
    # Конвертируем поля
    print("\n📌 Конвертация полей:")
    if os.path.exists(polya_tab):
        convert_tab_to_geojson(polya_tab, "data/mapinfo_polya.geojson")
    else:
        print(f"  ❌ Файл не найден: {polya_tab}")
    
    # Конвертируем почвы
    print("\n📌 Конвертация почв:")
    if os.path.exists(pochvy_tab):
        convert_tab_to_geojson(pochvy_tab, "data/mapinfo_pochvy.geojson")
    else:
        print(f"  ❌ Файл не найден: {pochvy_tab}")
    
    print("\n" + "=" * 50)
    print("✅ Готово! Файлы сохранены в папке data/")
    print("=" * 50)
    
    # Показываем размеры созданных файлов
    print("\n📊 Результат:")
    for file in ["mapinfo_polya.geojson", "mapinfo_pochvy.geojson"]:
        path = f"data/{file}"
        if os.path.exists(path):
            size = os.path.getsize(path) / 1024
            print(f"  ✅ {file} - {size:.2f} KB")
        else:
            print(f"  ❌ {file} - не создан")

if __name__ == "__main__":
    main()