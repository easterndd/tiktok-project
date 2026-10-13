import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { legalContactForApp, legalDocumentForApp } from '../src/pages/legal-docs.ts';

const apps = {
  lucidreel: 'LucidReel', astraclip: 'AstraClip', lumoreel: 'LumoReel',
  orbitplay: 'OrbitPlay', zenclip: 'ZenClip', auraclip: 'AuraClip',
  fluxplay: 'FluxPlay', driftreel: 'DriftReel', novaclip: 'NovaClip',
  lumishort: 'LumiShort'
};
const legalBase = 'https://xuyins.com/static/newbeat';
const operator = 'NEWBEAT DIGITAL MARKETING LIMITED';
const contact = 'caijiarong2@xuyins.com';

describe('NEWBEAT Mini legal pages', () => {
  for (const [key, name] of Object.entries(apps)) {
    it(`${name} uses NEWBEAT policies in the Mini and Portal`, async () => {
      const config = JSON.parse(await readFile(new URL(`../../${key}/minis.config.json`, import.meta.url), 'utf8'));
      assert.equal(config.dev.name, name);
      assert.match(config.appId, /^\d+$/);
      assert.equal(config.dev.ppLink, `${legalBase}/privacy-policy.html`);
      assert.equal(config.dev.tosLink, `${legalBase}/terms-of-service.html`);
      assert.equal(legalContactForApp(key), contact);

      for (const [type, suffix] of [['privacy', 'privacy-policy'], ['terms', 'terms-of-service']]) {
        const document = legalDocumentForApp(type, key);
        const html = await readFile(new URL(`../../../deploy/website/static/newbeat/${suffix}.html`, import.meta.url), 'utf8');
        assert.equal(document.title, type === 'privacy' ? 'Privacy Policy' : 'Terms of Service');
        assert.ok(document.contentHtml.includes(operator));
        assert.ok(document.contentHtml.includes(contact));
        assert.ok(html.includes(operator));
        assert.ok(html.includes(contact));
        assert.ok(html.includes(`rel="canonical" href="${config.dev[type === 'privacy' ? 'ppLink' : 'tosLink']}"`));
        assert.doesNotMatch(html, /Breeze and Azure|SAGATHIYA|evergreenprosper|Hong Kong/i);
        for (const brand of Object.values(apps)) assert.ok(!html.includes(brand));
      }
    });
  }
});
