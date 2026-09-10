import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const intervalMs = 30_000;

async function processJobs() {
  const jobs = await prisma.uploadJob.findMany({
    where: { status: { in: ['PENDING', 'PROCESSING'] }, retryCount: { lt: 5 } },
    take: 20,
    orderBy: { createdAt: 'asc' }
  });
  for (const job of jobs) {
    // Do not implement a speculative provider call here. The platform adapter owns the current API contract.
    await prisma.uploadJob.update({ where: { id: job.id }, data: { startedAt: new Date() } });
  }
}

async function main() {
  await processJobs();
  setInterval(() => void processJobs(), intervalMs);
}

void main();
