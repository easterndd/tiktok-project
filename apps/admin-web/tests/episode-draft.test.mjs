import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultEpisodeTitle, nextEpisodeNo, renumberEpisodes, resolveAppendEpisodes } from '../src/episode-draft.ts';

const episodes = [
  { localId: 'one', episodeNo: 1, title: '第 1 集', sortOrder: 1 },
  { localId: 'two', episodeNo: 2, title: '第 2 集', sortOrder: 2 },
  { localId: 'three', episodeNo: 3, title: '特别篇', sortOrder: 3 }
];

test('starting at episode 4 renumbers following rows and their default titles', () => {
  const renumbered = renumberEpisodes(episodes, 'one', 4);
  assert.deepEqual(renumbered.map(({ episodeNo, title }) => [episodeNo, title]), [
    [4, '第 4 集'],
    [5, '第 5 集'],
    [6, '特别篇']
  ]);
  assert.equal(nextEpisodeNo(renumbered), 7);
  assert.equal(defaultEpisodeTitle(nextEpisodeNo(renumbered)), '第 7 集');
  assert.deepEqual(renumbered.map(({ sortOrder }) => sortOrder), [1, 2, 3]);
  assert.equal(episodes[0].episodeNo, 1);
});

test('editing a middle episode only renumbers it and later episodes', () => {
  const renumbered = renumberEpisodes(episodes, 'two', 8);
  assert.deepEqual(renumbered.map(({ episodeNo }) => episodeNo), [1, 8, 9]);
  assert.equal(renumbered[1].title, '第 8 集');
});

test('invalid episode numbers do not change the draft', () => {
  assert.deepEqual(renumberEpisodes(episodes, 'one', 0), episodes);
  assert.deepEqual(renumberEpisodes(episodes, 'one', 2.5), episodes);
  assert.deepEqual(renumberEpisodes(episodes, 'missing', 4), episodes);
  assert.equal(nextEpisodeNo([]), 1);
});

test('reuses an existing episode without a BytePlus VID when repairing its video', () => {
  const existing = [
    { id: 'episode-1', episodeNo: 1, title: '第 1 集', sortOrder: 1, byteplusVid: null },
    { id: 'episode-2', episodeNo: 2, title: '第 2 集', sortOrder: 2, byteplusVid: 'vid-2' }
  ];
  const [draft] = resolveAppendEpisodes([
    { localId: 'draft-1', episodeNo: 1, title: '第 1 集', sortOrder: 1, uploadStatus: '已上传' }
  ], existing);

  assert.equal(draft.savedEpisodeId, 'episode-1');
  assert.equal(draft.uploadStatus, undefined);
});

test('does not rebind an episode that already has a BytePlus VID', () => {
  const [draft] = resolveAppendEpisodes([
    { localId: 'draft-2', episodeNo: 2, title: '第 2 集', sortOrder: 2 }
  ], [{ id: 'episode-2', episodeNo: 2, title: '第 2 集', sortOrder: 2, byteplusVid: 'vid-2' }]);

  assert.equal(draft.savedEpisodeId, undefined);
});

test('clears stale uploaded state when the existing episode still has no VID', () => {
  const [draft] = resolveAppendEpisodes([
    { localId: 'draft-1', episodeNo: 1, title: '第 1 集', sortOrder: 1,
      savedEpisodeId: 'episode-1', uploadStatus: '已上传' }
  ], [{ id: 'episode-1', episodeNo: 1, title: '第 1 集', sortOrder: 1, byteplusVid: null }]);

  assert.equal(draft.uploadStatus, undefined);
});

test('keeps new episode numbers available for append', () => {
  const [draft] = resolveAppendEpisodes([
    { localId: 'draft-31', episodeNo: 31, title: '第 31 集', sortOrder: 31 }
  ], [{ id: 'episode-30', episodeNo: 30, title: '第 30 集', sortOrder: 30, byteplusVid: 'vid-30' }]);

  assert.equal(draft.savedEpisodeId, undefined);
});
