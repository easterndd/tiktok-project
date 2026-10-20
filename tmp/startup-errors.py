import json
import sys
from collections import Counter

paths = {}
errors = {}
groups = Counter()
for line in sys.stdin:
    try:
        item = json.loads(line)
    except ValueError:
        continue
    rid = item.get('reqId')
    if not rid:
        continue
    if isinstance(item.get('req'), dict):
        paths[rid] = item['req'].get('url', '').split('?')[0]
    if isinstance(item.get('err'), dict):
        errors[rid] = item['err'].get('message', '')[:180]
    if item.get('res', {}).get('statusCode', 0) >= 500:
        path = paths.get(rid, 'unknown')
        message = errors.get(rid, '')
        groups[(path, message)] += 1
for (path, message), count in groups.most_common(20):
    print(f'{count} {path}: {message}')
