import assert from 'node:assert/strict';
import { it } from 'node:test';
import { registerHooks } from 'node:module';

const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.endsWith('/features/player/player-autoplay.ts')) return next(`${specifier}.ts`, context);
    return next(specifier, context);
  }
});
const { createPlayerAutoplay } = await import('../src/features/player/player-autoplay.ts');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

it('retries when play resolves but the player remains paused, then detects playback', async () => {
  let attempts = 0;
  let started = false;
  let fallback = false;
  const player = {
    paused: true,
    play() {
      attempts += 1;
      if (attempts === 2) player.paused = false;
      return Promise.resolve();
    }
  };
  const autoplay = createPlayerAutoplay(() => player, () => { started = true; }, () => { fallback = true; }, { maxAttempts: 3, retryDelayMs: 1 });
  try {
    autoplay.attempt();
    await wait(10);
    assert.equal(attempts, 2);
    assert.equal(started, true);
    assert.equal(fallback, false);
  } finally {
    autoplay.dispose();
    hooks.deregister();
  }
});

it('offers a manual fallback after bounded autoplay attempts', async () => {
  let attempts = 0;
  let fallback = false;
  const player = { paused: true, play: () => { attempts += 1; return Promise.resolve(); } };
  const autoplay = createPlayerAutoplay(() => player, () => assert.fail('playback should remain paused'), () => { fallback = true; }, { maxAttempts: 2, retryDelayMs: 1 });
  try {
    autoplay.attempt();
    await wait(10);
    assert.equal(attempts, 2);
    assert.equal(fallback, true);
  } finally {
    autoplay.dispose();
    hooks.deregister();
  }
});

it('does not issue repeated play calls while a retry is already scheduled', async () => {
  let attempts = 0;
  const player = { paused: true, play: () => { attempts += 1; return Promise.resolve(); } };
  const autoplay = createPlayerAutoplay(() => player, () => {}, () => {}, { maxAttempts: 3, retryDelayMs: 100 });
  try {
    autoplay.attempt();
    await wait(0);
    for (let index = 0; index < 8; index += 1) autoplay.attempt();
    assert.equal(attempts, 1);
  } finally {
    autoplay.dispose();
    hooks.deregister();
  }
});
