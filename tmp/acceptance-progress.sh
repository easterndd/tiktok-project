set -eu
ls -lh /home/ubuntu/acceptance-before-20261016T035527Z/
ps -eo pid,etime,args | grep -E 'pg_dump|tar -czf|docker compose.*build' | head -15
