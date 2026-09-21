import { io, type Socket } from 'socket.io-client';
import type { Membership, ProfileInput, Reply, RoomAction, RoomSnapshot } from './protocol';

type Entry = { membership: Membership; state: RoomSnapshot };
export class NetworkError extends Error {
  constructor(message: string, readonly code = 'NETWORK') { super(message); }
}
export class Multiplayer {
  private socket: Socket;
  membership: Membership | null = null;
  connected = false;
  private joining = false;
  private clockOffset = 0;
  constructor(private onState: (state: RoomSnapshot) => void, private onConnection: (connected: boolean) => void, private onError: (error: NetworkError) => void) {
    this.socket = io({ autoConnect: false, reconnectionDelay: 500, reconnectionDelayMax: 3000 });
    this.socket.on('room:state', (state: RoomSnapshot) => this.accept(state));
    this.socket.on('disconnect', () => { this.connected = false; this.onConnection(false); });
    this.socket.on('connect', () => {
      if (this.membership && !this.joining) {
        void this.request<Entry>('room:resume', this.membership).then(data => this.enter(data)).catch(e => { this.clear(); this.onError(e); });
      } else { this.connected = true; this.onConnection(true); }
    });
    this.socket.on('connect_error', () => { this.connected = false; this.onConnection(false); });
  }
  private accept(state: RoomSnapshot) {
    if (!this.membership || state.code !== this.membership.code) return;
    this.clockOffset = state.serverTime - Date.now(); this.onState(state);
  }
  serverNow() { return Date.now() + this.clockOffset; }
  private request<T>(event: string, payload: unknown): Promise<T> {
    if (!this.socket.connected) return Promise.reject(new NetworkError('Connection lost. Your seat is held for 60 seconds.'));
    return new Promise((resolve, reject) => this.socket.timeout(8000).emit(event, payload, (error: Error | null, reply: Reply<T>) => {
      if (error) reject(new NetworkError('The server didn’t respond. Reconnect and try again.'));
      else if (!reply.ok) reject(new NetworkError(reply.error, reply.code));
      else resolve(reply.data);
    }));
  }
  private connect() {
    if (this.socket.connected) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); this.socket.off('connect', success); this.socket.off('connect_error', failure); };
      const success = () => { cleanup(); resolve(); };
      const failure = () => { cleanup(); reject(new NetworkError('Couldn’t reach the arena server. Check your connection and try again.')); };
      const timer = setTimeout(failure, 8000);
      this.socket.once('connect', success); this.socket.once('connect_error', failure); this.socket.connect();
    });
  }
  private enter(data: Entry) {
    this.membership = data.membership; this.connected = true;
    try { sessionStorage.setItem(`throwdown-room-${data.membership.code}`, JSON.stringify(data.membership)); } catch { /* In-memory reconnect still works. */ }
    this.onConnection(true); this.accept(data.state);
    return data.membership;
  }
  async join(profile: ProfileInput, code?: string) {
    this.joining = true;
    try {
      await this.connect();
      const data = await this.request<Entry>(code ? 'room:join' : 'room:create', code ? { code, profile } : profile);
      return this.enter(data);
    } finally { this.joining = false; }
  }
  async resume(code: string): Promise<boolean> {
    let saved: Membership | null = null;
    try { const raw = sessionStorage.getItem(`throwdown-room-${code}`); if (raw) saved = JSON.parse(raw); } catch { return false; }
    if (!saved || saved.code !== code) return false;
    this.joining = true;
    try { await this.connect(); this.enter(await this.request<Entry>('room:resume', saved)); return true; }
    catch (e) { if (e instanceof NetworkError && ['INVALID_SESSION', 'NOT_FOUND'].includes(e.code)) { try { sessionStorage.removeItem(`throwdown-room-${code}`); } catch {} } throw e; }
    finally { this.joining = false; }
  }
  async action(action: RoomAction) {
    try { await this.request('room:action', action); }
    catch (e) {
      // A lost acknowledgement must not invite an unsafe second lock; refresh authoritative state first.
      if (this.socket.connected) { try { this.accept(await this.request<RoomSnapshot>('room:sync', {})); } catch {} }
      throw e;
    }
  }
  async sync() { if (this.membership && this.socket.connected) this.accept(await this.request<RoomSnapshot>('room:sync', {})); }
  private clear() {
    if (this.membership) try { sessionStorage.removeItem(`throwdown-room-${this.membership.code}`); } catch {}
    this.membership = null;
  }
  async leave() {
    // Reconnect once for an explicit leave when possible. Otherwise the grace period releases the seat.
    try { if (this.socket.connected) await this.request('room:leave', {}); } finally { this.clear(); this.socket.disconnect(); this.connected = false; }
  }
}
