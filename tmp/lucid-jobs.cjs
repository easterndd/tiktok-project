const { PrismaClient } = require('@prisma/client');
const { loadEnv } = require('./dist/config/env');
const { miniAppEnvironment } = require('./dist/config/mini-apps');
(async () => {
 const env=miniAppEnvironment(loadEnv(),'lucidreel'); const db=new PrismaClient({datasources:{db:{url:env.DATABASE_URL}}});
 try {
  const album=await db.album.findUnique({where:{id:'cmv7fqiwdfzn3lm01jh9cbkka'},select:{id:true,title:true,tiktokAlbumId:true,tiktokVersion:true,onlineVersion:true,reviewStatus:true,publishStatus:true,platformPublishedVersion:true}});
  const jobs=await db.platformSyncJob.findMany({where:{albumId:'cmv7fqiwdfzn3lm01jh9cbkka'},orderBy:{createdAt:'desc'},take:15,select:{id:true,kind:true,status:true,attemptCount:true,createdAt:true,startedAt:true,completedAt:true,nextAttemptAt:true,errorCode:true,errorMessage:true,providerRequestId:true,providerJobId:true,providerResponse:true,snapshotJson:true}});
  console.log(JSON.stringify({album,jobs}));
 } finally { await db.$disconnect(); }
})().catch(e=>{console.error(e.message);process.exit(1)});
