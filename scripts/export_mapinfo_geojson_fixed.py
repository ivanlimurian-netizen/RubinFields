import json
import os
import fiona
from fiona import drivers
import glob

def tab_to_geojson(tab_path, output_path=None):
    """Конвертирует MapInfo TAB файл в GeoJSON"""
    try:
        # Открываем TAB файл
        with fiona.open(tab_path, 'r') as source:
            # Если путь не указан, создаём рядом с исходным
            if output_path is None:
                output_path = tab_path.replace('.TAB', '.geojson').replace('.tab', '.geojson')
            
            # Сохраняем в GeoJSON
            with fiona.open(output_path, 'w', 
                          driver='GeoJSON',
                          crs=source.crs,
                          schema=source.schema) as dst:
                for feature in source:
                    dst.write(feature)
            
            print(f"✅ Конвертировано: {tab_path} -> {output_path}")
            return output_path
            
    except Exception as e:
        print(f"❌ Ошибка при конвертации {tab_path}: {e}")
        return None

def find_tab_files():
    """Ищет TAB файлы в проекте"""
    tab_files = []
    # Поиск в папке Maps vector
    map_paths = ['Maps vector', 'maps', 'source', '.']
    for path in map_paths:
        if os.path.exists(path):
            tab_files.extend(glob.glob(f"{path}/**/*.TAB", recursive=True))
            tab_files.extend(glob.glob(f"{path}/**/*.tab", recursive=True))
    return tab_files

def main():
    """Основная функция"""
    os.makedirs('data', exist_ok=True)
    
    # Ищем TAB файлы
    tab_files = find_tab_files()
    
    if not tab_files:
        print("⚠️ TAB файлы не найдены!")
        print("Поиск в папках: Maps vector, maps, source")
        return
    
    print(f"Найдено TAB файлов: {len(tab_files)}")
    
    # Фильтруем файлы по типу
    polya_file = None
    pochvy_file = None
    
    for file in tab_files:
        if 'пол' in file.lower() or 'field' in file.lower():
            polya_file = file
        if 'поч' in file.lower() or 'soil' in file.lower():
            pochvy_file = file
    
    # Конвертируем файлы
    if polya_file:
        print(f"\n📁 Конвертация полей: {polya_file}")
        output = tab_to_geojson(polya_file, 'data/mapinfo_polya.geojson')
        if output:
            print(f"✅ Поля сохранены: {output}")
    
    if pochvy_file:
        print(f"\n📁 Конвертация почв: {pochvy_file}")
        output = tab_to_geojson(pochvy_file, 'data/mapinfo_pochvy.geojson')
        if output:
            print(f"✅ Почвы сохранены: {output}")
    
    # Если не нашли отдельные файлы, конвертируем все найденные
    if not polya_file and not pochvy_file and len(tab_files) >= 1:
        print("\n📁 Конвертация всех найденных файлов...")
        for i, tab_file in enumerate(tab_files):
            output_name = f"data/layer_{i+1}.geojson"
            tab_to_geojson(tab_file, output_name)
    
    print("\n✅ Экспорт завершён!")
    print("📁 GeoJSON файлы сохранены в папке data/")

if __name__ == "__main__":
    main()