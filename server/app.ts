import express from 'express';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { resolve } from 'node:path';
import { Server } from 'socket.io';
import { RoomError, RoomService, type RoomOptions } from './rooms';
import type { Reply } from '../src/protocol';

export function createGameServer(options: RoomOptions = {}) {
  const app = express(); app.disable('x-powered-by');
  const http = createServer(app);
  const io = new Server(http, {
    maxHttpBufferSize: 16 * 1024,
    pingInterval: 10000, pingTimeout: 10000,
    allowRequest(req, done) {
      const origin = req.headers.origin;
      if (!origin) return done(null, true); // Non-browser clients, including protocol tests.
      try { done(null, new URL(origin).host === req.headers.host || (!!process.env.PUBLIC_URL && new URL(origin).origin === new URL(process.env.PUBLIC_URL).origin)); }
      catch { done('Invalid origin', false); }
    },
  });
  const rooms = new RoomService(snapshot => io.to(snapshot.code).emit('room:state', snapshot), options);
  const limiter = new Map<string, { count: number; reset: number }>();
  io.on('connection', socket => {
    let windowStart = Date.now(), actions = 0;
    const handle = (event: string, fn: (input: any) => unknown) => socket.on(event, (input: unknown, ack: (reply: Reply<unknown>) => void) => {
      if (typeof ack !== 'function') return;
      try {
        if (Date.now() - windowStart > 10000) { windowStart = Date.now(); actions = 0; }
        if (++actions > 35) throw new RoomError('Slow down for a moment.', 'RATE_LIMIT');
        ack({ ok: true, data: fn(input) });
      } catch (error) {
        ack({ ok: false, error: error instanceof RoomError ? error.message : 'The arena couldn’t process that action.', code: error instanceof RoomError ? error.code : 'SERVER_ERROR' });
        if (!(error instanceof RoomError)) console.error('Room action failed', error);
      }
    });
    const enter = (membership: ReturnType<RoomService['create']>) => {
      // Clear any previously expired subscriptions before joining a new room.
      for (const code of socket.rooms) if (code !== socket.id) void socket.leave(code);
      void socket.join(membership.code);
      return { membership, state: rooms.snapshot(membership.code) };
    };
    handle('room:create', input => {
      const ip = socket.handshake.address, now = Date.now();
      let limit = limiter.get(ip);
      if (!limit || now > limit.reset) { limit = { count: 0, reset: now + 60000 }; limiter.set(ip, limit); }
      if (++limit.count > 8) throw new RoomError('Too many new rooms. Try again in a minute.', 'RATE_LIMIT');
      return enter(rooms.create(socket.id, input));
    });
    handle('room:join', input => enter(rooms.join(socket.id, input?.code, input?.profile)));
    handle('room:resume', input => enter(rooms.resume(socket.id, input)));
    handle('room:action', input => { rooms.action(socket.id, input); return undefined; });
    handle('room:sync', () => { const membership = rooms.membership(socket.id); if (!membership) throw new RoomError('Join a room first.', 'INVALID_SESSION'); return rooms.snapshot(membership.code); });
    handle('room:leave', () => { const membership = rooms.membership(socket.id); if (membership) { void socket.leave(membership.code); rooms.leave(socket.id); } return undefined; });
    socket.on('disconnect', () => rooms.disconnect(socket.id));
  });
  const timer = setInterval(() => {
    rooms.tick(); for (const [ip, limit] of limiter) if (Date.now() > limit.reset) limiter.delete(ip);
  }, 100); timer.unref();
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/config', (_req, res) => {
    const lan = Object.values(networkInterfaces()).flat().find(n => n?.family === 'IPv4' && !n.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(n.address))?.address;
    res.json({ publicOrigin: process.env.PUBLIC_URL?.replace(/\/$/, '') ?? null, lanOrigin: lan ? `http://${lan}:${process.env.NODE_ENV === 'production' ? process.env.PORT || 3001 : process.env.FRONTEND_PORT || 5173}` : null });
  });
  const dist = resolve('dist');
  app.use(express.static(dist));
  app.get('/{*path}', (req, res) => {
    if (req.path.startsWith('/api/') || req.path.includes('.')) { res.status(404).end(); return; }
    res.sendFile('index.html', { root: dist });
  });
  return {
    http, rooms,
    close: () => new Promise<void>(resolve => { clearInterval(timer); io.close(() => resolve()); }),
  };
}
