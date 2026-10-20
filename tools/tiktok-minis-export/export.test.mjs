import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getAccount, getReport, parseArgs } from './export.mjs';

function mockFetch(url) {
  if (url.pathname.endsWith('/advertiser/info/')) {
    return Promise.resolve({ ok: true, json: async () => ({ code: 0, data: { list: [{ advertiser_id: '123', name: '账户 A', currency: 'USD' }] } }) });
  }
  const page = Number(url.searchParams.get('page'));
  assert.deepEqual(JSON.parse(url.searchParams.get('dimensions')), ['minis_id', 'advertiser_id', 'stat_time_day']);
  assert.equal(url.searchParams.get('data_level'), 'AUCTION_ADVERTISER');
  return Promise.resolve({ ok: true, json: async () => ({
    code: 0,
    data: {
      list: [{ dimensions: { advertiser_id: '123', minis_id: String(900 + page), stat_time_day: '2026-10-01' }, metrics: { minis_name: `Mini ${page}`, spend: '10.25', impressions: '100', clicks: '5', conversion: '1' } }],
      page_info: { total_page: 2 }
    }
  }) });
}

test('validates date window and account IDs', () => {
  assert.deepEqual(parseArgs(['--advertiser-ids', '123,123,456', '--start-date', '2026-10-01', '--end-date', '2026-10-30']).ids, ['123', '456']);
  assert.throws(() => parseArgs(['--advertiser-ids', 'abc', '--start-date', '2026-10-01', '--end-date', '2026-10-02']));
  assert.throws(() => parseArgs(['--advertiser-ids', '123', '--start-date', '2026-10-01', '--end-date', '2026-10-31']));
});

test('gets advertiser name and traverses all report pages', async () => {
  const account = await getAccount('123', 'test-token', mockFetch);
  assert.equal(account.name, '账户 A');
  const rows = await getReport(account, '2026-10-01', '2026-10-01', 'test-token', mockFetch);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row[3]), ['901', '902']);
  assert.equal(rows[0][6], 10.25);
  assert.equal(rows[1][8], 5);
});

test('rejects missing Mini name', async () => {
  const missingName = async (url) => {
    const response = await mockFetch(url);
    if (url.pathname.endsWith('/advertiser/info/')) return response;
    const body = await response.json();
    delete body.data.list[0].metrics.minis_name;
    return { ok: true, json: async () => body };
  };
  await assert.rejects(getReport({ id: '123', name: '账户 A', currency: 'USD' }, '2026-10-01', '2026-10-01', 'test-token', missingName), /minis_name/);
});
