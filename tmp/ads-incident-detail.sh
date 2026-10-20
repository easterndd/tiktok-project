set -eu
printf 'POSTGRES CONNECTIONS\n'
sudo docker exec quickreels-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d postgres -Atc "select coalesce(datname,chr(45)),coalesce(state,chr(45)),coalesce(wait_event_type,chr(45)),count(*) from pg_stat_activity group by 1,2,3 order by 1,2,3"'
printf 'OPEN TRANSACTIONS\n'
sudo docker exec quickreels-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d postgres -Atc "select pid,client_addr,state,coalesce(wait_event,chr(45)),floor(extract(epoch from now()-xact_start)),left(query,160) from pg_stat_activity where xact_start is not null order by xact_start limit 12"'
printf 'RECENT API ERRORS\n'
sudo docker logs --since 3m quickreels-api-1 2>&1 | sudo docker exec -i quickreels-api-1 node -e 'let s="";process.stdin.on("data",x=>s+=x);process.stdin.on("end",()=>{let e={},u={};for(let l of s.split("\n")){try{let j=JSON.parse(l);if(j.level>=50){let k=j.err?.code||j.err?.message?.slice(0,70)||j.msg?.slice(0,70)||"unknown";e[k]=(e[k]||0)+1}if(j.res?.statusCode>=500){let k=j.req?.url||j.reqId||"unknown";u[k]=(u[k]||0)+1}}catch{}}console.log(JSON.stringify({errors:e,failedRequests:Object.entries(u).slice(0,20)}))})'
