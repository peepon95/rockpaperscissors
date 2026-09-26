import type { Arena } from './arena';
import type { AudioDirector } from './audio';
import { FIGHTERS, MOVES, type Move } from './game';
import { Multiplayer, NetworkError } from './multiplayer';
import { CloudMultiplayer } from './cloud-multiplayer';
import type { ProfileInput, PublicPlayer, RoomSnapshot } from './protocol';

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const symbols: Record<Move, string> = { rock: '✊', paper: '✋', scissors: '✌' };
export class FriendsRoom {
  state: RoomSnapshot | null = null;
  network: Multiplayer | CloudMultiplayer;
  inviteOrigin = location.origin;
  inviteScope = 'Share this link with your friends.';
  private selected: Move | null = null;
  private pending = false;
  private visualKey = '';
  private fightersKey = '';
  private tickKey = '';
  private sceneKey = '';
  private timer: ReturnType<typeof setInterval>;
  private timers: ReturnType<typeof setTimeout>[] = [];
  constructor(private arena: Arena, private audio: AudioDirector, private refresh: () => void, private message: (text: string) => void) {
    const Transport = import.meta.env.VITE_REALTIME_URL ? CloudMultiplayer : Multiplayer;
    this.network = new Transport(s => this.receive(s), () => { if (this.state) this.refresh(); }, e => { this.state = null; this.clearTimers(); this.message(e.message); this.refresh(); });
    this.timer = setInterval(() => {
      const s = this.state; if (!s) return;
      const key = `${s.phase}:${this.seconds()}:${s.paused}`;
      if (key !== this.tickKey && ['intro', 'countdown', 'choosing'].includes(s.phase) && !s.paused) {
        this.tickKey = key;
        if (s.phase === 'choosing') {
          // Keep focused controls and open dialogs stable while the time display changes.
          const clock = document.querySelector('.friends-fight .pick-heading small'); if (clock) clock.textContent = `${this.seconds()}s TO CHOOSE`;
        } else { this.animate(); this.refresh(); }
      }
    }, 150);
    void this.loadInviteOrigin();
    document.addEventListener('visibilitychange', () => { if (!document.hidden) void this.network.sync().catch(() => {}); });
  }
  private async loadInviteOrigin() {
    if (import.meta.env.VITE_REALTIME_URL) {
      this.inviteScope = 'Anyone with this link can join. Six players maximum.';
      return;
    }
    try {
      const response = await fetch('/api/config', { signal: AbortSignal.timeout(3000) });
      if (!response.ok) throw new Error('Configuration unavailable');
      const config = await response.json();
      if (config.publicOrigin) { this.inviteOrigin = config.publicOrigin; this.inviteScope = 'Anyone with this link can join. Six players maximum.'; }
      else {
        if (['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) && config.lanOrigin) this.inviteOrigin = config.lanOrigin;
        this.inviteScope = 'Local room: friends must use the same Wi-Fi. Online invites need a public deployment.';
      }
      if (this.state) this.refresh();
    } catch { this.inviteScope = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) ? 'Open the game using the computer’s Wi-Fi address before copying a phone invite.' : 'Share this link on the same network. Online invites need a public deployment.'; }
  }
  private receive(s: RoomSnapshot) {
    if (this.state?.code === s.code && this.state.version > s.version) return;
    this.state = s;
    if (!s.players.some(p => p.id === this.network.membership?.playerId)) { this.clearTimers(); this.message(s.notice || 'Your seat has expired.'); }
    const key = `${s.matchId}:${s.round}:${s.phase}`;
    if (key !== this.visualKey) { this.selected = null; this.pending = false; this.visualKey = key; }
    this.animate(); this.refresh();
  }
  private clearTimers() { this.timers.forEach(clearTimeout); this.timers = []; }
  private after(ms: number, fn: () => void) { this.timers.push(setTimeout(fn, ms)); }
  private seconds() { return this.state?.deadline ? Math.max(0, Math.ceil((this.state.deadline - this.network.serverNow()) / (this.state.phase === 'countdown' ? 700 : 1000))) : 0; }
  private activePlayers() { return this.state?.active.map(id => this.state!.players.find(p => p.id === id)!).filter(Boolean) ?? []; }
  private animate() {
    const s = this.state; if (!s) return;
    const active = this.activePlayers(), fightersKey = active.map(p => p.fighterId).join(':');
    if (active.length === 2 && fightersKey !== this.fightersKey) { this.arena.setFighters(FIGHTERS.find(f => f.id === active[0].fighterId)!, FIGHTERS.find(f => f.id === active[1].fighterId)!); this.fightersKey = fightersKey; }
    const introWalk = s.phase === 'intro' && this.seconds() <= 4;
    const key = `${s.matchId}:${s.round}:${s.phase}:${s.paused}:${introWalk}`;
    if (key === this.sceneKey) return;
    this.sceneKey = key; this.clearTimers();
    if (s.phase === 'lobby') { this.arena.mode = 'home'; this.arena.reset(); }
    else if (s.paused) { this.arena.reset(); this.arena.mode = 'fight'; }
    else if (s.phase === 'intro') { if (introWalk) { this.arena.enter(); this.audio.say('Round one.'); } else { this.arena.mode = 'home'; this.audio.say('Welcome to the main event.'); } }
    else if (s.phase === 'choosing') { this.arena.mode = 'fight'; this.arena.reset(); this.audio.say(s.round === 1 ? 'Fight!' : `Round ${s.round}. Fight!`); }
    else if (s.phase === 'countdown') this.audio.tone(240, .15, 'square', .035);
    else if (s.phase === 'reveal' && s.result) {
      this.arena.mode = 'fight';
      if (this.seconds() >= 3) {
        this.arena.playAttack(s.result); this.audio.tone(500, .4, 'sawtooth', .05);
        this.after(800, () => { this.audio.hit(); if (!this.arena.reducedMotion) { document.body.classList.add('impact'); this.after(200, () => document.body.classList.remove('impact')); } });
        if (s.winnerId) this.after(2750, () => { this.audio.say('Knock out!'); this.refresh(); });
      }
    }
    else if (s.phase === 'finished') {
      this.arena.celebrate(s.active.indexOf(s.winnerId!));
      this.audio.say(`${s.players.find(p => p.id === s.winnerId)?.name || 'The champion'} wins!`);
    }
  }
  async join(profile: ProfileInput, code?: string) {
    // Retry configuration here if the dev server was still starting when the page loaded.
    await this.loadInviteOrigin();
    const membership = await this.network.join(profile, code);
    history.replaceState({}, '', `/fight/${membership.code}`);
  }
  resume(code: string) { return this.network.resume(code); }
  async leave() { this.state = null; this.clearTimers(); this.sceneKey = ''; this.fightersKey = ''; this.pending = false; this.selected = null; await this.network.leave().catch(() => {}); }
  private me() { return this.state?.players.find(p => p.id === this.network.membership?.playerId); }
  inviteUrl() { return `${this.inviteOrigin}/fight/${this.state?.code ?? ''}`; }
  private avatar(p: PublicPlayer) { return `<img src="${this.arena.portraits[p.fighterId]}" alt="" draggable="false">`; }
  private roster() {
    const s = this.state!, me = this.me();
    return `<div class="room-roster">${Array.from({ length: 6 }, (_, i) => {
      const p = s.players[i];
      if (!p) return '<div class="room-seat empty"><b>＋</b><span>OPEN SEAT</span></div>';
      const queueIndex = s.queue.indexOf(p.id);
      return `<div class="room-seat ${p.connected ? '' : 'offline'}">${this.avatar(p)}<div><strong>${esc(p.name)} ${p.id === me?.id ? '<small>YOU</small>' : ''}</strong><span>${!p.connected ? 'RECONNECTING…' : s.active.includes(p.id) ? 'IN THE ARENA' : !p.ready ? 'NOT READY' : s.phase === 'lobby' ? 'READY' : `CHALLENGER ${queueIndex + 1}`}</span></div>${p.id === s.hostId ? '<b class="host-badge">HOST</b>' : ''}</div>`;
    }).join('')}</div>`;
  }
  private invite() { return `<div class="invite-box"><label for="invite-link">INVITE YOUR CORNER</label><div><input id="invite-link" readonly value="${esc(this.inviteUrl())}" aria-label="Room invite link"><button class="primary" data-room="copy">COPY LINK ↗</button></div><p>${esc(this.inviteScope)}</p></div>`; }
  private hud() {
    const s = this.state!, active = this.activePlayers();
    if (active.length !== 2) return '';
    const player = (p: PublicPlayer, i: number) => `<div class="player-hud ${i ? 'cpu' : ''}"><div class="hud-name"><span>${esc(p.name)}</span><small>${p.id === this.me()?.id ? 'YOU' : 'LIVE'}</small></div><div class="health"><i style="width:${100 - s.score[1 - i] * 50}%"></i></div><div class="round-pips">${[0, 1].map(n => `<i class="${s.score[i] > n ? 'won' : ''}"></i>`).join('')}<small>${s.score[i]} WINS</small></div></div>`;
    return `<div class="hud">${player(active[0], 0)}<div class="round-counter"><small>ROUND</small><b>${String(s.round).padStart(2, '0')}</b><span>FIRST TO 2</span></div>${player(active[1], 1)}</div>`;
  }
  render() {
    const s = this.state;
    if (!s) return '<section class="room-lobby"><p class="eyebrow">FRIENDS ROOM</p><h1>LET’S RECONNECT.</h1><p>Your connection or seat is no longer available. Open the invitation again to rejoin.</p><button class="primary" data-action="home">BACK HOME →</button></section>';
    const me = this.me(), isActive = !!me && s.active.includes(me.id), host = s.hostId === me?.id;
    const online = this.network.connected;
    const toolbar = `<div class="room-toolbar"><span><i class="live-dot"></i> ROOM ${s.code} <b>${s.players.length}/6</b></span><button class="text-btn" data-room="invite">INVITE +</button><button class="text-btn" data-action="home">LEAVE ROOM ↗</button></div>`;
    const status = !online ? '<div class="connection-banner" role="status">RECONNECTING… YOUR SEAT IS HELD FOR 60 SECONDS.</div>' : s.paused ? '<div class="connection-banner" role="status">FIGHT PAUSED · WAITING FOR A FIGHTER TO RECONNECT.</div>' : '';
    if (s.phase === 'lobby') {
      const readyCount = s.players.filter(p => p.ready && p.connected).length;
      return `<section class="room-lobby">${toolbar}${status}<p class="eyebrow">YOUR FRIENDS. YOUR ARENA.</p><h1>BRING YOUR<br><span class="outline">RIVALS.</span></h1><p class="room-description">Two fight. Everyone watches. Winner stays on.<br>Up to six players. First to two wins.</p>${this.invite()}${s.notice ? `<p class="room-notice" role="status">${esc(s.notice)}</p>` : ''}${this.roster()}<div class="room-lobby-actions">${me ? `<button class="secondary" data-room="ready" ${!online || this.pending ? 'disabled' : ''}>${me.ready ? '✓ READY · UNREADY' : 'I’M READY'}</button>` : ''}${host ? `<button class="primary" data-room="start" ${readyCount < 2 || !online || this.pending ? 'disabled' : ''}>${readyCount < 2 ? 'WAITING FOR A FRIEND' : 'START THE FIGHT'} <span>↗</span></button>` : '<p class="micro">THE HOST WILL START THE FIGHT WHEN TWO PLAYERS ARE READY.</p>'}</div></section>`;
    }
    const active = this.activePlayers();
    if (active.length !== 2) return `<section class="room-lobby">${toolbar}${status}<h2>FIGHT RESET.</h2><p>Waiting for the next fighters.</p></section>`;
    if (s.phase === 'intro' && this.seconds() > 4) return `<section class="versus room-versus">${toolbar}${status}<p class="eyebrow">FRIENDS ROOM ${s.code} / FIRST TO TWO</p><div class="fight-card">${active.map((p, i) => `${i ? '<b class="vs">VS</b>' : ''}<div class="vs-player"><span class="corner-label">${i ? 'VIOLET' : 'LIME'} CORNER ${p.id === me?.id ? '/ YOU' : ''}</span>${this.avatar(p)}<h2>${esc(p.name)}</h2><p>${p.fighterId.toUpperCase()} / LIVE PLAYER</p></div>`).join('')}</div><p class="micro">${isActive ? 'YOUR FRIEND IS YOUR PROBLEM NOW.' : 'RINGSIDE SEATS. YOUR TURN IS COMING.'}</p></section>`;
    if (s.phase === 'finished') {
      const winner = s.players.find(p => p.id === s.winnerId), queued = s.queue.filter(id => s.players.some(p => p.id === id && p.connected && p.ready));
      const voted = !!me && s.rematchVotes.includes(me.id), canControl = host || isActive;
      return `<section class="room-winner">${toolbar}${status}<div class="winner-title"><p class="eyebrow">WINNER STAYS ON</p><h1>${esc(winner?.name || 'CHAMPION')}<br><span class="outline">TAKES IT.</span></h1></div><div class="room-result-panel"><div class="final-score"><span>${esc(active[0].name)}</span><b>${s.score[0]} <i>–</i> ${s.score[1]}</b><span>${esc(active[1].name)}</span></div>${queued.length ? `<p class="eyebrow">NEXT UP: ${esc(s.players.find(p => p.id === queued[0])!.name)}</p><button class="primary" data-room="next" ${!canControl || !online || this.pending ? 'disabled' : ''}>NEXT CHALLENGER <span>→</span></button>` : `<button class="primary" data-room="rematch" ${!isActive || voted || !online || this.pending ? 'disabled' : ''}>${voted ? 'WAITING FOR YOUR OPPONENT' : isActive ? 'REMATCH' : 'WAITING FOR A REMATCH'} <span>↻</span></button><p class="micro centered">BOTH FIGHTERS MUST AGREE · ${s.rematchVotes.length}/2 READY</p>`}<button class="secondary" data-room="invite">INVITE ANOTHER FRIEND ↗</button>${!isActive && me ? `<button class="text-btn" data-room="ready" ${this.pending ? 'disabled' : ''}>${me.ready ? 'LEAVE THE CHALLENGER QUEUE' : 'READY UP FOR MY TURN'}</button>` : ''}${this.roster()}</div></section>`;
    }
    let banner = '', label = '';
    if (s.phase === 'intro') { banner = this.seconds() === 4 ? `ROUND ${s.round}` : this.seconds() ? String(this.seconds()) : 'FIGHT!'; label = 'THE MAIN EVENT'; }
    if (s.phase === 'countdown') { banner = String(Math.max(1, this.seconds())); label = 'BOTH CHOICES LOCKED'; }
    if (s.phase === 'reveal' && s.result) { banner = s.result.matchWinner && this.seconds() <= 2 ? 'K.O.' : s.result.headline; label = s.result.winner === 'draw' ? 'NO POINTS. RUN IT BACK.' : `ROUND TO ${active[s.result.winner === 'player' ? 0 : 1].name}`; }
    const canChoose = s.phase === 'choosing' && isActive && !me?.locked && !this.pending && online && !s.paused;
    const watcher = isActive ? me?.locked ? 'YOUR CHOICE IS LOCKED.' : 'MAKE YOUR MOVE.' : `RINGSIDE · ${me?.ready ? 'YOU’RE IN THE CHALLENGER QUEUE' : 'YOU’RE WATCHING'}`;
    return `<section class="fight friends-fight">${toolbar}${status}${this.hud()}<div class="announcement ${banner === 'K.O.' ? 'knockout' : ''}" role="status" aria-live="polite">${banner && !s.paused ? `<span class="eyebrow">${esc(label)}</span><h2>${esc(banner)}</h2>` : ''}</div>${s.phase === 'reveal' && s.result ? `<div class="reveal-moves"><span>${symbols[s.result.player]} ${s.result.player.toUpperCase()}</span><i>×</i><span>${symbols[s.result.cpu]} ${s.result.cpu.toUpperCase()}</span></div>` : ''}<div class="fight-bottom"><div class="pick-heading"><span>${watcher}</span><small>${s.phase === 'choosing' ? `${this.seconds()}s TO CHOOSE` : `${s.players.length - 2} WATCHING`}</small></div>${isActive && s.phase === 'choosing' ? `<div class="moves">${MOVES.map((m, i) => `<button class="move ${this.selected === m ? 'locked' : ''}" data-room-move="${m}" ${!canChoose ? 'disabled' : ''} aria-label="${m.toUpperCase()}"><small>0${i + 1}</small><b>${symbols[m]}</b><strong>${m.toUpperCase()}</strong></button>`).join('')}</div><p class="micro centered">${me?.locked ? 'WAITING FOR YOUR OPPONENT. THEIR CHOICE IS STILL SECRET.' : 'ONE TAP TO LOCK. YOUR FRIEND CANNOT SEE YOUR MOVE.'}</p>` : `<div class="spectator-status">${active.map(p => `<span>${esc(p.name)} <b>${p.locked ? 'LOCKED ✓' : s.phase === 'choosing' ? 'CHOOSING…' : 'IN THE ARENA'}</b></span>`).join('')}</div>${!isActive && me ? `<button class="text-btn" data-room="ready" ${this.pending || !online ? 'disabled' : ''}>${me.ready ? '✓ QUEUED FOR MY TURN · UNREADY' : 'I’M READY TO CHALLENGE'}</button>` : ''}`}</div></section>`;
  }
  async action(action: string) {
    const s = this.state; if (!s) return;
    if (action === 'copy') {
      try { await navigator.clipboard.writeText(this.inviteUrl()); this.message('Invite copied. Send it to your friends.'); }
      catch { this.message('Select the invitation link and copy it.'); document.querySelector<HTMLInputElement>('#invite-link')?.select(); }
      return;
    }
    if (action === 'invite') {
      const dialog = document.querySelector<HTMLDialogElement>('#info')!;
      document.querySelector('#dialog-content')!.innerHTML = `<p class="eyebrow">MAKE IT PERSONAL</p><h2>BRING A FRIEND.</h2>${this.invite()}`;
      dialog.showModal(); return;
    }
    if (this.pending) return;
    this.pending = true; this.refresh();
    try {
      if (action === 'ready') await this.network.action({ type: 'ready', ready: !this.me()?.ready });
      else if (action === 'start') await this.network.action({ type: 'start' });
      else if (action === 'rematch' || action === 'next') await this.network.action({ type: action, matchId: s.matchId });
    } catch (e) { this.message((e as Error).message); }
    finally { this.pending = false; this.refresh(); }
  }
  async choose(move: Move) {
    const s = this.state, me = this.me();
    if (!s || s.phase !== 'choosing' || !me || !s.active.includes(me.id) || me.locked || this.pending || s.paused || !this.network.connected) return;
    this.selected = move; this.pending = true; this.refresh(); this.audio.tone(440, .2, 'triangle');
    try { await this.network.action({ type: 'choice', move, round: s.round, matchId: s.matchId }); }
    catch (e) { this.selected = null; this.message(e instanceof NetworkError ? e.message : 'Could not lock that move.'); }
    finally { this.pending = false; this.refresh(); }
  }
  destroy() { clearInterval(this.timer); this.clearTimers(); }
}
