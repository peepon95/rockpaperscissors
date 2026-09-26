import { FIGHTERS, MOVES, resolveRound, type Move, type RoundResult, type Score } from '../src/game';
import type { Membership, ProfileInput, PublicPlayer, RoomAction, RoomPhase, RoomSnapshot } from '../src/protocol';

export class RoomError extends Error {
  constructor(message: string, readonly code = 'INVALID_ACTION') { super(message); }
}
interface Member extends PublicPlayer { token: string; socketId: string | null }
interface Room {
  code: string; version: number; hostId: string; players: Map<string, Member>;
  queue: string[]; active: string[]; phase: RoomPhase; deadline: number | null;
  remaining: number | null; paused: boolean; choices: Map<string, Move>;
  score: Score; round: number; matchId: string; result: RoundResult | null;
  winnerId: string | null; rematchVotes: Set<string>; notice: string; touchedAt: number;
}
export type StoredRoom = Omit<Room, 'players' | 'choices' | 'rematchVotes'> & {
  players: Member[]; choices: [string, Move][]; rematchVotes: string[];
};
export interface RoomOptions {
  now?: () => number;
  introMs?: number;
  countdownMs?: number;
  revealMs?: number;
  choiceMs?: number;
  reconnectMs?: number;
  idleMs?: number;
  maxRooms?: number;
}
// All unexposed state (tokens and pending moves) stays here. Every outbound snapshot is explicitly allowlisted.
export class RoomService {
  private rooms = new Map<string, Room>();
  private connections = new Map<string, { code: string; playerId: string }>();
  private now: () => number;
  private config: Required<Omit<RoomOptions, 'now'>>;
  constructor(private publish: (room: RoomSnapshot) => void, options: RoomOptions = {}) {
    this.now = options.now ?? Date.now;
    this.config = { introMs: 6500, countdownMs: 2100, revealMs: 4500, choiceMs: 45000, reconnectMs: 60000, idleMs: 2 * 60 * 60 * 1000, maxRooms: 500, ...options };
  }
  private profile(input: unknown): ProfileInput {
    if (!input || typeof input !== 'object') throw new RoomError('Choose a fighter and a name.');
    const { name, fighterId } = input as ProfileInput;
    if (typeof name !== 'string' || !name.trim() || name.length > 18 || /[\u0000-\u001f\u007f]/.test(name)) throw new RoomError('Use a name between 1 and 18 characters.');
    if (!FIGHTERS.some(f => f.id === fighterId)) throw new RoomError('Choose a fighter from the roster.');
    return { name: name.trim(), fighterId };
  }
  private get(code: unknown) {
    if (typeof code !== 'string' || !/^[A-Z2-9]{6}$/.test(code)) throw new RoomError('That invitation is invalid.', 'NOT_FOUND');
    const room = this.rooms.get(code);
    if (!room) throw new RoomError('This room has expired or the server restarted. Ask for a new invite.', 'NOT_FOUND');
    return room;
  }
  private add(room: Room, socketId: string, profile: ProfileInput): Membership {
    if (this.connections.has(socketId)) throw new RoomError('Leave your current room first.');
    if (room.players.size >= 6) throw new RoomError('This room is full. Six players maximum.', 'ROOM_FULL');
    const member: Member = { ...profile, id: crypto.randomUUID(), token: Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, '0')).join(''), socketId, connected: true, ready: true, locked: false, reconnectUntil: null };
    room.players.set(member.id, member); room.queue.push(member.id);
    if (!room.hostId) room.hostId = member.id;
    this.connections.set(socketId, { code: room.code, playerId: member.id });
    this.update(room);
    return { code: room.code, playerId: member.id, token: member.token };
  }
  create(socketId: string, input: unknown) {
    const profile = this.profile(input);
    if (this.connections.has(socketId)) throw new RoomError('Leave your current room first.');
    if (this.rooms.size >= this.config.maxRooms) throw new RoomError('The arena is busy. Try again shortly.', 'BUSY');
    let code: string;
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    do { code = Array.from(crypto.getRandomValues(new Uint8Array(6)), n => alphabet[n % alphabet.length]).join(''); } while (this.rooms.has(code));
    const room: Room = { code, version: 0, hostId: '', players: new Map(), queue: [], active: [], phase: 'lobby', deadline: null, remaining: null, paused: false, choices: new Map(), score: [0, 0], round: 1, matchId: '', result: null, winnerId: null, rematchVotes: new Set(), notice: '', touchedAt: this.now() };
    this.rooms.set(code, room);
    return this.add(room, socketId, profile);
  }
  // Durable Objects route a room code to one coordinator. The local server keeps its own code generation.
  createAt(socketId: string, code: string, input: unknown) {
    const profile = this.profile(input);
    if (!/^[A-Z2-9]{6}$/.test(code)) throw new RoomError('That invitation is invalid.', 'NOT_FOUND');
    if (this.rooms.has(code)) throw new RoomError('That invite is already in use. Try again.', 'CODE_TAKEN');
    const room: Room = { code, version: 0, hostId: '', players: new Map(), queue: [], active: [], phase: 'lobby', deadline: null, remaining: null, paused: false, choices: new Map(), score: [0, 0], round: 1, matchId: '', result: null, winnerId: null, rematchVotes: new Set(), notice: '', touchedAt: this.now() };
    this.rooms.set(code, room);
    return this.add(room, socketId, profile);
  }
  has(code: string) { return this.rooms.has(code); }
  exportRoom(code: string): StoredRoom | null {
    const room = this.rooms.get(code);
    return room ? { ...room, players: [...room.players.values()], choices: [...room.choices], rematchVotes: [...room.rematchVotes] } : null;
  }
  restoreRoom(saved: StoredRoom) {
    const room: Room = { ...saved, players: new Map(saved.players.map(p => [p.id, p])), choices: new Map(saved.choices), rematchVotes: new Set(saved.rematchVotes) };
    this.rooms.set(room.code, room);
    for (const p of room.players.values()) if (p.socketId) this.connections.set(p.socketId, { code: room.code, playerId: p.id });
  }
  join(socketId: string, code: unknown, input: unknown) { return this.add(this.get(code), socketId, this.profile(input)); }
  resume(socketId: string, input: unknown): Membership {
    if (!input || typeof input !== 'object') throw new RoomError('Invalid reconnect session.', 'INVALID_SESSION');
    const { code, playerId, token } = input as Membership;
    const room = this.get(code), member = room.players.get(playerId);
    if (!member || typeof token !== 'string' || member.token !== token) throw new RoomError('Your seat has expired. Join the room again.', 'INVALID_SESSION');
    if (member.reconnectUntil !== null && member.reconnectUntil <= this.now()) { this.remove(room, member.id); throw new RoomError('Your reconnect window expired. Join the room again.', 'INVALID_SESSION'); }
    if (member.socketId && member.socketId !== socketId) throw new RoomError('This seat is already open in another tab.', 'ALREADY_CONNECTED');
    const current = this.connections.get(socketId);
    if (current && (current.code !== code || current.playerId !== playerId)) throw new RoomError('Leave your current room first.');
    member.socketId = socketId; member.connected = true; member.reconnectUntil = null;
    this.connections.set(socketId, { code, playerId });
    if (room.paused && room.active.every(id => room.players.get(id)?.connected)) {
      room.paused = false; room.deadline = room.remaining === null ? null : this.now() + room.remaining; room.remaining = null;
    }
    this.update(room);
    return { code, playerId, token };
  }
  snapshot(code: string): RoomSnapshot {
    const room = this.get(code);
    return {
      code: room.code, version: room.version, serverTime: this.now(), hostId: room.hostId,
      players: [...room.players.values()].map(p => ({ id: p.id, name: p.name, fighterId: p.fighterId, connected: p.connected, ready: p.ready, locked: room.choices.has(p.id), reconnectUntil: p.reconnectUntil })),
      queue: [...room.queue], active: [...room.active], phase: room.phase, deadline: room.deadline, paused: room.paused,
      round: room.round, matchId: room.matchId, score: [...room.score],
      result: room.result ? { ...room.result, score: [...room.result.score] } : null,
      winnerId: room.winnerId, rematchVotes: [...room.rematchVotes], notice: room.notice,
    };
  }
  membership(socketId: string) { return this.connections.get(socketId); }
  private update(room: Room) { room.version++; room.touchedAt = this.now(); this.publish(this.snapshot(room.code)); }
  private setPhase(room: Room, phase: RoomPhase, duration?: number) { room.phase = phase; room.deadline = duration === undefined ? null : this.now() + duration; }
  private eligible(room: Room) { return room.queue.filter(id => { const p = room.players.get(id); return p?.connected && p.ready; }); }
  private start(room: Room, active: string[]) {
    if (active.length !== 2 || active.some(id => !room.players.get(id)?.connected || !room.players.get(id)?.ready)) throw new RoomError('Two connected, ready fighters are needed.');
    room.active = active; room.queue = room.queue.filter(id => !active.includes(id));
    room.score = [0, 0]; room.round = 1; room.result = null; room.winnerId = null; room.matchId = crypto.randomUUID(); room.choices.clear(); room.rematchVotes.clear(); room.paused = false; room.remaining = null; room.notice = '';
    this.setPhase(room, 'intro', this.config.introMs);
  }
  action(socketId: string, input: unknown) {
    const membership = this.connections.get(socketId);
    if (!membership) throw new RoomError('Join a room first.', 'INVALID_SESSION');
    const room = this.get(membership.code), member = room.players.get(membership.playerId)!;
    if (!input || typeof input !== 'object') throw new RoomError('Invalid action.');
    const action = input as RoomAction;
    switch (action.type) {
      case 'ready':
        if (typeof action.ready !== 'boolean') throw new RoomError('Invalid ready status.');
        if (room.active.includes(member.id)) throw new RoomError('You are already in a fight.');
        member.ready = action.ready; break;
      case 'start':
        if (room.hostId !== member.id || room.phase !== 'lobby') throw new RoomError('Only the host can start from the lobby.');
        this.start(room, this.eligible(room).slice(0, 2)); break;
      case 'choice':
        if (action.matchId !== room.matchId || action.round !== room.round || room.phase !== 'choosing' || room.paused) throw new RoomError('That round is no longer accepting moves.', 'STALE_ROUND');
        if (!room.active.includes(member.id)) throw new RoomError('You are watching this fight.', 'SPECTATOR');
        if (!MOVES.includes(action.move)) throw new RoomError('Invalid move.');
        if (room.choices.has(member.id)) throw new RoomError('Your move is already locked.', 'ALREADY_LOCKED');
        room.choices.set(member.id, action.move);
        if (room.choices.size === 2) this.setPhase(room, 'countdown', this.config.countdownMs);
        break;
      case 'rematch':
        if (room.phase !== 'finished' || action.matchId !== room.matchId || !room.active.includes(member.id)) throw new RoomError('Only the two fighters can request this rematch.');
        if (this.eligible(room).length) throw new RoomError('A challenger is waiting. Let them have their turn.');
        room.rematchVotes.add(member.id);
        if (room.active.every(id => room.rematchVotes.has(id) && room.players.get(id)?.connected)) this.start(room, [...room.active]);
        break;
      case 'next': {
        if (room.phase !== 'finished' || action.matchId !== room.matchId || (room.hostId !== member.id && !room.active.includes(member.id))) throw new RoomError('The host or a fighter can start the next challenge.');
        const winner = room.winnerId, challenger = this.eligible(room)[0];
        if (!winner || !room.players.get(winner)?.connected || !challenger) throw new RoomError('Waiting for a ready challenger.');
        const losers = room.active.filter(id => id !== winner && room.players.has(id));
        room.queue.push(...losers); this.start(room, [winner, challenger]); break;
      }
      default: throw new RoomError('Unknown room action.');
    }
    this.update(room);
  }
  private returnToLobby(room: Room, notice: string) {
    room.queue = [...room.active.filter(id => room.players.has(id)), ...room.queue]; room.active = [];
    room.choices.clear(); room.result = null; room.score = [0, 0]; room.winnerId = null; room.rematchVotes.clear(); room.paused = false; room.remaining = null; room.notice = notice;
    this.setPhase(room, 'lobby');
  }
  private remove(room: Room, playerId: string) {
    const p = room.players.get(playerId); if (!p) return;
    if (p.socketId) this.connections.delete(p.socketId);
    room.players.delete(playerId); room.queue = room.queue.filter(id => id !== playerId);
    if (room.active.includes(playerId)) this.returnToLobby(room, `${p.name} left. Pick the next fight.`);
    if (room.hostId === playerId) room.hostId = [...room.players.values()].find(m => m.connected)?.id ?? [...room.players.keys()][0] ?? '';
    if (!room.players.size) this.rooms.delete(room.code); else this.update(room);
  }
  leave(socketId: string) {
    const membership = this.connections.get(socketId); if (!membership) return;
    const room = this.rooms.get(membership.code); if (room) this.remove(room, membership.playerId);
    this.connections.delete(socketId);
  }
  disconnect(socketId: string) {
    const membership = this.connections.get(socketId); if (!membership) return;
    this.connections.delete(socketId);
    const room = this.rooms.get(membership.code), member = room?.players.get(membership.playerId); if (!room || !member) return;
    member.connected = false; member.socketId = null; member.reconnectUntil = this.now() + this.config.reconnectMs;
    if (room.active.includes(member.id) && room.phase !== 'finished' && !room.paused) {
      room.paused = true; room.remaining = room.deadline === null ? null : Math.max(0, room.deadline - this.now()); room.deadline = null;
    }
    if (room.hostId === member.id) room.hostId = [...room.players.values()].find(p => p.connected)?.id ?? member.id;
    this.update(room);
  }
  tick() {
    for (const room of this.rooms.values()) {
      for (const p of room.players.values()) if (p.reconnectUntil !== null && p.reconnectUntil <= this.now()) this.remove(room, p.id);
      if (!this.rooms.has(room.code)) continue;
      if (this.now() - room.touchedAt >= this.config.idleMs) {
        // Disconnect idle sessions through the transport's expiry notification.
        for (const p of room.players.values()) if (p.socketId) this.connections.delete(p.socketId);
        room.notice = 'This room expired after two hours of inactivity.'; room.phase = 'lobby'; room.active = []; room.queue = []; room.choices.clear(); room.result = null; room.deadline = null; room.paused = false; room.players.clear(); this.update(room); this.rooms.delete(room.code); continue;
      }
      if (room.paused || room.deadline === null || room.deadline > this.now()) continue;
      if (room.phase === 'intro') this.setPhase(room, 'choosing', this.config.choiceMs);
      else if (room.phase === 'choosing') {
        for (const id of room.active) if (!room.choices.has(id)) room.players.get(id)!.ready = false;
        this.returnToLobby(room, 'A fighter ran out of time. Ready up to fight again.');
      }
      else if (room.phase === 'countdown') {
        const [a, b] = room.active;
        room.result = resolveRound(room.choices.get(a)!, room.choices.get(b)!, room.score);
        room.score = [...room.result.score]; room.winnerId = room.result.matchWinner ? room.active[room.result.matchWinner === 'player' ? 0 : 1] : null;
        this.setPhase(room, 'reveal', this.config.revealMs);
      } else if (room.phase === 'reveal') {
        room.choices.clear();
        if (room.winnerId) this.setPhase(room, 'finished');
        else { room.round++; room.result = null; this.setPhase(room, 'choosing', this.config.choiceMs); }
      }
      this.update(room);
    }
  }
}
