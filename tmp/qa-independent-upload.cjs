const assert = require('node:assert/strict');
const { mkdir } = require('node:fs/promises');
const { chromium } = require('C:/Users/xy/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    let upload;
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('dialog', (dialog) => dialog.accept());
    await page.addInitScript(() => {
      localStorage.setItem('quickreels_active_app', 'main');
      sessionStorage.setItem('quickreels_admin_token', 'qa-local-only');
    });
    await page.route('**/api/**', async (route) => {
      const url = new URL(route.request().url());
      const path = url.pathname;
      let data = { items: [] };
      if (path.endsWith('/admin/me')) data = { admin: { email: 'qa@example.com', role: 'OWNER', status: 'ACTIVE' } };
      if (path.endsWith('/admin/app-entry-ad-policy')) data = { enabled: false, mode: 'INTERSTITIAL', placementId: '', requiredCount: 1, onUnavailable: 'ALLOW', version: 1 };
      if (path.endsWith('/admin/albums')) data = { items: [{ id: 'source-qa', title: 'Independent upload QA', status: 'ONLINE', episodeCount: 2 }] };
      if (path.endsWith('/admin/episodes')) data = { items: [1, 2].map((episodeNo) => ({ id: `episode-${episodeNo}`, albumId: 'source-qa', episodeNo, title: `Episode ${episodeNo}`, sortOrder: episodeNo, byteplusVid: `source-vid-${episodeNo}`, album: { title: 'Independent upload QA', status: 'ONLINE' } })) };
      if (path.includes('/admin/multi-app-releases/')) {
        if (route.request().method() === 'POST') {
          upload = route.request().postDataJSON();
          data = { items: upload.targetApps.map((miniAppKey) => ({ miniAppKey, accepted: true, jobIds: ['qa-job'] })) };
        } else data = { items: url.searchParams.get('targetApps').split(',').map((miniAppKey) => ({ miniAppKey, prepared: true, albumId: 'target-qa', videoReadyCount: 0, episodeCount: 2, jobs: [] })) };
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    });
    await page.goto('http://127.0.0.1:5174/');
    await page.getByRole('button', { name: '剧集与解锁', exact: true }).click();
    await page.locator('.multi-release-controls select').selectOption('source-qa');
    await page.getByRole('checkbox', { name: 'QuicK ReeLS', exact: true }).uncheck();
    await page.getByRole('checkbox', { name: 'TaleTV', exact: true }).check();
    await page.locator('.independent-upload summary').click();
    await page.getByLabel('第 1 集原文件下载地址').fill('https://example.com/one.mp4');
    await page.getByRole('button', { name: '上传此集', exact: true }).first().click();
    await page.waitForFunction(() => document.querySelector('.notice')?.textContent?.includes('接受操作'));
    assert.equal(upload.action, 'UPLOAD_VIDEO_URL');
    assert.deepEqual(upload.targetApps, ['taletv']);
    assert.deepEqual(upload.sources, [{ episodeNo: 1, sourceUrl: 'https://example.com/one.mp4' }]);
    await mkdir('tmp/independent-upload-qa', { recursive: true });
    for (const [width, height] of [[1440, 1000], [390, 844]]) {
      await page.setViewportSize({ width, height });
      await page.locator('.independent-upload').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `tmp/independent-upload-qa/${width}.png` });
      const bounds = await page.locator('.independent-upload').boundingBox();
      assert.ok(bounds && bounds.width > 0);
    }
    assert.deepEqual(errors, []);
    console.log('Local mocked UI: single-episode upload payload, target selection, desktop/mobile screenshots passed.');
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
