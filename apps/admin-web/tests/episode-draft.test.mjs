import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultEpisodeTitle, nextEpisodeNo, renumberEpisodes } from '../src/episode-draft.ts';

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
