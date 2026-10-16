const { PrismaClient } = require('@prisma/client');
const { loadEnv } = require('./dist/config/env');
const { configuredMiniAppKeys, miniAppEnvironment } = require('./dist/config/mini-apps');
const { uploadScope, localUploadDirectory, matchesUploadTags } = require('./dist/services/local-upload.service');
const { BytePlusVodService, isBytePlusTransferFailure } = require('./dist/services/byteplus-vod.service');
const fs = require('node:fs');
const path = require('node:path');
const mode = process.argv[2] || 'status';
const requested = process.argv.slice(3);
const planPath = '/tmp/byteplus-recovery-plan.json';
function retained(j, env) {
  if (!j.localFilePath || j.uploadScope !== uploadScope(env)) return false;
  const rel = path.relative(localUploadDirectory(env), path.resolve(j.localFilePath));
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return false;
  try { return fs.statSync(j.localFilePath).isFile(); } catch { return false; }
}
function definite(j) { return !j.providerJobId && (/tags length exceeds 36/i.test(j.errorMessage || '') || isBytePlusTransferFailure(j.errorMessage || '')); }
(async () => {
  const base = loadEnv();
  const plan = mode === 'queue' ? JSON.parse(fs.readFileSync(planPath,'utf8')) : [];
  const backup = [];
  for (const key of configuredMiniAppKeys(base)) {
    if (mode === 'status' && key !== 'lucidreel') continue;
    const env = miniAppEnvironment(base,key);
    const db = new PrismaClient({datasources:{db:{url:env.DATABASE_URL}}});
    try {
      const jobs = await db.uploadJob.findMany({where:{sourceType:'FILE',createdAt:{gte:new Date('2026-10-13T00:00:00Z')}},orderBy:{createdAt:'desc'},include:{episode:true}});
      if (!jobs.length) continue;
      const counts = {};
      for (const j of jobs) counts[j.status] = (counts[j.status]||0)+1;
      console.log(JSON.stringify({app:key,counts}));
      if (mode === 'prepare') {
        backup.push({app:key,jobs});
        for (const j of jobs) {
          if (j.status !== 'FAILED' || !definite(j) || !retained(j,env) || j.episode.byteplusVid) continue;
          if (await db.uploadJob.count({where:{episodeId:j.episodeId,OR:[{status:{in:['PENDING','PROCESSING']}},{createdAt:{gt:j.createdAt}}]}})) continue;
          plan.push({app:key,id:j.id,episodeId:j.episodeId,episodeNo:j.episode.episodeNo});
        }
      }
      if (mode === 'queue') {
        for (const candidate of plan.filter(c => c.app === key && (!requested.length || requested.includes(c.id)))) {
          const queued = await db.$transaction(async tx => {
            const j = await tx.uploadJob.findUnique({where:{id:candidate.id}});
            if (!j || j.status !== 'FAILED' || !definite(j) || !retained(j,env)) return false;
            if (await tx.uploadJob.count({where:{episodeId:j.episodeId,createdAt:{gt:j.createdAt}}})) return false;
            const ep = await tx.episode.updateMany({where:{id:j.episodeId,byteplusVid:null,uploadJobs:{none:{status:{in:['PENDING','PROCESSING']}}}},data:{status:'UPLOADING',byteplusUploadStatus:'UPLOADING'}});
            if (ep.count !== 1) return false;
            const updated = await tx.uploadJob.updateMany({where:{id:j.id,status:'FAILED',providerJobId:null,uploadScope:j.uploadScope,localFilePath:j.localFilePath},data:{status:'PENDING',retryCount:0,remoteStartedAt:null,leaseToken:null,leaseExpiresAt:null,errorMessage:null,completedAt:null,nextAttemptAt:new Date()}});
            if (updated.count !== 1) throw Error('Recovery claim changed');
            return true;
          });
          console.log(JSON.stringify({...candidate,queued}));
        }
      }
      if (mode === 'status') {
        for (const j of jobs.filter(j=>j.status!=='SUCCEEDED')) console.log(JSON.stringify({app:key,id:j.id,episodeNo:j.episode.episodeNo,status:j.status,retryCount:j.retryCount,vid:j.providerJobId,error:j.errorMessage}));
        const recent = jobs.filter(j=>j.status==='SUCCEEDED' && j.completedAt >= new Date('2026-10-13T10:48:00Z')).slice(0,3);
        const vod = new BytePlusVodService(env);
        for (const j of recent) {
          const [media] = await vod.getMediaInfos({vids:[j.providerJobId]});
          console.log(JSON.stringify({app:key,verifiedJob:j.id,episodeNo:j.episode.episodeNo,vid:j.providerJobId,bound:j.episode.byteplusVid===j.providerJobId,tagsValid:matchesUploadTags(media?.tags,j.uploadScope,j.id),spaceValid:media?.spaceName===env.BYTEPLUS_SPACE_NAME,completedAt:j.completedAt}));
        }
      }
    } finally { await db.$disconnect(); }
  }
  if (mode==='prepare') {
    fs.writeFileSync('/tmp/byteplus-jobs-full-before.json',JSON.stringify(backup,null,2),{mode:0o600});
    fs.writeFileSync(planPath,JSON.stringify(plan,null,2),{mode:0o600});
    console.log(JSON.stringify({eligible:plan}));
  }
})().catch(e=>{console.error(e.message);process.exit(1)});
