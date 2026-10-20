set -eu
cd /opt/quickreels
printf 'CONTAINERS\n'
sudo docker ps --format '{{.Names}} {{.Status}} {{.Image}}' | grep -E 'quickreels-(api|worker|admin|covers)-1'
printf 'HEALTH\n'
curl -fsS --max-time 10 https://api.evergreenprosper.com/ready
printf '\nPUBLIC_APPS\n'
for key in taletv cinereels talereels; do printf '%s ' "$key"; curl -sS -o /dev/null -w '%{http_code} %{time_total}\n' --max-time 10 "https://api.evergreenprosper.com/api/$key/v1/albums"; done
printf 'WORKER_RECENT\n'
sudo docker logs --since 10m quickreels-worker-1 2>&1 | grep -Ei 'analytics|error|failed' | tail -25 || true
printf 'API_5XX_RECENT\n'
sudo docker logs --since 10m quickreels-api-1 2>&1 | python3 -c 'import json,sys; rows=[]
for line in sys.stdin:
 try: event=json.loads(line)
 except json.JSONDecodeError: continue
 status=event.get("res", {}).get("statusCode") if isinstance(event.get("res"),dict) else None
 if isinstance(status,int) and status>=500: rows.append({"time":event.get("time"),"statusCode":status,"requestId":event.get("reqId")})
print(json.dumps({"count":len(rows),"recent":rows[-20:]},ensure_ascii=False))'
