import { DurableObject } from 'cloudflare:workers';
import { RoomError, RoomService, type StoredRoom } from '../server/rooms';
import type { Membership, Reply, RoomSnapshot } from '../src/protocol';

interface Env { ROOMS: DurableObjectNamespace<ArenaRoom> }
interface WireRequest { id: number; event: string; payload?: unknown }
interface Attachment { id: string }
const validCode = (code: string) => /^[A-Z2-9]{6}$/.test(code);
const allowedOrigin = (origin: string | null) => {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    return url.origin === 'https://throwdown-rps.pages.dev' ||
      /^https:\/\/[a-z0-9-]+\.throwdown-rps\.pages\.dev$/.test(url.origin) ||
      (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname));
  } catch { return false; }
};

export class ArenaRoom extends DurableObject<Env> {
  private rooms: RoomService;
  private code = '';
  private requests = new Map<string, { start: number; count: number }>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.rooms = new RoomService(snapshot => {
      for (const socket of this.ctx.getWebSockets()) {
        try { socket.send(JSON.stringify({ event: 'room:state', data: snapshot })); } catch { /* Disconnected clients are handled by close. */ }
      }
    });
    ctx.blockConcurrencyWhile(async () => {
      const saved = await ctx.storage.get<StoredRoom>('room');
      if (saved) { this.code = saved.code; this.rooms.restoreRoom(saved); }
    });
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('WebSocket required', { status: 426 });
    const code = new URL(request.url).pathname.split('/').pop() ?? '';
    if (!validCode(code) || (this.code && code !== this.code)) return new Response('Invalid room', { status: 404 });
    this.code = code;
    const [client, server] = Object.values(new WebSocketPair());
    server.serializeAttachment({ id: crypto.randomUUID() } satisfies Attachment);
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  private async persist() {
    const saved = this.rooms.exportRoom(this.code);
    if (saved) await this.ctx.storage.put('room', saved);
    else await this.ctx.storage.delete('room');
    const now = Date.now();
    const due = saved ? [saved.deadline, ...saved.players.map(p => p.reconnectUntil), saved.touchedAt + 2 * 60 * 60 * 1000]
      .filter((time): time is number => time !== null).sort((a, b) => a - b)[0] : undefined;
    if (due) await this.ctx.storage.setAlarm(Math.max(now + 1, due));
    else await this.ctx.storage.deleteAlarm();
  }

  async webSocketMessage(socket: WebSocket, raw: string | ArrayBuffer) {
    const socketId = (socket.deserializeAttachment() as Attachment).id;
    let id = 0;
    try {
      if (typeof raw !== 'string' || raw.length > 16000) throw new RoomError('Invalid message.');
      const message = JSON.parse(raw) as WireRequest;
      id = message.id;
      if (!Number.isSafeInteger(id) || id < 1) throw new RoomError('Invalid request.');
      const now = Date.now(), limit = this.requests.get(socketId);
      if (!limit || now - limit.start > 10000) this.requests.set(socketId, { start: now, count: 1 });
      else if (++limit.count > 35) throw new RoomError('Slow down for a moment.', 'RATE_LIMIT');
      let data: unknown;
      switch (message.event) {
        case 'room:create': {
          if (this.rooms.has(this.code)) throw new RoomError('That invite is already in use. Try again.', 'CODE_TAKEN');
          const membership = this.rooms.createAt(socketId, this.code, message.payload);
          data = { membership, state: this.rooms.snapshot(this.code) };
          break;
        }
        case 'room:join': {
          const input = message.payload as { code: string; profile: unknown };
          if (input?.code !== this.code) throw new RoomError('Invalid invite.', 'NOT_FOUND');
          const membership = this.rooms.join(socketId, this.code, input.profile);
          data = { membership, state: this.rooms.snapshot(this.code) };
          break;
        }
        case 'room:resume': {
          const membership = this.rooms.resume(socketId, message.payload as Membership);
          data = { membership, state: this.rooms.snapshot(this.code) };
          break;
        }
        case 'room:action': this.rooms.action(socketId, message.payload); break;
        case 'room:sync':
          if (!this.rooms.membership(socketId)) throw new RoomError('Join a room first.', 'INVALID_SESSION');
          data = this.rooms.snapshot(this.code); break;
        case 'room:leave': this.rooms.leave(socketId); break;
        default: throw new RoomError('Unknown request.');
      }
      await this.persist();
      socket.send(JSON.stringify({ id, reply: { ok: true, data } satisfies Reply<unknown> }));
    } catch (error) {
      const known = error instanceof RoomError;
      if (!known) console.error('Room request failed', error);
      socket.send(JSON.stringify({ id, reply: { ok: false, error: known ? error.message : 'The arena couldn’t process that action.', code: known ? error.code : 'SERVER_ERROR' } satisfies Reply<unknown> }));
    }
  }

  async webSocketClose(socket: WebSocket) {
    this.rooms.disconnect((socket.deserializeAttachment() as Attachment).id);
    await this.persist();
  }
  async webSocketError(socket: WebSocket) { await this.webSocketClose(socket); }
  async alarm() {
    this.rooms.tick();
    await this.persist();
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health') return Response.json({ ok: true, service: 'arena-rooms' });
    const code = url.pathname.match(/^\/room\/([A-Z2-9]{6})$/)?.[1];
    if (!code) return new Response('Not found', { status: 404 });
    if (!allowedOrigin(request.headers.get('Origin'))) return new Response('Origin not allowed', { status: 403 });
    return env.ROOMS.getByName(code).fetch(request);
  },
};
