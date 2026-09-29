import assert from 'node:assert/strict';
import { test } from 'node:test';
import { albumMetadataUpdate, albumTranslationUpdate } from '../src/album-metadata.ts';

test('normalizes locally editable album title and description', () => {
  assert.deepEqual(albumMetadataUpdate('  Target title  ', '  Target description  '), {
    title: 'Target title',
    description: 'Target description'
  });
});

test('allows an empty local description but rejects an empty title', () => {
  assert.deepEqual(albumMetadataUpdate('Target title', '   '), { title: 'Target title', description: '' });
  assert.throws(() => albumMetadataUpdate('   ', 'Description'), /不能为空/);
});

test('builds a localized description update for the current mini app', () => {
  assert.deepEqual(albumTranslationUpdate('shared-album', { locale: 'en', title: ' English title ', description: ' English description ' }), {
    kind: 'album', contentId: 'shared-album', locale: 'en', title: 'English title', description: 'English description', coverUrl: null
  });
});
