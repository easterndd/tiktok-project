const { PrismaClient } = require('@prisma/client');
const { loadEnv } = require('./dist/config/env');
const { miniAppEnvironment } = require('./dist/config/mini-apps');
(async()=>{
 const env=miniAppEnvironment(loadEnv(),'lucidreel');
 const db=new PrismaClient({datasources:{db:{url:env.DATABASE_URL}}});
 try {
 const jobs=await db.uploadJob.findMany({where:{sourceType:'FILE',status:{in:['PENDING','PROCESSING','FAILED']}},orderBy:{createdAt:'asc'},include:{episode:true}});
 console.log('now='+new Date().toISOString());
 for(const j of jobs)console.log(JSON.stringify({id:j.id,ep:j.episode.episodeNo,status:j.status,retry:j.retryCount,created:j.createdAt,updated:j.updatedAt,started:j.startedAt,remote:j.remoteStartedAt,next:j.nextAttemptAt,lease:j.leaseExpiresAt,hasLease:!!j.leaseToken,vid:j.providerJobId,bound:j.episode.byteplusVid,file:j.localFilePath?require('fs').statSync(j.localFilePath).size:null,error:j.errorMessage}));
 }finally{await db.$disconnect()}
})().catch(e=>{console.error(e.message);process.exit(1)});
