set -eu
sudo docker logs --since 2026-10-15T09:58:00Z --until 2026-10-15T10:08:00Z quickreels-api-1 2>&1 | python3 /tmp/startup-traffic-shape.py
