set -eu
sudo docker cp /tmp/acceptance-refresh-audit.cjs quickreels-api-1:/app/apps/api/acceptance-refresh-audit.cjs
sudo docker exec quickreels-api-1 node acceptance-refresh-audit.cjs > /tmp/acceptance-refresh-audit.json
cat /tmp/acceptance-refresh-audit.json
printf '\nCOVER_LOG_SUMMARY\n'
sudo docker logs quickreels-covers-1 2>&1 | python3 -c 'import json,re,sys
counts={}; bytes_out=0
for line in sys.stdin:
 m=re.search(r"\"(?:GET|HEAD) [^\"]+\" (\d{3}) (\d+)",line)
 if not m: continue
 status,size=int(m.group(1)),int(m.group(2)); counts[status]=counts.get(status,0)+1; bytes_out+=size
print(json.dumps({"requests":sum(counts.values()),"statusCounts":counts,"responseBodyBytes":bytes_out}))'
