import assert from 'node:assert/strict';
import test from 'node:test';
import { enqueuePlatformSyncJob } from './platform-sync.service';

test('requeues a failed platform sync job when an operator retries it', async () => {
  const updateInputs: Record<string, unknown>[] = [];
  const prisma = {
    platformSyncJob: {
      findUnique: async () => ({ id: 'job-1', status: 'FAILED' }),
      update: async (input: Record<string, unknown>) => {
        updateInputs.push(input);
        return { id: 'job-1', status: 'PENDING' };
      },
      upsert: async () => assert.fail('failed jobs should be reset instead of upserted')
    }
  };

  const result = await enqueuePlatformSyncJob(prisma as any, {
    kind: 'VIDEO',
    targetId: 'episode-1',
    episodeId: 'episode-1',
    dedupeKey: 'VIDEO:episode-1:vid-1'
  });

  assert.deepEqual(result, { id: 'job-1', status: 'PENDING' });
  const updateInput = updateInputs[0];
  assert.ok(updateInput);
  const data = updateInput.data as Record<string, unknown>;
  assert.equal(data.status, 'PENDING');
  assert.equal(data.attemptCount, 0);
  assert.equal(data.errorMessage, null);
});

test('does not duplicate an active platform sync job', async () => {
  const existing = { id: 'job-1', status: 'PROCESSING' };
  const prisma = {
    platformSyncJob: {
      findUnique: async () => existing,
      update: async () => assert.fail('active jobs should not be reset'),
      upsert: async () => assert.fail('active jobs should not be duplicated')
    }
  };

  const result = await enqueuePlatformSyncJob(prisma as any, {
    kind: 'VIDEO',
    targetId: 'episode-1',
    episodeId: 'episode-1',
    dedupeKey: 'VIDEO:episode-1:vid-1'
  });

  assert.equal(result, existing);
});
