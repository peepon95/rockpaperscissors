// Run against a local `wrangler dev --port 8787` or a deployed Worker.
import assert from 'node:assert/strict';
import WebSocket from 'ws';

const base = process.env.ARENA_WS_URL ?? 'ws://localhost:8787';
const origin = process.env.ARENA_ORIGIN ?? 'http://localhost:5173';
const code = 'T' + Array.from(crypto.getRandomValues(new Uint8Array(5)), n => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[n % 32]).join('');
const open = () => new Promise((resolve, reject) => {
  const socket = new WebSocket(`${base}/room/${code}`, { headers: { Origin: origin } });
  socket.once('open', () => resolve(socket)); socket.once('error', reject);
});
function client(socket) {
  let id = 0;
  const pending = new Map(), states = [];
  socket.on('message', raw => {
    const message = JSON.parse(String(raw));
    if (message.event === 'room:state') states.push(message.data);
    else if (pending.has(message.id)) { pending.get(message.id)(message.reply); pending.delete(message.id); }
  });
  return {
    states,
    request: (event, payload) => new Promise(resolve => { const next = ++id; pending.set(next, resolve); socket.send(JSON.stringify({ id: next, event, payload })); }),
  };
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const aSocket = await open(), bSocket = await open();
const a = client(aSocket), b = client(bSocket);
try {
  const created = await a.request('room:create', { name: 'Alpha', fighterId: 'brick' });
  assert.equal(created.ok, true, JSON.stringify(created));
  const joined = await b.request('room:join', { code, profile: { name: 'Beta', fighterId: 'phantom' } });
  assert.equal(joined.ok, true, JSON.stringify(joined));
  assert.equal(joined.data.state.players.length, 2);
  const started = await a.request('room:action', { type: 'start' });
  assert.equal(started.ok, true, JSON.stringify(started));
  await wait(6900);
  let state = (await a.request('room:sync', {})).data;
  assert.equal(state.phase, 'choosing');
  const rock = await a.request('room:action', { type: 'choice', move: 'rock', round: state.round, matchId: state.matchId });
  assert.equal(rock.ok, true, JSON.stringify(rock));
  state = (await b.request('room:sync', {})).data;
  assert.equal(state.players[0].locked, true);
  assert.equal(JSON.stringify(state).includes('"rock"'), false, 'move must stay private before reveal');
  const scissors = await b.request('room:action', { type: 'choice', move: 'scissors', round: state.round, matchId: state.matchId });
  assert.equal(scissors.ok, true, JSON.stringify(scissors));
  await wait(2400);
  state = (await a.request('room:sync', {})).data;
  assert.equal(state.phase, 'reveal');
  assert.deepEqual(state.score, [1, 0]);
  assert.equal(state.result.headline, 'ROCK CRUSHES SCISSORS');
  console.log(`Cloud room passed: ${code}, two players, private choice, reveal and score.`);
} finally { aSocket.close(); bSocket.close(); }
