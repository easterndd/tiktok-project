import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { legalContactForApp, legalDocumentForApp } from '../src/pages/legal-docs.ts';

const apps = {
  riftsaga: ['RiftSaga', '7703783771463714834'],
  haloflicks: ['HaloFlicks', '7703800878805682194'],
  threadtale: ['ThreadTale', '7703816332495882247'],
  fablevibe: ['FableVibe', '7703800878805665810'],
  wispreel: ['WispReel', '7703799128240801799'],
  yalareels: ['YalaReels', '7697825438806181908']
};
const base = 'https://xuyins.com/static/wowolezi';

describe('WOWO LEZI Mini identity and legal pages', () => {
  for (const [key, [name, appId]] of Object.entries(apps)) {
    it(`${name} uses its own App ID and the WOWO LEZI policies`, async () => {
      const config = JSON.parse(await readFile(new URL(`../../${key}/minis.config.json`, import.meta.url), 'utf8'));
      assert.equal(config.appId, appId);
      assert.equal(config.dev.name, name);
      assert.equal(config.dev.ppLink, `${base}/privacy-policy.html`);
      assert.equal(config.dev.tosLink, `${base}/terms-of-service.html`);
      assert.equal(legalContactForApp(key), 'caijiarong2@xuyins.com');
      for (const [type, suffix] of [['privacy', 'privacy-policy'], ['terms', 'terms-of-service']]) {
        const document = legalDocumentForApp(type, key);
        const html = await readFile(new URL(`../../../deploy/website/static/wowolezi/${suffix}.html`, import.meta.url), 'utf8');
        assert.match(document.contentHtml, /WOWO LEZI CULTURE MEDIA \(HONG KONG\) LIMITED/);
        assert.match(html, /caijiarong2@xuyins\.com/);
        assert.ok(html.includes(`rel="canonical" href="${config.dev[type === 'privacy' ? 'ppLink' : 'tosLink']}"`));
        assert.doesNotMatch(document.introHtml + document.metaHtml + document.contentHtml + html,
          /AUGUST LANE|八月里傳媒|8130888900009268|Cameron Commercial Centre|Breeze and Azure|SAGATHIYA|NEWBEAT DIGITAL/);
      }
    });
  }
});
