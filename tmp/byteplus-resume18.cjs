const {PrismaClient}=require('@prisma/client');
const {loadEnv}=require('./dist/config/env');
const {miniAppEnvironment}=require('./dist/config/mini-apps');
const {processLocalUploadJobs,matchesUploadTags}=require('./dist/services/local-upload.service');
const {BytePlusVodService}=require('./dist/services/byteplus-vod.service');
(async()=>{
 const base=loadEnv(),env=miniAppEnvironment(base,'lucidreel');
 const db=new PrismaClient({datasources:{db:{url:env.DATABASE_URL}}}), shared=new PrismaClient({datasources:{db:{url:base.DATABASE_URL}}});
 const id='cmv6ju4djcfh7pg011399h2ck';
 try {
 const findMany=db.uploadJob.findMany.bind(db.uploadJob);
 db.uploadJob.findMany=(args)=>findMany({...args,where:{...args.where,id}});
 console.log('resume-start '+new Date().toISOString());
 const vod=new BytePlusVodService(env);
 await processLocalUploadJobs(db,shared,vod,env,{log:(message,details)=>console.log(message,details)});
 const j=await db.uploadJob.findUnique({where:{id},include:{episode:true}});
 const media=j.providerJobId?(await vod.getMediaInfos({vids:[j.providerJobId]}))[0]:null;
 console.log(JSON.stringify({status:j.status,vid:j.providerJobId,bound:j.episode.byteplusVid===j.providerJobId&&!!j.providerJobId,tags:media?matchesUploadTags(media.tags,j.uploadScope,id):false,file:j.localFilePath,error:j.errorMessage}));
 }finally{await db.$disconnect();await shared.$disconnect()}
})().catch(e=>{console.error(e.message);process.exit(1)});
