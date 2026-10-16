import json
import sys
from collections import defaultdict
from datetime import datetime, timezone

requests = {}
samples = defaultdict(list)
errors = defaultdict(int)
slow = []

for line in sys.stdin:
    try:
        item = json.loads(line)
    except ValueError:
        continue
    request_id = item.get('reqId')
    request = item.get('req')
    if request_id and isinstance(request, dict):
        requests[request_id] = (request.get('method', ''), request.get('url', '').split('?')[0])
    response = item.get('res')
    if not request_id or not isinstance(response, dict) or 'responseTime' not in item:
        continue
    method, path = requests.pop(request_id, ('', 'unknown'))
    if '/api/taletv/v1/' in path:
        endpoint = path.removeprefix('/api/taletv/v1/')
    elif path == '/ready':
        endpoint = 'ready'
    else:
        endpoint = 'other-apps'
    if endpoint.startswith('admin/analytics/'):
        endpoint = endpoint.split('/')[2]
    elif endpoint.startswith('app-entry-ad-sessions/'):
        endpoint = 'app-entry-ad-sessions/complete'
    elif endpoint.startswith('admin/') and endpoint not in ('admin/me', 'admin/episodes', 'admin/albums', 'admin/upload-jobs', 'admin/platform-sync-jobs', 'admin/app-entry-ad-policies', 'admin/app-entry-ad-policy'):
        endpoint = 'other-admin'
    if endpoint not in ('other-apps', 'other-admin') and not endpoint.startswith('admin/') and endpoint not in ('ready', 'auth/anonymous/session', 'app-entry-ad-sessions', 'app-entry-ad-sessions/complete', 'ad-events'):
        endpoint = 'other-taletv'
    duration = float(item['responseTime'])
    samples[endpoint].append(duration)
    status = response.get('statusCode', 0)
    if status >= 500:
        errors[(endpoint, status)] += 1
    if endpoint not in ('other-apps', 'other-taletv') and duration > 1000:
        at = datetime.fromtimestamp(item['time'] / 1000, timezone.utc).strftime('%H:%M:%S')
        slow.append((duration, at, endpoint, status))

def percentile(values, ratio):
    values = sorted(values)
    return round(values[min(len(values) - 1, int((len(values) - 1) * ratio))])

for endpoint, values in sorted(samples.items()):
    print(f'{endpoint:36} n={len(values):6} p50={percentile(values, .5):6}ms p95={percentile(values, .95):6}ms max={round(max(values)):6}ms')
print('5xx:', dict(errors))
print('slowest:')
for duration, at, endpoint, status in sorted(slow, reverse=True)[:20]:
    print(f'  {at}Z {endpoint} {status} {round(duration)}ms')
