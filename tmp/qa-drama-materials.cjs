const assert = require('node:assert/strict');
const { mkdir, readFile } = require('node:fs/promises');
const { chromium } = require('C:/Users/xy/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    const writes = [];
    let failBinding = false;
    const album = { id: 'alpha-drama', title: 'AFTER MY ALPHA ABANDONED ME, I CHOSE HIS RIVAL', description: 'Correct drama description.', status: 'READY', reviewStatus: 'REJECTED', episodeCount: 30, coverUrl: 'http://127.0.0.1:5174/qa-poster.png', coverAssetId: 'old-cover', translations: [{ locale: 'en', title: 'AFTER MY ALPHA ABANDONED ME, I CHOSE HIS RIVAL', description: 'Localized description.', coverUrl: 'http://127.0.0.1:5174/qa-poster.png' }], episodes: Array.from({ length: 30 }, (_, index) => ({ id: `episode-${index + 1}`, albumId: 'alpha-drama', episodeNo: index + 1, title: `Episode ${index + 1}`, sortOrder: index + 1, byteplusVid: `wrong-vid-${index + 1}`, coverAssetId: 'wrong-cover', coverUrl: 'http://127.0.0.1:5174/qa-poster.png', album: { title: 'Alpha', status: 'READY' } })) };
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => { localStorage.setItem('quickreels_active_app', 'taletv'); sessionStorage.setItem('quickreels_taletv_admin_token', 'qa-token'); });
    const poster = await readFile('D:/BaiduDownload/短剧/《AFTER MY ALPHA ABANDONED ME, I CHOSE HIS RIVAL》/封面/封面.png');
    await page.route('**/qa-poster.png', (route) => route.fulfill({ contentType: 'image/png', body: poster }));
    await page.route('**/api/**', async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      const method = request.method();
      let data = { items: [] };
      if (path.endsWith('/admin/me')) data = { admin: { email: 'qa@example.com', role: 'OWNER', status: 'ACTIVE' } };
      if (path.endsWith('/admin/app-entry-ad-policy')) data = { enabled: false };
      if (path.endsWith('/admin/albums')) data = { items: [album] };
      if (path.endsWith('/admin/episodes')) data = { items: album.episodes };
      if (path.endsWith('/admin/albums/alpha-drama')) {
        if (method === 'PATCH') { const body = request.postDataJSON(); writes.push({ path, body }); Object.assign(album, body, { coverUrl: 'http://127.0.0.1:5174/qa-poster.png' }); }
        data = album;
      }
      if (path.endsWith('/admin/byteplus/media')) data = { items: [{ vid: 'correct-vid-1', title: 'Alpha Episode 1' }], total: 1 };
      if (path.endsWith('/admin/cover-assets')) data = { id: 'correct-cover', publicUrl: 'http://127.0.0.1:5174/qa-poster.png' };
      if (path.endsWith('/admin/translations')) writes.push({ path, body: request.postDataJSON() });
      if (path.endsWith('/bind-byteplus')) {
        if (failBinding) { await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: { message: '平台任务仍在处理中' } }) }); return; }
        const body = request.postDataJSON();
        writes.push({ path, body });
        const episode = album.episodes.find((item) => path.includes(`/episodes/${item.id}/`));
        Object.assign(episode, { byteplusVid: body.byteplusVid, tiktokVideoStatus: 'NOT_STARTED' });
        data = episode;
      }
      if (/\/admin\/episodes\/episode-\d+$/.test(path) && method === 'PATCH') {
        const body = request.postDataJSON();
        writes.push({ path, body });
        const episode = album.episodes.find((item) => path.endsWith('/' + item.id));
        Object.assign(episode, body);
        data = episode;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    });
    await page.goto('http://127.0.0.1:5174/');
    await page.getByRole('button', { name: '剧集与解锁', exact: true }).click();
    const editor = page.locator('.drama-materials');
    await editor.locator('.material-picker select').selectOption('alpha-drama');
    await editor.getByLabel('剧名', { exact: true }).waitFor();
    assert.equal(await editor.locator('.material-episode').count(), 30);
    await editor.getByRole('button', { name: '刷新 VOD 媒资' }).click();
    const first = editor.locator('.material-episode').first();
    await first.getByLabel('VOD 媒资').selectOption('correct-vid-1');
    assert.equal(await first.getByLabel('清除原独立封面').isChecked(), true);
    await first.getByRole('button', { name: '保存此集' }).click();
    await first.getByText('视频已替换，TikTok 登记已入队。').waitFor();
    assert.deepEqual(writes.find((item) => item.path.endsWith('/bind-byteplus')).body, { byteplusVid: 'correct-vid-1', coverAssetId: null });
    assert.equal(album.episodes[1].byteplusVid, 'wrong-vid-2');
    assert.equal(album.episodes[0].coverAssetId, null);
    const second = editor.locator('.material-episode').nth(1);
    failBinding = true;
    await second.getByLabel('BytePlus VID').fill('correct-vid-2');
    await second.getByRole('button', { name: '保存此集' }).click();
    await second.getByRole('alert').waitFor();
    assert.equal(await second.getByLabel('BytePlus VID').inputValue(), 'correct-vid-2');
    assert.equal(album.episodes[1].byteplusVid, 'wrong-vid-2');
    await editor.locator('.material-cover input[type=file]').setInputFiles({ name: 'correct.png', mimeType: 'image/png', buffer: poster });
    await editor.getByRole('button', { name: '保存剧目信息' }).click();
    await editor.getByText('剧目已保存，待同步新版本。').waitFor();
    assert.equal(album.coverAssetId, 'correct-cover');
    assert.equal(writes.find((item) => item.path.endsWith('/admin/translations')).body.coverUrl, null);
    await mkdir('tmp/material-replacement-qa', { recursive: true });
    for (const [width, height] of [[1440, 1000], [390, 844]]) {
      await page.setViewportSize({ width, height });
      await editor.scrollIntoViewIfNeeded();
      await page.evaluate(() => document.querySelector('.drama-materials').scrollIntoView({ block: 'start' }));
      await page.screenshot({ path: `tmp/material-replacement-qa/editor-${width}.png` });
      const overflow = await editor.evaluate((element) => element.scrollWidth > element.clientWidth + 1);
      assert.equal(overflow, false, `Editor overflow at ${width}px`);
    }
    assert.deepEqual(errors, []);
    console.log('Mocked UI passed: 30 episodes; VID replacement; independent cover clearing; localized poster reset; failure retains draft; desktop/mobile layout.');
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
