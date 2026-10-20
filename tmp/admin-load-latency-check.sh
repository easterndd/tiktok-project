set -eu
printf 'EXTERNAL PUBLIC API\n'
for attempt in 1 2 3 4 5; do
  curl --max-time 15 --silent --show-error --output /dev/null --write-out '%{http_code} %{time_total}s\n' https://api.evergreenprosper.com/api/talereels/v1/albums
done
printf 'LOCAL API\n'
for attempt in 1 2 3 4 5; do
  sudo docker exec quickreels-api-1 node -e 'const t=Date.now();fetch("http://127.0.0.1:3000/api/talereels/v1/albums").then(r=>console.log(r.status+" "+(Date.now()-t)+"ms")).catch(e=>{console.error(e);process.exit(1)})'
done
printf 'CONTAINER USAGE\n'
sudo docker stats --no-stream --format '{{.Name}} CPU={{.CPUPerc}} MEM={{.MemUsage}}' quickreels-api-1 quickreels-postgres-1 quickreels-pgbouncer-1
