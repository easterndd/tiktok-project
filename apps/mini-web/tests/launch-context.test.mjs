import assert from 'node:assert/strict';
import { after, it } from 'node:test';
import { registerHooks } from 'node:module';

const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.endsWith('/lib/launch-context.ts')) return next(`${specifier}.ts`, context);
    return next(specifier, context);
  }
});
const { getMiniLaunchContext, getMiniLaunchAdId, getCampaignEntryTarget, hasCampaignEntryIntent, rememberSdkLaunchPayload, campaignLaunchOptionsEvent } = await import('../src/lib/launch-context.ts');
const previousWindow = globalThis.window;
after(() => { hooks.deregister(); globalThis.window = previousWindow; });

it('keeps the raw WebView URL while filtering sensitive parameters from the summary', () => {
  globalThis.window = {
    location: { href: 'https://example.test/watch/album-1/episode-2?campaign=spring&access_token=secret&uid=user-1&redirect_url=https%3A%2F%2Fexample.test', pathname: '/watch/album-1/episode-2', search: '?campaign=spring&access_token=secret&uid=user-1&redirect_url=https%3A%2F%2Fexample.test' },
    TTMinis: {}
  };

  assert.deepEqual(getMiniLaunchContext(), {
    launchScene: undefined,
    launchPath: '/watch/album-1/episode-2',
    launchQuery: { campaign: 'spring' },
    webviewBase: 'https://example.test/watch/album-1/episode-2',
    rawUrl: 'https://example.test/watch/album-1/episode-2?campaign=spring&access_token=secret&uid=user-1&redirect_url=https%3A%2F%2Fexample.test'
  });
});

it('reads TikTok campaign episode IDs from the SDK cold-start options', () => {
  globalThis.window = {
    location: { href: 'https://example.test/', pathname: '/', search: '' },
    TTMinis: { game: { getEnterOptionsSync: () => ({ query: { album_id: '7704191617301661704', episode_id: '7704198523106805767' } }) } }
  };
  assert.deepEqual(getCampaignEntryTarget(), { albumId: '7704191617301661704', episodeId: '7704198523106805767' });
});

it('recognizes partial campaign links so they cannot fall through to entry ads', () => {
  rememberSdkLaunchPayload({ query: {} });
  globalThis.window = {
    location: { href: 'https://example.test/?album_id=7704191617301661704', pathname: '/', search: '?album_id=7704191617301661704' },
    TTMinis: {}
  };
  assert.equal(hasCampaignEntryIntent(), true);
  assert.equal(getCampaignEntryTarget(), null);
});

it('notifies launch gates when asynchronous TikTok show options arrive', () => {
  let eventCount = 0;
  globalThis.window = {
    location: { href: 'https://example.test/', pathname: '/', search: '' },
    TTMinis: {},
    dispatchEvent(event) { if (event.type === campaignLaunchOptionsEvent) eventCount += 1; }
  };
  rememberSdkLaunchPayload({ query: { album_id: '7704191617301661704', episode_id: '7704198523106805767' } });
  assert.equal(eventCount, 1);
  assert.deepEqual(getCampaignEntryTarget(), { albumId: '7704191617301661704', episodeId: '7704198523106805767' });
});

it('rejects incomplete or malformed TikTok campaign parameters', () => {
  rememberSdkLaunchPayload({ query: {} });
  globalThis.window = {
    location: { href: 'https://example.test/?album_id=123&episode_id=bad', pathname: '/', search: '?album_id=123&episode_id=bad' },
    TTMinis: {}
  };
  assert.equal(getCampaignEntryTarget(), null);
});

it('uses the official Mini Drama onShow payload for the launch summary', () => {
  globalThis.window = {
    location: { href: 'https://example.test/?ttoclid=click-1', pathname: '/', search: '?ttoclid=click-1' },
    TTMinis: {}
  };
  rememberSdkLaunchPayload({ launch_from: 'ads', query: { source: 'campaign', episode_id: 'ep-2' } });

  assert.deepEqual(getMiniLaunchContext(), {
    launchScene: 'ads',
    launchPath: '/',
    launchQuery: { source: 'campaign', episode_id: 'ep-2', ttoclid: 'click-1' },
    webviewBase: 'https://example.test/',
    rawUrl: 'https://example.test/watch/album-1/episode-2?campaign=spring&access_token=secret&uid=user-1&redirect_url=https%3A%2F%2Fexample.test'
  });
});

it('reads adId from the WebView URL and SDK query with case-insensitive key matching', () => {
  globalThis.window = {
    location: { href: 'https://example.test/?ttoclid=preview&Ad_ID=1879822310597858', pathname: '/', search: '?ttoclid=preview&Ad_ID=1879822310597858' },
    TTMinis: {}
  };
  assert.equal(getMiniLaunchAdId(), '1879822310597858');

  rememberSdkLaunchPayload({ query: { adid: 'sdk-ad-2' } });
  assert.equal(getMiniLaunchAdId(), 'sdk-ad-2');
});
