const { performance } = require('node:perf_hooks');
(async()=>{
 const report=[];
 for(const name of ['063785bdf3654161393ea04558153fdd08cf14644124ac0b81f1177bd48b085e.png','ed591655bb7a457b350eca6ffb90c1c96694ca705c0e09fb42a271c0fdeb24e6.png']) {
  for(const suffix of (process.argv.includes('--after') ? ['', '.w360.webp'] : [''])) {
   const url='https://api.evergreenprosper.com/api/v1/assets/covers/'+name+suffix;
   const samples=[];let etag,bytes,headers,status;
   const errors=[];for(let i=0;i<6;i++) {const start=performance.now();try {const r=await fetch(url,{signal:AbortSignal.timeout(8000)});bytes=(await r.arrayBuffer()).byteLength;samples.push(Math.round(performance.now()-start));etag=r.headers.get('etag');headers=Object.fromEntries(['cache-control','x-cover-service','content-type'].map(h=>[h,r.headers.get(h)]));status=r.status;}catch(e){errors.push(e.message);}}
   let conditionalStatus=null;if(etag)try {const conditional=await fetch(url,{headers:{'If-None-Match':etag},signal:AbortSignal.timeout(8000)});await conditional.arrayBuffer();conditionalStatus=conditional.status;}catch(e){errors.push(e.message);}
   const sorted=[...samples].sort((a,b)=>a-b);report.push({url,status,bytes,etag,headers,samples,errors,p50:sorted[Math.max(0,Math.ceil(sorted.length*.5)-1)],p95:sorted[Math.max(0,Math.ceil(sorted.length*.95)-1)],conditionalStatus});
  }
 }
 console.log(JSON.stringify({at:new Date().toISOString(),report},null,2));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
