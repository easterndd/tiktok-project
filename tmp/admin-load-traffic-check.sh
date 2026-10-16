set -eu
printf 'RECENT REQUEST SHAPE\n'
sudo docker logs --since 3m quickreels-api-1 2>&1 | python3 /tmp/startup-traffic-shape.py
printf 'TALETV AND READY LATENCY\n'
sudo docker logs --since 3m quickreels-api-1 2>&1 | python3 /tmp/startup-latency-logs.py
