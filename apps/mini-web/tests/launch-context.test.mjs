import assert from 'node:assert/strict';
import { after, it } from 'node:test';
import { registerHooks } from 'node:module';

const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.endsWith('/lib/launch-context.ts')) return next(`${specifier}.ts`, context);
    return next(specifier, context);
  }
});
const { getMiniLaunchContext, rememberSdkLaunchPayload } = await import('../src/lib/launch-context.ts');
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
    rawUrl: 'https://example.test/watch/album-1/episode-2?campaign=spring&access_token=secret&uid=user-1&redirect_url=https%3A%2F%2Fexample.test'
  });
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
    rawUrl: 'https://example.test/watch/album-1/episode-2?campaign=spring&access_token=secret&uid=user-1&redirect_url=https%3A%2F%2Fexample.test'
  });
});
