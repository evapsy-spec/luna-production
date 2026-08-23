import csv, collections, re, json

rows = list(csv.DictReader(open('/tmp/unmatched-titles.csv', encoding='utf-8-sig'), delimiter=';'))

def n(r, k):
    try:
        return int(r[k] or 0)
    except Exception:
        return 0

exact = [r for r in rows if r['Похоже на наш товар'].strip() and not r['Похоже на наш товар'].startswith('похоже')]
partial = [r for r in rows if r['Похоже на наш товар'].startswith('похоже')]
none = [r for r in rows if not r['Похоже на наш товар'].strip()]

print('ИТОГИ')
for label, group in (('точно наш каталог', exact), ('похоже', partial), ('не найдено', none)):
    print('  %-20s названий %4d, штук %5d, THB %9d' % (
        label, len(group), sum(n(r, 'Штук') for r in group), sum(n(r, 'Выручка THB') for r in group)))

agg = collections.defaultdict(lambda: [0, 0, 0])
for r in none:
    w = re.split(r'[\s(]', r['Название в кассе Ainur'].strip())[0][:22]
    a = agg[w]
    a[0] += 1
    a[1] += n(r, 'Штук')
    a[2] += n(r, 'Выручка THB')

print()
print('ПЕРВОЕ СЛОВО В НАЗВАНИИ (только не найденные)')
print('%-24s %6s %7s %11s' % ('слово', 'назв.', 'штук', 'THB'))
for w, (c, u, rev) in sorted(agg.items(), key=lambda kv: -kv[1][1])[:45]:
    print('%-24s %6d %7d %11d' % (w, c, u, rev))

# сокращённый файл для сверки: не найденные, отсортированные по штукам
none.sort(key=lambda r: -n(r, 'Штук'))
with open('/tmp/for-eva.csv', 'w', encoding='utf-8', newline='') as f:
    w = csv.writer(f, delimiter=';')
    w.writerow(['Название в кассе Ainur', 'Штук', 'Выручка THB', 'Первая продажа', 'Последняя продажа'])
    for r in none:
        w.writerow([r['Название в кассе Ainur'], n(r, 'Штук'), n(r, 'Выручка THB'),
                    r['Первая продажа'], r['Последняя продажа']])
print()
print('сокращённый файл: /tmp/for-eva.csv, строк', len(none))

json.dump(
    {'prefixes': sorted([[k, v[0], v[1], v[2]] for k, v in agg.items()], key=lambda x: -x[2])[:45],
     'top_none': [[r['Название в кассе Ainur'], n(r, 'Штук'), n(r, 'Выручка THB'),
                   r['Первая продажа'], r['Последняя продажа']] for r in none[:120]],
     'totals': {'exact': [len(exact), sum(n(r, 'Штук') for r in exact)],
                'partial': [len(partial), sum(n(r, 'Штук') for r in partial)],
                'none': [len(none), sum(n(r, 'Штук') for r in none)]}},
    open('/tmp/for-eva.json', 'w', encoding='utf-8'), ensure_ascii=False)
print('json: /tmp/for-eva.json')
