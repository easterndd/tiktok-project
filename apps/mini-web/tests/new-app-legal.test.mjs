import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { legalContactForApp, legalDocumentForApp } from '../src/pages/legal-docs.ts';

const apps = {
  crownrush: 'CrownRush',
  sugarreel: 'SugarReel',
  crimsonshorts: 'CrimsonShorts',
  sweetreel: 'SweetReel', dramablaze: 'DramaBlaze', heartreel: 'HeartReel',
  dramahit: 'DramaHit', crownreel: 'CrownReel', luxereel: 'LuxeReel', elitedrama: 'EliteDrama'
};
const legalBase = 'https://xuyins.com/static';
const operator = 'Breeze and Azure Sky Culture Limited';
const chineseLegalName = '長風碧雲文化傳媒有限公司';
const contact = 'caijiarong@xuyins.com';

describe('Breeze Mini legal pages', () => {
  for (const [key, name] of Object.entries(apps)) {
    it(`${name} uses the shared brand-neutral policy in the Mini and Portal`, async () => {
      const config = JSON.parse(await readFile(new URL(`../../${key}/minis.config.json`, import.meta.url), 'utf8'));
      assert.equal(config.dev.name, name);
      assert.equal(config.dev.ppLink, `${legalBase}/privacy-policy.html`);
      assert.equal(config.dev.tosLink, `${legalBase}/terms-of-service.html`);
      assert.equal(legalContactForApp(key), contact);

      for (const [type, suffix, related] of [
        ['privacy', 'privacy-policy', config.dev.tosLink],
        ['terms', 'terms-of-service', config.dev.ppLink]
      ]) {
        const document = legalDocumentForApp(type, key);
        const html = await readFile(new URL(`../../../deploy/website/static/${suffix}.html`, import.meta.url), 'utf8');
        assert.equal(document.title, type === 'privacy' ? 'Privacy Policy' : 'Terms of Service');
        for (const expected of [operator, chineseLegalName, contact]) {
          assert.ok(document.introHtml.includes(expected) || document.contentHtml.includes(expected));
          assert.ok(html.includes(expected), `${key} ${type}: missing ${expected}`);
        }
        for (const brand of Object.values(apps)) {
          assert.ok(!html.includes(brand), `shared ${type} page contains ${brand}`);
          assert.ok(!document.contentHtml.includes(brand), `${key} ${type} contains ${brand}`);
        }
        assert.ok(html.includes(`rel="canonical" href="${config.dev[type === 'privacy' ? 'ppLink' : 'tosLink']}"`));
        assert.ok(html.includes(`href="${related}"`));
        assert.doesNotMatch(html, /QuicK ReeLS|evergreenprosper|SAGATHIYA|caixuwen@xuyins\.com/i);
        if (['crownrush', 'sugarreel', 'crimsonshorts'].includes(key)) {
          const legacyHtml = await readFile(new URL(`../../../deploy/website/static/${key}-${suffix}.html`, import.meta.url), 'utf8');
          assert.equal(legacyHtml, html);
        }
      }
    });
  }
});
