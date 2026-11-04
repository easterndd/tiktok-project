import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { legalContactForApp, legalDocumentForApp } from '../src/pages/legal-docs.ts';

const apps = {
  bloomreel: ['BloomReel', '7697505699680716820'],
  quillshort: ['QuillShort', '7701636896870451221'],
  amberplay: ['AmberPlay', '7701632194380548116'],
  nimbusclip: ['NimbusClip', '7701639446751840277'],
  runereel: ['RuneReel', '7701632194380564500']
};
const base = 'https://xuyins.com/static/augustlane';

describe('AUGUST LANE Mini legal pages', () => {
  for (const [key, [name, appId]] of Object.entries(apps)) {
    it(`${name} uses its own App ID and the AUGUST LANE policies`, async () => {
      const config = JSON.parse(await readFile(new URL(`../../${key}/minis.config.json`, import.meta.url), 'utf8'));
      assert.equal(config.appId, appId);
      assert.equal(config.dev.name, name);
      assert.equal(config.dev.ppLink, `${base}/privacy-policy.html`);
      assert.equal(config.dev.tosLink, `${base}/terms-of-service.html`);
      assert.equal(legalContactForApp(key), 'caijiarong2@xuyins.com');
      for (const [type, suffix] of [['privacy', 'privacy-policy'], ['terms', 'terms-of-service']]) {
        const document = legalDocumentForApp(type, key);
        const html = await readFile(new URL(`../../../deploy/website/static/augustlane/${suffix}.html`, import.meta.url), 'utf8');
        assert.match(document.contentHtml, /AUGUST LANE MEDIA LIMITED/);
        assert.match(document.contentHtml, /八月里傳媒有限公司/);
        assert.match(document.contentHtml, /8130888900009268/);
        assert.ok(html.includes(`rel="canonical" href="${config.dev[type === 'privacy' ? 'ppLink' : 'tosLink']}"`));
        assert.doesNotMatch(html, /Breeze and Azure|SAGATHIYA|NEWBEAT DIGITAL/);
      }
    });
  }
});
