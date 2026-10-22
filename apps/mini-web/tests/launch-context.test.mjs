import assert from 'node:assert/strict';
import { after, it } from 'node:test';
import { registerHooks } from 'node:module';

const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.endsWith('/lib/launch-context.ts')) return next(`${specifier}.ts`, context);
    return next(specifier, context);
  }
});
const { getMiniLaunchContext } = await import('../src/lib/launch-context.ts');
const previousWindow = globalThis.window;
after(() => { hooks.deregister(); globalThis.window = previousWindow; });

it('keeps the raw WebView URL while filtering sensitive parameters from the summary', () => {
  globalThis.window = {
    location: { href: 'https://example.test/watch/album-1/episode-2?campaign=spring&access_token=secret&uid=user-1&redirect_url=https%3A%2F%2Fexample.test', pathname: '/watch/album-1/episode-2', search: '?campaign=spring&access_token=secret&uid=user-1&redirect_url=https%3A%2F%2Fexample.test' },
    TTMinis: { game: { getLaunchOptionsSync: () => ({ scene: 'share', query: { source: 'creator', userId: 'user-1', video_id: 'episode-2', callback: 'https://example.test' } }) } }
  };

  assert.deepEqual(getMiniLaunchContext(), {
    launchScene: 'share',
    launchPath: '/watch/album-1/episode-2',
    launchQuery: { source: 'creator', video_id: 'episode-2', campaign: 'spring' },
    rawUrl: 'https://example.test/watch/album-1/episode-2?campaign=spring&access_token=secret&uid=user-1&redirect_url=https%3A%2F%2Fexample.test'
  });
});
