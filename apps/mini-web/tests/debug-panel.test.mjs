import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { after, it } from 'node:test';

const previousStorage = globalThis.sessionStorage;
const values = new Map();
globalThis.sessionStorage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.endsWith('/lib/debug-panel.ts') && specifier === '../features/ads/ad-platform') {
      return { url: 'data:text/javascript,export const isV006Release = () => true; export const isV006DualRelease = () => globalThis.__debugTestDual;', shortCircuit: true };
    }
    return next(specifier, context);
  }
});
const { activateDebugPanel, debugPanelActive, debugRecordCaptureEnabled } = await import('../src/lib/debug-panel.ts');
after(() => { hooks.deregister(); globalThis.sessionStorage = previousStorage; delete globalThis.__debugTestDual; });

it('captures v006-dual startup records before the easter-egg panel is opened', () => {
  globalThis.__debugTestDual = true;
  assert.equal(debugPanelActive(), false);
  assert.equal(debugRecordCaptureEnabled(), true);
  activateDebugPanel();
  assert.equal(debugPanelActive(), true);
});

it('keeps older v006 record capture activation-gated', () => {
  values.clear();
  globalThis.__debugTestDual = false;
  assert.equal(debugRecordCaptureEnabled(), false);
  activateDebugPanel();
  assert.equal(debugRecordCaptureEnabled(), true);
});
