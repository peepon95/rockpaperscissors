import type { Membership, ProfileInput, Reply, RoomAction, RoomSnapshot } from './protocol';
import { NetworkError } from './multiplayer';

type Entry = { membership: Membership; state: RoomSnapshot };
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const makeCode = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), n => alphabet[n % alphabet.length]).join('');
const endpoint = import.meta.env.VITE_REALTIME_URL as string;

export class CloudMultiplayer {
  private socket: WebSocket | null = null;
  private sequence = 0;
  private pending = new Map<number, { resolve: (data: any) => void; reject: (error: NetworkError) => void; timer: ReturnType<typeof setTimeout> }>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private manualClose = false;
  private joining = false;
  private code = '';
  private clockOffset = 0;
  membership: Membership | null = null;
  connected = false;
  constructor(private onState: (state: RoomSnapshot) => void, private onConnection: (connected: boolean) => void, private onError: (error: NetworkError) => void) {}

  serverNow() { return Date.now() + this.clockOffset; }
  private accept(state: RoomSnapshot) {
    if (!this.membership || state.code !== this.membership.code) return;
    this.clockOffset = state.serverTime - Date.now(); this.onState(state);
  }
  private async connect(code: string): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN && this.code === code) return;
    this.code = code; this.manualClose = false;
    if (this.socket) { this.socket.onclose = null; this.socket.close(); }
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(`${endpoint.replace(/^http/, 'ws').replace(/\/$/, '')}/room/${code}`);
      this.socket = socket;
      const timer = setTimeout(() => { socket.close(); reject(new NetworkError('Couldn’t reach the arena server. Check your connection and try again.')); }, 8000);
      socket.onopen = () => { clearTimeout(timer); this.connected = true; this.onConnection(true); resolve(); };
      socket.onerror = () => { clearTimeout(timer); reject(new NetworkError('Couldn’t reach the arena server. Check your connection and try again.')); };
      socket.onmessage = event => {
        try {
          const message = JSON.parse(event.data);
          if (message.event === 'room:state') this.accept(message.data);
          else if (message.id && this.pending.has(message.id)) {
            const pending = this.pending.get(message.id)!; this.pending.delete(message.id); clearTimeout(pending.timer);
            const reply = message.reply as Reply<unknown>;
            if (reply.ok) pending.resolve(reply.data);
            else pending.reject(new NetworkError(reply.error, reply.code));
          }
        } catch { /* Ignore malformed messages. */ }
      };
      socket.onclose = () => {
        clearTimeout(timer); this.connected = false; this.onConnection(false);
        for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new NetworkError('Connection lost. Your seat is held for 60 seconds.')); }
        this.pending.clear();
        if (this.membership && !this.manualClose) this.scheduleReconnect();
      };
    });
  }
  private request<T>(event: string, payload: unknown): Promise<T> {
    if (this.socket?.readyState !== WebSocket.OPEN) return Promise.reject(new NetworkError('Connection lost. Your seat is held for 60 seconds.'));
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new NetworkError('The server didn’t respond. Reconnect and try again.')); }, 8000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket!.send(JSON.stringify({ id, event, payload }));
    });
  }
  private enter(data: Entry) {
    this.membership = data.membership; this.connected = true;
    try { sessionStorage.setItem(`throwdown-room-${data.membership.code}`, JSON.stringify(data.membership)); } catch { /* Session can still continue in memory. */ }
    this.onConnection(true); this.accept(data.state);
    return data.membership;
  }
  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      const saved = this.membership;
      if (!saved || this.manualClose) return;
      try {
        await this.connect(saved.code);
        this.enter(await this.request<Entry>('room:resume', saved));
      } catch (error) {
        if (error instanceof NetworkError && ['INVALID_SESSION', 'NOT_FOUND'].includes(error.code)) { this.clear(); this.onError(error); }
        else this.scheduleReconnect();
      }
    }, 1200);
  }
  async join(profile: ProfileInput, code?: string) {
    this.joining = true;
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const roomCode = code ?? makeCode();
        await this.connect(roomCode);
        try {
          const data = await this.request<Entry>(code ? 'room:join' : 'room:create', code ? { code, profile } : profile);
          return this.enter(data);
        } catch (error) {
          if (!code && error instanceof NetworkError && error.code === 'CODE_TAKEN') continue;
          throw error;
        }
      }
      throw new NetworkError('Couldn’t reserve an invitation. Try again.');
    } finally { this.joining = false; }
  }
  async resume(code: string): Promise<boolean> {
    let saved: Membership | null = null;
    try { const raw = sessionStorage.getItem(`throwdown-room-${code}`); if (raw) saved = JSON.parse(raw); } catch { return false; }
    if (!saved || saved.code !== code) return false;
    this.joining = true;
    try { await this.connect(code); this.enter(await this.request<Entry>('room:resume', saved)); return true; }
    catch (error) { if (error instanceof NetworkError && ['INVALID_SESSION', 'NOT_FOUND'].includes(error.code)) try { sessionStorage.removeItem(`throwdown-room-${code}`); } catch {} throw error; }
    finally { this.joining = false; }
  }
  async action(action: RoomAction) {
    try { await this.request('room:action', action); }
    catch (error) {
      if (this.connected) try { this.accept(await this.request<RoomSnapshot>('room:sync', {})); } catch {}
      throw error;
    }
  }
  async sync() { if (this.membership && this.connected) this.accept(await this.request<RoomSnapshot>('room:sync', {})); }
  private clear() {
    if (this.membership) try { sessionStorage.removeItem(`throwdown-room-${this.membership.code}`); } catch {}
    this.membership = null;
  }
  async leave() {
    this.manualClose = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    try { if (this.connected) await this.request('room:leave', {}); }
    finally { this.clear(); this.socket?.close(); this.socket = null; this.connected = false; }
  }
}
