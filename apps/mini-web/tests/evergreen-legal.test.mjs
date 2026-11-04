import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { it } from 'node:test';
import { legalContactForApp, legalDocumentForApp } from '../src/pages/legal-docs.ts';

it('QuicK ReeLS and QuartzPlay share brand-neutral evergreenprosper policies', async () => {
  const configs = await Promise.all([
    readFile(new URL('../minis.config.json', import.meta.url), 'utf8'),
    readFile(new URL('../../quartzplay/minis.config.json', import.meta.url), 'utf8')
  ]);
  for (const raw of configs) {
    const config = JSON.parse(raw);
    assert.equal(config.dev.ppLink, 'https://evergreenprosper.com/privacy');
    assert.equal(config.dev.tosLink, 'https://evergreenprosper.com/terms');
  }
  for (const type of ['privacy', 'terms']) {
    const main = legalDocumentForApp(type, 'quickreels');
    const quartz = legalDocumentForApp(type, 'quartzplay');
    const html = await readFile(new URL(`../../../deploy/website/${type}/index.html`, import.meta.url), 'utf8');
    const legacyHtml = await readFile(new URL(`../../../deploy/website/quickreels/${type}/index.html`, import.meta.url), 'utf8');
    assert.equal(legacyHtml, html);
    assert.deepEqual(quartz, main);
    assert.equal(main.title, type === 'privacy' ? 'Privacy Policy' : 'Terms of Service');
    assert.match(html, /evergreenprosper/);
    assert.match(html, /caixuwen@xuyins\.com/);
    assert.match(html, /November 2, 2026/);
    assert.ok(html.includes(`rel="canonical" href="https://evergreenprosper.com/${type}"`));
    assert.doesNotMatch(`${main.title}${main.introHtml}${main.contentHtml}${html}`, /QuicK ReeLS|QuartzPlay/);
  }
  assert.equal(legalContactForApp('quickreels'), legalContactForApp('quartzplay'));
  assert.match(legalDocumentForApp('privacy', 'storyland').title, /StoryLand/);
});
