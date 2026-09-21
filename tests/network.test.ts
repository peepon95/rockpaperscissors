import { test } from 'node:test';
import assert from 'node:assert/strict';
import { io, type Socket } from 'socket.io-client';
import type { AddressInfo } from 'node:net';
import { createGameServer } from '../server/app';
import type { Membership, Reply, RoomSnapshot } from '../src/protocol';

test('real sockets: six clients, hidden choices, reveal, reconnect and room isolation', { timeout: 15000 }, async () => {
  const server = createGameServer({ introMs: 60, countdownMs: 120, revealMs: 120, choiceMs: 5000 });
  await new Promise<void>(resolve => server.http.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.http.address() as AddressInfo).port}`;
  const clients: Socket[] = [];
  async function connect() {
    const socket = io(url, { transports: ['websocket'], forceNew: true, reconnection: false }); clients.push(socket);
    await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); }); return socket;
  }
  function request<T = unknown>(socket: Socket, event: string, payload: unknown): Promise<Reply<T>> {
    return new Promise((resolve, reject) => socket.timeout(2000).emit(event, payload, (error: Error, reply: Reply<T>) => error ? reject(error) : resolve(reply)));
  }
  function state(socket: Socket, predicate: (state: RoomSnapshot) => boolean) {
    return new Promise<RoomSnapshot>((resolve, reject) => {
      const timer = setTimeout(() => { socket.off('room:state', listener); reject(new Error('Timed out waiting for room state')); }, 3000);
      const listener = (s: RoomSnapshot) => { if (predicate(s)) { clearTimeout(timer); socket.off('room:state', listener); resolve(s); } }; socket.on('room:state', listener);
    });
  }
  try {
    const a = await connect();
    const created = await request<{ membership: Membership; state: RoomSnapshot }>(a, 'room:create', { name: 'Alpha', fighterId: 'brick' }); assert.ok(created.ok);
    const code = created.data.membership.code, members: Membership[] = [created.data.membership];
    const snapshots: RoomSnapshot[] = []; a.on('room:state', s => snapshots.push(s));
    for (let i = 1; i < 6; i++) { const c = await connect(); const joined = await request<{ membership: Membership }>(c, 'room:join', { code, profile: { name: `Friend ${i}`, fighterId: 'phantom' } }); assert.ok(joined.ok); members.push(joined.data.membership); }
    const extra = await connect(); const full = await request(extra, 'room:join', { code, profile: { name: 'Seventh', fighterId: 'bolt' } }); assert.equal(full.ok, false);
    const isolated: RoomSnapshot[] = []; extra.on('room:state', s => isolated.push(s));
    assert.ok((await request(extra, 'room:create', { name: 'Separate', fighterId: 'zen' })).ok);
    const choosing = state(a, s => s.phase === 'choosing'); assert.ok((await request(a, 'room:action', { type: 'start' })).ok);
    const s = await choosing, move = { type: 'choice', move: 'rock', matchId: s.matchId, round: s.round };
    const spectator = await request(clients[2], 'room:action', move); assert.equal(spectator.ok, false);
    assert.ok((await request(a, 'room:action', move)).ok);
    assert.equal(snapshots.at(-1)?.result, null); assert.ok(!JSON.stringify(snapshots).includes(created.data.membership.token));
    const reveal = state(a, s => s.phase === 'reveal'); assert.ok((await request(clients[1], 'room:action', { ...move, move: 'scissors' })).ok);
    assert.equal(snapshots.at(-1)?.phase, 'countdown'); assert.equal(snapshots.at(-1)?.result, null);
    const revealed = await reveal; assert.equal(revealed.result?.winner, 'player'); assert.deepEqual(revealed.score, [1, 0]);
    assert.equal(isolated.length, 0, 'unrelated room receives no match events');
    const paused = state(a, s => s.paused); clients[1].disconnect(); await paused;
    const replacement = await connect(); const rejoined = await request<{ state: RoomSnapshot }>(replacement, 'room:resume', members[1]); assert.ok(rejoined.ok); assert.equal(rejoined.data.state.paused, false); assert.equal(rejoined.data.state.players.length, 6);
    const spoof = await request(extra, 'room:resume', { ...members[0], token: 'not-the-secret' }); assert.equal(spoof.ok, false);
    const health = await fetch(`${url}/api/health`); assert.equal(health.status, 200);
    const deepLink = await fetch(`${url}/fight/${code}`); assert.equal(deepLink.status, 200); assert.match(await deepLink.text(), /THROW DOWN/);
  } finally { clients.forEach(c => c.disconnect()); await server.close(); }
});
