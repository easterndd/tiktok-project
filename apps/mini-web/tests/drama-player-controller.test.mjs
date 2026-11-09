import assert from 'node:assert/strict';
import { after, it } from 'node:test';
import { registerHooks } from 'node:module';

const mocks = {
  '../../lib/storage': 'export function getStoredLocale() { return "en"; }',
  '../ads/ad-platform': 'export function getAdPlatform() { return globalThis.__playerPlatform ?? "android"; } export function isV006Release() { return true; }',
  '../../lib/diagnostics': 'export function reportDiagnostic() {}',
  './create-player': [
    'export function supportsMp4Mse() { return Boolean(globalThis.window?.MediaSource); }',
    'export function toPlayerSource(info) { return { albumId: info.albumId, episodeId: info.episodeId, vid: info.vid }; }',
    'export async function getDramaPlayerConstructor() { return globalThis.__playerCtor; }',
    'export async function createDramaPlayer(root, info) { return new globalThis.__playerCtor({ root, ...info }); }'
  ].join('\n')
};
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.endsWith('/drama-player-controller.ts') && specifier in mocks) {
      return { url: 'data:text/javascript,' + encodeURIComponent(mocks[specifier]), shortCircuit: true };
    }
    return next(specifier, context);
  }
});
const { DramaPlayerController } = await import('../src/features/player/drama-player-controller.ts');
const originalWindow = globalThis.window;
after(() => {
  hooks.deregister();
  globalThis.window = originalWindow;
  delete globalThis.__playerCtor;
  delete globalThis.__playerPlatform;
});

const info = (episodeId) => ({ albumId: 'album', episodeId, vid: episodeId, playAuthToken: null });
const defer = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const flush = () => new Promise((resolve) => setImmediate(resolve));

it('rebuilds after a timed-out playNext before switching again', async () => {
  const players = [];
  const pending = defer();
  class Player {
    constructor(options) { this.options = options; players.push(this); }
    playNext() { this.nextCalls = (this.nextCalls ?? 0) + 1; return pending.promise; }
    destroy() { this.destroyed = true; }
  }
  globalThis.__playerCtor = Player;
  globalThis.window = {};
  const controller = new DramaPlayerController({}, 10);
  await controller.start(info('one'), [], false);
  const second = controller.switchTo(info('two'), [], false);
  await flush();
  const third = controller.switchTo(info('three'), [], false);
  await assert.rejects(second, /PLAYER_OPERATION_CANCELLED/);
  const latest = await third;
  assert.equal(players.length, 2);
  assert.equal(players[0].nextCalls, 1);
  assert.equal(players[0].destroyed, true);
  assert.equal(latest.options.episodeId, 'three');
  pending.resolve();
  controller.destroy();
});

it('drops stale preload work after a fast switch and cancellation', async () => {
  const preparation = defer();
  const lists = [];
  let clears = 0;
  class Player {
    constructor(options) { this.options = options; }
    playNext() { return Promise.resolve(); }
    destroy() {}
    static prepare() { return preparation.promise; }
    static setMediaInfoCacheConfig() { return Promise.resolve(); }
    static setPreloadScene() { return Promise.resolve(); }
    static setPreloadList(sources) { lists.push(sources.map((source) => source.episodeId)); return Promise.resolve(); }
    static preloader = { clearPreloadList() { clears += 1; }, removeAllPreloadTask() {} };
  }
  globalThis.__playerCtor = Player;
  globalThis.__playerPlatform = 'android';
  globalThis.window = { MediaSource: class {} };
  const controller = new DramaPlayerController({});
  await controller.start(info('one'), [info('one'), info('two')]);
  await controller.switchTo(info('two'), [info('two'), info('three')]);
  controller.cancelPending();
  preparation.resolve();
  await flush();
  await flush();
  assert.deepEqual(lists, []);
  assert.ok(clears >= 1);
  controller.destroy();
});

it('preloads only the current and one next authorized source', async () => {
  const lists = [];
  class Player {
    constructor(options) { this.options = options; }
    destroy() {}
    static prepare() { return Promise.resolve(); }
    static setMediaInfoCacheConfig() { return Promise.resolve(); }
    static setPreloadScene() { return Promise.resolve(); }
    static setPreloadList(sources) { lists.push(sources.map((source) => source.episodeId)); return Promise.resolve(); }
    static preloader = { clearPreloadList() {}, removeAllPreloadTask() {} };
  }
  globalThis.__playerCtor = Player;
  globalThis.__playerPlatform = 'android';
  globalThis.window = { MediaSource: class {} };
  const controller = new DramaPlayerController({});
  await controller.start(info('one'), [info('one'), info('two'), info('three'), { ...info('foreign'), albumId: 'other' }]);
  await controller.updatePreload([info('one'), info('two')]);
  assert.deepEqual(lists.at(-1), ['one', 'two']);
  controller.destroy();
});
