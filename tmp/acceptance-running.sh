date -u
ps -eo pid,etime,args | grep -E 'acceptance-covers|docker exec' | head -8
ls -l /tmp/acceptance-cover-before.json
tail -3 /tmp/acceptance-cover-before.json
