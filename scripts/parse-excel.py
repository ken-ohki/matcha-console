#!/usr/bin/env python3
"""Parse '2026 Matcha Price List.xlsx', generating SKUs per the naming master."""
import json
import math
import re
import sys
from pathlib import Path

import pandas as pd

PRICE_LIST = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('/Users/ken/Downloads/2026 Matcha Price List.xlsx')
SKU_MASTER = Path('/Users/ken/Downloads/日本茶SKU命名規則マスター.xlsx')
OUT = Path(__file__).parent / 'import-data.json'

GROUP_MARKERS = {
    '↓SABO Signature Collection': 'Signature Collection',
    '↓SABO Original Collection': 'Original Collection',
    '↓SABO Single Origin Collection': 'Single Origin Collection',
    '↓Wholesale Exclusive': 'Wholesale Exclusive',
    '↓Non-Matcha': 'Non-Matcha',
}

TEA_TYPE_INFO = {
    'Matcha': {'code': 'MT', 'form': None},
    'Gyokuro Powder': {'code': 'GY', 'form': 'P'},
    'Hojicha Powder': {'code': 'HJ', 'form': 'P'},
}


def clean(value):
    if value is None:
        return None
    if isinstance(value, float) and math.isnan(value):
        return None
    if isinstance(value, str):
        s = value.strip()
        return s or None
    return value


def split_list(value):
    s = clean(value)
    if s is None:
        return []
    parts = [p.strip() for p in re.split(r'[、,/]', s)]
    return [p for p in parts if p]


def parse_num(value):
    if value is None:
        return None
    if isinstance(value, str):
        v = value.strip().lower()
        if v in ('', 'on demand', 'n/a', '-'):
            return None
        try:
            return float(value)
        except ValueError:
            return None
    if isinstance(value, float) and math.isnan(value):
        return None
    return float(value)


def load_code_maps():
    df = pd.read_excel(SKU_MASTER, sheet_name='産地', header=None)
    origin_map = {}
    for i in range(3, len(df)):
        code, _, _, roman, _ = df.iloc[i, 0], df.iloc[i, 1], df.iloc[i, 2], df.iloc[i, 3], df.iloc[i, 4]
        if isinstance(code, str) and isinstance(roman, str):
            origin_map[roman.strip()] = code.strip()
    # Disambiguate: Kagoshima takes precedence over Kagawa (price list only uses Kagoshima)
    origin_map['Kagoshima'] = 'KG'

    df = pd.read_excel(SKU_MASTER, sheet_name='品種', header=None)
    cultivar_map = {}
    for i in range(len(df)):
        code, _, roman = df.iloc[i, 0], df.iloc[i, 1], df.iloc[i, 2]
        if isinstance(code, str) and isinstance(roman, str) and code != 'コード' and len(code.strip()) <= 5:
            cultivar_map[roman.strip()] = code.strip()
    # Excel typo
    cultivar_map['Samemidori'] = cultivar_map.get('Saemidori', 'SAE')
    return origin_map, cultivar_map


def derive_year_code(harvest_time, name):
    # Per-product override: "(2025)" tag in product name
    if name and '(2025)' in name:
        return '25H1'
    s = (harvest_time or '').strip().lower()
    if s == '1st flush':
        return '26H1'
    if s == '2nd flush':
        return '26H2'
    if s == 'blend':
        return 'STD'
    return 'STD'


def derive_origin_code(origins, origin_map):
    if not origins:
        return 'BLD'
    if len(origins) > 1:
        return 'BLD'
    return origin_map.get(origins[0], 'BLD')


def derive_cultivar_code(cultivars, cultivar_map):
    if not cultivars:
        return 'BLD'
    if len(cultivars) > 1:
        return 'BLD'
    name = cultivars[0]
    if name == 'Tea Master Blend':
        return 'BLD'
    return cultivar_map.get(name, 'BLD')


def build_sku(tea_type, origins, cultivars, harvest_time, name, origin_map, cultivar_map):
    info = TEA_TYPE_INFO.get(tea_type)
    if not info:
        return None
    tea_code = info['code']
    origin_code = derive_origin_code(origins, origin_map)
    cultivar_code = derive_cultivar_code(cultivars, cultivar_map)
    year_code = derive_year_code(harvest_time, name)
    parts = [tea_code, origin_code, cultivar_code, year_code]
    if info['form']:
        parts.append(info['form'])
    return '-'.join(parts)


def main():
    origin_map, cultivar_map = load_code_maps()
    df = pd.read_excel(PRICE_LIST, sheet_name='Matcha', header=None)

    current_group = None
    products = []
    used_skus = {}

    for idx in range(2, len(df)):
        row = df.iloc[idx]
        first = clean(row[0])
        if first in GROUP_MARKERS:
            current_group = GROUP_MARKERS[first]
            continue
        if current_group is None:
            continue
        tea_type = clean(row[0])
        product_name = clean(row[1])
        if not product_name or tea_type == 'Tea Type':
            continue

        grade = clean(row[2])
        origins = split_list(row[3])
        cultivars = split_list(row[4])
        harvest_raw = clean(row[5])
        harvest_seasons = [harvest_raw] if harvest_raw else []
        plucking = split_list(row[7])
        certifications = split_list(row[10])
        current_stock = parse_num(row[12])
        wholesale_price = parse_num(row[14])
        note = clean(row[18])

        sku = build_sku(tea_type, origins, cultivars, harvest_raw, product_name, origin_map, cultivar_map)
        # Deduplicate by appending suffix if collision
        if sku in used_skus:
            used_skus[sku] += 1
            sku = f"{sku}-{used_skus[sku]:02d}"
        else:
            used_skus[sku] = 1

        products.append({
            'group': current_group,
            'sku': sku,
            'name': product_name,
            'teaType': tea_type,
            'grade': grade,
            'origins': origins,
            'cultivars': cultivars,
            'pluckingMethods': plucking,
            'harvestSeasons': harvest_seasons,
            'shadingMethods': [],
            'certifications': certifications,
            'currentStockKg': current_stock,
            'standardWholesalePrice': wholesale_price,
            'salesNote': note,
        })

    groups = list(dict.fromkeys(GROUP_MARKERS.values()))
    OUT.write_text(json.dumps({'groups': groups, 'products': products}, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'Wrote {len(products)} products into {OUT}')
    # Show SKU summary
    print('\nGenerated SKUs:')
    for p in products:
        print(f"  {p['sku']:<20} ← {p['name']}")


if __name__ == '__main__':
    main()
