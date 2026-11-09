import assert from 'node:assert/strict';
import { it } from 'node:test';
import { registerHooks } from 'node:module';

const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.endsWith('/features/ads/ad-activity.ts') && specifier === './ad-platform') {
      return { url: 'data:text/javascript,export const getAdPlatform = () => "android";', shortCircuit: true };
    }
    return next(specifier, context);
  }
});
const { claimNativeAd, nativeAdActive, resetAdActivityForTests, subscribeNativeAdIdle } = await import('../src/features/ads/ad-activity.ts');

it('notifies player listeners once the native release cooldown ends', async () => {
  let notifications = 0;
  const unsubscribe = subscribeNativeAdIdle(() => { notifications += 1; });
  try {
    const release = claimNativeAd('rewarded');
    assert.ok(release);
    release();
    release();
    assert.equal(nativeAdActive(), true);
    assert.equal(notifications, 0);
    await new Promise((resolve) => setTimeout(resolve, 330));
    assert.equal(nativeAdActive(), false);
    assert.equal(notifications, 1);
  } finally {
    unsubscribe();
    resetAdActivityForTests();
    hooks.deregister();
  }
});
