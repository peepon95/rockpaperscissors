import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LocalMatch, MOVES, resolveRound, type Move, type Score } from '../src/game';

const expected = [
  ['rock', 'rock', 'draw'], ['rock', 'paper', 'cpu'], ['rock', 'scissors', 'player'],
  ['paper', 'rock', 'player'], ['paper', 'paper', 'draw'], ['paper', 'scissors', 'cpu'],
  ['scissors', 'rock', 'cpu'], ['scissors', 'paper', 'player'], ['scissors', 'scissors', 'draw'],
] as const;
for (const [player, cpu, winner] of expected) test(`${player} vs ${cpu}: ${winner}`, () => {
  const original: Score = [0, 0], result = resolveRound(player, cpu, original);
  assert.equal(result.winner, winner);
  assert.deepEqual(result.score, winner === 'draw' ? [0, 0] : winner === 'player' ? [1, 0] : [0, 1]);
  assert.deepEqual(original, [0, 0], 'resolution must not mutate the previous public snapshot');
  assert.equal(result.matchWinner, null);
});
test('first to two ends the match for either side', () => {
  assert.equal(resolveRound('rock', 'scissors', [1, 1]).matchWinner, 'player');
  assert.equal(resolveRound('paper', 'scissors', [1, 1]).matchWinner, 'cpu');
});
test('draws do not advance score, including at match point', () => {
  const r = resolveRound('paper', 'paper', [1, 1]);
  assert.deepEqual(r.score, [1, 1]); assert.equal(r.matchWinner, null);
});
test('rejects out-of-order and duplicate locks', () => {
  const match = new LocalMatch();
  assert.throws(() => match.lock('rock'));
  match.prepare(); assert.throws(() => match.prepare());
  assert.throws(() => match.lock('invalid' as Move));
  match.lock('rock'); assert.throws(() => match.lock('paper'));
});
test('private CPU move is not serialized before reveal', () => {
  const match = new LocalMatch(); match.prepare();
  const snapshot = JSON.parse(JSON.stringify(match));
  assert.deepEqual(snapshot, { score: [0, 0], round: 1 });
  const r = match.lock('paper'); assert.ok(MOVES.includes(r.cpu));
});
test('complete local loop ends at two wins and a new match resets', () => {
  const match = new LocalMatch(() => 'scissors');
  match.prepare(); assert.equal(match.lock('scissors').winner, 'draw');
  match.prepare(); assert.deepEqual(match.lock('rock').score, [1, 0]);
  match.prepare(); assert.deepEqual(match.lock('paper').score, [1, 1]);
  match.prepare(); const final = match.lock('rock');
  assert.equal(final.matchWinner, 'player'); assert.deepEqual(final.score, [2, 1]);
  assert.throws(() => match.prepare()); assert.throws(() => match.lock('rock'));
  const rematch = new LocalMatch(); assert.deepEqual(rematch.score, [0, 0]); assert.equal(rematch.round, 1);
});
test('CPU commitment precedes player choice and runs only once per round', () => {
  let calls = 0;
  const match = new LocalMatch(() => { calls++; return 'rock'; });
  match.prepare(); assert.equal(calls, 1);
  const result = match.lock('paper'); assert.equal(calls, 1); assert.equal(result.cpu, 'rock');
  match.prepare(); assert.equal(calls, 2);
});
