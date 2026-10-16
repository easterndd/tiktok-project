import json
import sys
from collections import Counter, defaultdict

requests = {}
counts = Counter()
durations = defaultdict(list)
failures = Counter()
for line in sys.stdin:
    try:
        item = json.loads(line)
    except ValueError:
        continue
    rid = item.get('reqId')
    if rid and isinstance(item.get('req'), dict):
        request = item['req']
        requests[rid] = (request.get('method', ''), request.get('url', '').split('?')[0])
    if not rid or 'responseTime' not in item or not isinstance(item.get('res'), dict):
        continue
    method, path = requests.pop(rid, ('', 'unknown'))
    path = path.replace('/api/taletv/v1/', '/api/{app}/v1/')
    import re
    path = re.sub(r'^/api/[^/]+/v1/', '/api/{app}/v1/', path)
    path = re.sub(r'/[a-z0-9]{24,}(?=/|$)', '/{id}', path)
    key = f'{method} {path}'
    counts[key] += 1
    durations[key].append(item['responseTime'])
    status = item['res']['statusCode']
    if status >= 500:
        failures[(key, status)] += 1

print('TOP REQUEST PATHS')
for key, n in counts.most_common(20):
    values = sorted(durations[key])
    print(f'{n:6} {key:80} p95={values[int((n-1)*.95)]:.0f}ms')
print('5XX')
for (key, status), n in failures.most_common(15):
    print(f'{n:4} {status} {key}')
