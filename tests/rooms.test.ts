import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoomService, RoomError } from '../server/rooms';
import type { RoomSnapshot } from '../src/protocol';
import type { Move } from '../src/game';

function setup(count = 2) {
  let now = 1000;
  const emitted: RoomSnapshot[] = [];
  const service = new RoomService(s => emitted.push(s), { now: () => now, introMs: 10, countdownMs: 10, revealMs: 10, choiceMs: 100, reconnectMs: 1000, idleMs: 10000 });
  const host = service.create('s0', { name: 'Host', fighterId: 'brick' });
  const members = [host];
  for (let i = 1; i < count; i++) members.push(service.join(`s${i}`, host.code, { name: `Friend ${i}`, fighterId: 'phantom' }));
  const snapshot = () => service.snapshot(host.code);
  const advance = (ms = 11) => { now += ms; service.tick(); };
  const start = () => { service.action('s0', { type: 'start' }); advance(); };
  const choice = (socketId: string, move: Move) => service.action(socketId, { type: 'choice', move, round: snapshot().round, matchId: snapshot().matchId });
  const round = (a: Move = 'rock', b: Move = 'scissors') => { choice('s0', a); choice('s1', b); advance(); advance(); };
  return { service, host, members, snapshot, advance, start, choice, round, emitted };
}
test('six seats max; reject invalid profiles, nonexistent rooms and already joined connections', () => {
  const { service, host, snapshot } = setup(6);
  assert.equal(snapshot().players.length, 6);
  assert.throws(() => service.join('s7', host.code, { name: 'Seventh', fighterId: 'brick' }), e => e instanceof RoomError && e.code === 'ROOM_FULL');
  assert.throws(() => service.create('x', { name: 'x', fighterId: 'invalid' }));
  assert.throws(() => service.create('x', { name: 'x'.repeat(19), fighterId: 'brick' }));
  assert.throws(() => service.join('x', 'AAAAAA', { name: 'x', fighterId: 'brick' }));
  assert.throws(() => service.create('s0', { name: 'x', fighterId: 'brick' }));
});
test('host starts two ready fighters; spectators cannot start or choose', () => {
  const { service, snapshot, start, choice } = setup(3);
  assert.throws(() => service.action('s1', { type: 'start' })); start();
  assert.equal(snapshot().active.length, 2); assert.equal(snapshot().queue.length, 1);
  assert.throws(() => choice('s2', 'rock'), e => e instanceof RoomError && e.code === 'SPECTATOR');
});
test('no public choice or token before reveal, even after both players lock', () => {
  const { start, choice, snapshot, advance, host } = setup(); start();
  choice('s0', 'rock');
  assert.equal(snapshot().players[0].locked, true); assert.equal(snapshot().result, null);
  let publicText = JSON.stringify(snapshot());
  assert.ok(!publicText.includes('rock')); assert.ok(!publicText.includes(host.token)); assert.ok(!publicText.includes('socketId')); assert.ok(!publicText.includes('token'));
  choice('s1', 'scissors'); assert.equal(snapshot().phase, 'countdown'); assert.equal(snapshot().result, null);
  publicText = JSON.stringify(snapshot()); assert.ok(!publicText.includes('scissors')); assert.ok(!publicText.includes('rock'));
  advance(); assert.equal(snapshot().result?.player, 'rock'); assert.equal(snapshot().result?.cpu, 'scissors'); assert.deepEqual(snapshot().score, [1, 0]);
});
test('reject duplicate, malformed, stale and out-of-phase moves', () => {
  const { service, snapshot, start, choice, round, advance } = setup();
  assert.throws(() => choice('s0', 'rock')); start();
  assert.throws(() => choice('s0', 'invalid' as Move));
  assert.throws(() => service.action('s0', { type: 'choice', move: 'rock', round: 1, matchId: 'old' }));
  const old = { type: 'choice', move: 'rock', round: snapshot().round, matchId: snapshot().matchId };
  choice('s0', 'rock'); assert.throws(() => choice('s0', 'paper')); choice('s1', 'scissors');
  assert.throws(() => choice('s1', 'rock')); advance(); advance();
  assert.throws(() => service.action('s0', old)); round(); assert.equal(snapshot().phase, 'finished');
  assert.throws(() => choice('s0', 'paper'));
});
test('draws do not score; first to two wins; rematch requires both votes and resets', () => {
  const { service, host, start, round, snapshot } = setup(); start();
  round('paper', 'paper'); assert.deepEqual(snapshot().score, [0, 0]); assert.equal(snapshot().round, 2);
  round(); round(); assert.equal(snapshot().phase, 'finished'); assert.equal(snapshot().winnerId, host.playerId);
  const matchId = snapshot().matchId;
  service.action('s0', { type: 'rematch', matchId }); assert.equal(snapshot().phase, 'finished');
  service.action('s1', { type: 'rematch', matchId }); assert.equal(snapshot().phase, 'intro');
  assert.notEqual(snapshot().matchId, matchId); assert.deepEqual(snapshot().score, [0, 0]); assert.equal(snapshot().round, 1);
});
test('winner stays and next challenger rotates in FIFO order; loser joins back of queue', () => {
  const { service, start, round, snapshot, members } = setup(6); start(); round(); round();
  const matchId = snapshot().matchId;
  assert.throws(() => service.action('s0', { type: 'rematch', matchId }));
  assert.throws(() => service.action('s4', { type: 'next', matchId }));
  service.action('s0', { type: 'next', matchId });
  assert.deepEqual(snapshot().active, [members[0].playerId, members[2].playerId]);
  assert.deepEqual(snapshot().queue, [members[3].playerId, members[4].playerId, members[5].playerId, members[1].playerId]);
  assert.deepEqual(snapshot().score, [0, 0]); assert.equal(snapshot().phase, 'intro');
});
test('spectators can ready/unready; unready seats are skipped', () => {
  const { service, snapshot, members, start, round } = setup(4); start();
  service.action('s2', { type: 'ready', ready: false });
  assert.throws(() => service.action('s0', { type: 'ready', ready: false }));
  round(); round(); service.action('s0', { type: 'next', matchId: snapshot().matchId });
  assert.equal(snapshot().active[1], members[3].playerId);
});
test('disconnect pauses round, authenticates reconnect, preserves hidden lock and remaining time', () => {
  const { service, start, choice, advance, snapshot, members } = setup(); start(); choice('s0', 'paper');
  service.disconnect('s0'); assert.ok(snapshot().paused); assert.equal(snapshot().deadline, null);
  advance(500); assert.equal(snapshot().phase, 'choosing');
  assert.throws(() => service.resume('hijacker', { ...members[0], token: 'wrong' }));
  service.resume('replacement', members[0]); assert.equal(snapshot().paused, false); assert.ok(snapshot().players[0].locked); assert.equal(snapshot().result, null);
  assert.throws(() => service.resume('another', members[0]));
  choice('s1', 'rock'); advance(); assert.equal(snapshot().result?.winner, 'player');
});
test('disconnect during reveal does not award the result twice', () => {
  const { service, start, choice, advance, snapshot, members } = setup(); start(); choice('s0', 'rock'); choice('s1', 'scissors'); advance();
  assert.deepEqual(snapshot().score, [1, 0]); service.disconnect('s1'); advance(100); service.resume('s1-new', members[1]); advance();
  assert.deepEqual(snapshot().score, [1, 0]); assert.equal(snapshot().phase, 'choosing'); assert.equal(snapshot().round, 2);
});
test('disconnect expiry frees a seat, returns active fight to lobby and transfers host', () => {
  const { service, start, snapshot, advance, members } = setup(3); start(); service.disconnect('s0');
  assert.equal(snapshot().hostId, members[1].playerId); advance(1001);
  assert.equal(snapshot().players.length, 2); assert.equal(snapshot().phase, 'lobby'); assert.deepEqual(snapshot().active, []); assert.equal(snapshot().paused, false);
  assert.throws(() => service.resume('reconnect', members[0]));
  service.action('s1', { type: 'start' }); assert.equal(snapshot().phase, 'intro');
});
test('spectator disconnection does not pause a fight; explicit leave frees seat immediately', () => {
  const { service, start, snapshot, host } = setup(6); start(); service.disconnect('s5'); assert.equal(snapshot().paused, false);
  service.leave('s4'); assert.equal(snapshot().players.length, 5);
  service.join('new', host.code, { name: 'New', fighterId: 'zen' }); assert.equal(snapshot().players.length, 6);
});
test('choice timeout returns lobby and marks missing player unready without guessing their move', () => {
  const { start, choice, advance, snapshot } = setup(); start(); choice('s0', 'rock'); advance(101);
  assert.equal(snapshot().phase, 'lobby'); assert.equal(snapshot().result, null); assert.deepEqual(snapshot().score, [0, 0]);
  assert.equal(snapshot().players[0].ready, true); assert.equal(snapshot().players[1].ready, false);
});
test('empty rooms and inactive rooms expire cleanly', () => {
  const { service, host, advance } = setup(1); service.leave('s0'); assert.throws(() => service.snapshot(host.code));
  const other = service.create('new', { name: 'Other', fighterId: 'brick' }); advance(10001);
  assert.throws(() => service.snapshot(other.code)); assert.equal(service.membership('new'), undefined);
});
