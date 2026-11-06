import assert from 'node:assert/strict';
import { it } from 'node:test';
import { episodeDisplayTitle } from '../src/lib/episode-title.ts';

it('renders generic episode numbers in English without replacing an editorial title', () => {
  assert.equal(episodeDisplayTitle('第 1 集', 1), 'Episode 1');
  assert.equal(episodeDisplayTitle('Episode 2', 2), 'Episode 2');
  assert.equal(episodeDisplayTitle('The Reunion', 3), 'The Reunion');
});
