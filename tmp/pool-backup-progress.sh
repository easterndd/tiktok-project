set -eu
backup=/home/ubuntu/pool-version-backup-20261015/database.dump
ls -lh "$backup"
df -h /opt/quickreels
ps -eo pid,etime,stat,comm | grep -E 'pg_dump|pg_restore|docker' | head -15
