set -eu
sudo docker exec quickreels-api-1 cat /tmp/resume18.log
sudo docker stats --no-stream --format '{{.Name}} CPU={{.CPUPerc}} NET={{.NetIO}}' quickreels-api-1 quickreels-worker-1
