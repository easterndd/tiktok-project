import { PrismaClient } from '@prisma/client';
import { vodOpenapi } from '@byteplus/vcloud-sdk-nodejs';
import { episodeMediaTitle } from '../services/byteplus-vod.service';

async function main() {
  const apply = process.argv.includes('--apply');
  const url = process.env.TALETV_DATABASE_URL;
  const accessKey = process.env.BYTEPLUS_ACCESS_KEY;
  const secretKey = process.env.BYTEPLUS_SECRET_KEY;
  const spaceName = process.env.BYTEPLUS_SPACE_NAME;
  if (!url || !accessKey || !secretKey || !spaceName) {
    throw new Error('TALETV_DATABASE_URL and BytePlus credentials/space are required.');
  }
  const db = new PrismaClient({ datasources: { db: { url } } });
  const service = new vodOpenapi.VodService({
    region: process.env.BYTEPLUS_REGION || 'ap-southeast-1',
    host: new URL(process.env.BYTEPLUS_VOD_ENDPOINT || 'https://vod.byteplusapi.com').host,
    serviceName: 'vod',
    defaultVersion: '2023-01-01'
  });
  service.setAccessKeyId(accessKey);
  service.setSecretKey(secretKey);
  try {
    const episodes = await db.episode.findMany({
      where: { byteplusVid: { not: null } },
      select: { episodeNo: true, byteplusVid: true, album: { select: { title: true } } },
      orderBy: [{ albumId: 'asc' }, { episodeNo: 'asc' }]
    });
    let pending = 0;
    let updated = 0;
    for (const episode of episodes) {
      const vid = episode.byteplusVid!;
      const info = await service.GetMediaInfos({ Vids: vid });
      if (info.ResponseMetadata?.Error) throw new Error(`GetMediaInfos ${vid}: ${info.ResponseMetadata.Error.Code}`);
      const media = info.Result?.MediaInfoList?.find((item) => item.BasicInfo?.Vid === vid);
      if (!media || media.BasicInfo?.SpaceName !== spaceName) {
        console.log(`SKIP ${vid}: media missing or space mismatch`);
        continue;
      }
      const current = media.BasicInfo.Title?.trim() ?? '';
      if (current && current !== '未命名' && current.toLowerCase() !== 'untitled') continue;
      const title = episodeMediaTitle(episode.album.title, episode.episodeNo);
      pending++;
      console.log(`${apply ? 'UPDATE' : 'PREVIEW'} ${vid}: ${title}`);
      if (!apply) continue;
      const result = await service.UpdateMediaInfo({ Vid: vid, Title: title });
      if (result.ResponseMetadata?.Error) throw new Error(`UpdateMediaInfo ${vid}: ${result.ResponseMetadata.Error.Code}`);
      updated++;
    }
    console.log(`Checked ${episodes.length} TaleTV episodes; ${pending} unnamed; ${updated} updated.`);
  } finally {
    await db.$disconnect();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
