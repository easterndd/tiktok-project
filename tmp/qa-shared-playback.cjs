const assert = require('node:assert/strict');
const { mkdir } = require('node:fs/promises');
const { chromium } = require('C:/Users/xy/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    let authorized = false, submitted;
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('dialog', (dialog) => dialog.accept());
    await page.addInitScript(() => {
      localStorage.setItem('quickreels_active_app', 'main');
      sessionStorage.setItem('quickreels_admin_token', 'local-qa');
      sessionStorage.setItem('quickreels_taletv_admin_token', 'target-local-qa');
    });
    await page.route('**/api/**', async (route) => {
      const url = new URL(route.request().url());
      let data = { items: [] };
      if (url.pathname.endsWith('/admin/me')) data = { admin: { email: 'qa@example.com', role: 'OWNER', status: 'ACTIVE' } };
      if (url.pathname.endsWith('/admin/app-entry-ad-policy')) data = { enabled: false, mode: 'INTERSTITIAL', placementId: '', requiredCount: 1, onUnavailable: 'ALLOW', version: 1 };
      if (url.pathname.endsWith('/admin/albums')) data = { items: [{ id: 'source-qa', title: 'Shared playback QA', status: 'ONLINE', episodeCount: 2, tiktokAlbumId: 'platform-source', tiktokVersion: 2, onlineVersion: 1, reviewStatus: 'REVIEWING', publishStatus: 'LISTED' }, { id: 'copy-qa', title: 'Authorized copy', sharedPlayback: true, status: 'ONLINE', episodeCount: 2, onlineVersion: 1, publishStatus: 'LISTED' }] };
      if (url.pathname.includes('/admin/shared-playback/')) {
        if (route.request().method() === 'POST') {
          submitted = route.request().postDataJSON();
          assert.ok(route.request().headers()['x-multi-app-tokens']);
          authorized = true;
          data = { items: [{ miniAppKey: 'taletv', accepted: true, operationId: 'grant-op' }] };
        } else data = { items: (url.searchParams.get('targetApps') ?? '').split(',').map((miniAppKey) => ({ miniAppKey, status: authorized ? 'AUTHORIZED' : 'NOT_AUTHORIZED', albumId: authorized ? 'shared-target-qa' : undefined, tiktokAlbumId: 'platform-source', onlineVersion: 1, localStatus: authorized ? 'ONLINE' : 'OFFLINE', episodeCount: 2, mappedEpisodeCount: authorized ? 2 : 0, requestId: authorized ? 'qa-grant-request' : undefined, operations: authorized ? [{ id: 'grant-op', kind: 'AUTHORIZE_ALBUM', status: 'SUCCEEDED', createdAt: '2026-09-27T10:00:00Z', providerRequestId: 'qa-grant-request', providerResponse: { platformAuthorized: true, mappedEpisodeCount: 2 } }] : [] })) };
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    });
    await page.goto('http://127.0.0.1:5174/');
    await page.getByRole('button', { name: '剧集与解锁', exact: true }).click();
    await page.locator('.multi-release-controls select').selectOption('source-qa');
    assert.equal(await page.locator('.multi-release-controls select option').count(), 2);
    await page.getByRole('checkbox', { name: 'TaleTV', exact: true }).check();
    await page.getByRole('button', { name: '授权播放', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.multi-release-table')?.textContent?.includes('授权与本地映射完成'));
    assert.deepEqual(submitted, { targetApps: ['taletv'], action: 'AUTHORIZE' });
    assert.equal(await page.getByText('多小程序独立发布', { exact: true }).count(), 0);
    assert.equal(await page.locator('.independent-upload').count(), 0);
    await mkdir('tmp/shared-playback-qa', { recursive: true });
    for (const [width, height] of [[1440, 1000], [390, 844]]) {
      await page.setViewportSize({ width, height });
      await page.locator('.multi-release-controls').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `tmp/shared-playback-qa/${width}.png` });
    }
    assert.deepEqual(errors, []);
    console.log('Mocked authorization UI: approved source filtering, target token, authorization payload, mapping feedback, retired UI absence, desktop/mobile verified.');
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
