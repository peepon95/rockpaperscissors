import '@fontsource/barlow-condensed/latin-700.css';
import '@fontsource/barlow-condensed/latin-800-italic.css';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-700.css';
import './style.css';
import './friends.css';
import { Arena } from './arena';
import { AudioDirector } from './audio';
import { FriendsRoom } from './friends';
import { FIGHTERS, LocalMatch, MOVES, type Move, type RoundResult, type AvatarDescriptor } from './game';

const app = document.querySelector<HTMLDivElement>('#app')!;
const audio = new AudioDirector();
let arena: Arena;
try { arena = new Arena(document.querySelector('#arena')!); }
catch { app.innerHTML = '<main class="fallback"><p class="eyebrow">THROW DOWN</p><h1>THE ARENA NEEDS 3D.</h1><p>Your browser couldn’t start WebGL. Try a current browser with hardware acceleration enabled.</p><button onclick="location.reload()">TRY AGAIN</button></main>'; throw new Error('WebGL renderer unavailable'); }
type Screen = 'home' | 'select' | 'vs' | 'entrance' | 'choose' | 'locked' | 'reveal' | 'result' | 'ko' | 'winner' | 'room';
let screen: Screen = 'home', fighter = FIGHTERS[0], opponent = FIGHTERS[1], name = '', match = new LocalMatch(), sequence = 0;
let banner = '', result: RoundResult | null = null, round = 1, score = [0, 0], locked: Move | null = null;
let avatar: AvatarDescriptor = { kind: 'preset', presetId: fighter.id };
let mode: 'cpu' | 'friends' = 'cpu', roomCode = location.pathname.match(/^\/fight\/([A-Z2-9]{6})\/?$/i)?.[1].toUpperCase(), submitting = false;
const friends = new FriendsRoom(arena, audio, () => { if (friends.state || screen === 'room') { screen = 'room'; render(); } }, message => { toast(message); });
let toastTimer: ReturnType<typeof setTimeout>;
const symbols: Record<Move, string> = { rock: '✊', paper: '✋', scissors: '✌' };
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const delay = (ms: number, token: number) => new Promise<boolean>(resolve => setTimeout(() => resolve(token === sequence), ms));
const playerName = () => name.trim() || fighter.name;
function portrait(id: string, selfie = false) { return selfie && avatar.portraitUrl ? avatar.portraitUrl : arena.portraits[id]; }
function header() { return `<header class="header"><button class="wordmark" data-action="home" aria-label="Throw Down home">THROW<span>↯</span>DOWN<sup>®</sup></button><div class="header-right"><span class="edition">VOL. 002 <i></i> BRING YOUR RIVALS</span><button class="icon-btn" data-action="music" aria-label="Background music">♫</button><button class="icon-btn" data-action="sound" aria-label="${audio.enabled ? 'Mute sound' : 'Enable sound'}">${audio.enabled ? '◖))' : '◖×'}</button><button class="icon-btn" data-action="help" aria-label="How to play">?</button></div></header>`; }
function footer() { return '<footer><span>SMALL HANDS. BIG ENERGY.</span><span>ROCK / PAPER / SCISSORS</span><span>EST. 2026</span></footer>'; }
function homeView() {
  return `<section class="home"><div class="home-copy"><p class="eyebrow"><span class="live-dot"></span> THE WORLD’S MOST UNNECESSARY FIGHTING GAME</p><h1>THREE MOVES.<br>ZERO <span class="outline">CHILL.</span></h1><p class="home-description">Rock. Paper. Scissors.<br>Settled like a main event.</p><div class="home-actions"><button class="primary mode-button" data-action="create"><span>PLAY WITH FRIENDS<small>CREATE AN INVITE · UP TO 6 PLAYERS</small></span><b>↗</b></button><button class="secondary mode-button" data-action="join"><span>PLAY WITH A<br>RANDOM STRANGER<small>CPU OPPONENT · INSTANT MATCH</small></span><b>↗</b></button></div><p class="micro">NO SIGN-UP. NO SKILL REQUIRED. EGO OPTIONAL.</p></div><div class="arena-label"><span class="live-dot"></span> THE THROWDOWN ARENA <span class="coordinates">01° / CENTER STAGE</span></div><div class="event-tag"><span>TONIGHT’S MAIN EVENT</span><b>YOU <i>vs.</i> YOUR FRIENDS</b><small>6 SEATS · WINNER STAYS ON</small></div><div class="ticker"><div>ALL THE DRAMA. <span>NONE OF THE SKILL.</span> ✳ ROCK CRUSHES SCISSORS. ✳ PAPER COVERS ROCK. ✳ SCISSORS CUT PAPER. ✳ <span>LET YOUR HANDS DO THE TALKING.</span></div></div></section>`;
}
function selectView() {
  return `<section class="selection"><div class="selection-heading"><button class="text-btn" data-action="home">← BACK TO LOBBY</button><p class="eyebrow">${mode === 'friends' ? roomCode ? `JOIN FRIENDS ROOM ${roomCode}` : 'CREATE YOUR FRIENDS ROOM' : 'RANDOM STRANGER / CPU OPPONENT'}</p><h1>CHOOSE YOUR<br><span class="outline">PROBLEM.</span></h1></div><div class="fighter-caption"><span class="eyebrow" style="color:${fighter.color}">${fighter.role}</span><h2>${fighter.name}<sup>${fighter.number}</sup></h2><p>${fighter.bio}</p></div>
  <form class="select-panel" id="fighter-form"><label for="player-name">YOUR FIGHT NAME <span>MAKE IT PERSONAL.</span></label><input id="player-name" name="name" maxlength="18" autocomplete="nickname" placeholder="Enter your name" value="${esc(name)}"><div class="roster-label"><span>SELECT FIGHTER</span><span>0${FIGHTERS.indexOf(fighter) + 1} / 06</span></div><div class="roster">${FIGHTERS.map(f => `<button type="button" class="fighter-card ${f.id === fighter.id ? 'selected' : ''}" data-fighter="${f.id}" aria-label="Choose ${f.name}, ${f.type}" aria-pressed="${f.id === fighter.id}" style="--fighter:${f.color}"><img src="${arena.portraits[f.id]}" alt="" draggable="false"><span>${f.name}</span><small>${f.type}</small>${f.id === fighter.id ? '<b class="check">✓</b>' : ''}</button>`).join('')}</div>
  ${mode === 'cpu' ? `<div class="selfie-row"><label class="upload" for="selfie">${avatar.portraitUrl ? '<img class="selfie-thumb" src="' + avatar.portraitUrl + '" alt="Your portrait"> CHANGE PORTRAIT' : '＋ ADD YOUR SELFIE'}<input id="selfie" type="file" accept="image/jpeg,image/png,image/webp"></label>${avatar.portraitUrl ? '<button type="button" class="text-btn" data-action="remove-photo">REMOVE</button>' : '<span>YOUR FACE ON THE FIGHT CARD</span>'}</div>` : '<p class="friends-selection-note">Pick your fighter. Invite your friends. Settle it in the arena.</p>'}
  <button class="primary" type="submit" ${submitting ? 'disabled' : ''}>${submitting ? 'CONNECTING…' : mode === 'friends' ? roomCode ? 'JOIN FRIENDS ROOM' : 'CREATE INVITE LINK' : 'ENTER THE ARENA'} <span>↗</span></button><p class="micro centered">${mode === 'friends' ? 'UP TO 6 FRIENDS · TWO FIGHT · WINNER STAYS' : 'VS CPU · BEST OF THREE · NO MERCY*'}</p><p class="fine-print">${mode === 'friends' ? 'Your room opens after you choose. No account needed.' : '*Emotionally. It’s still rock paper scissors.'}</p></form></section>`;
}
function vsView() { return `<section class="versus"><p class="eyebrow">THE MAIN EVENT / FIRST TO TWO</p><div class="fight-card"><div class="vs-player"><span class="corner-label">IN THE LIME CORNER</span><img src="${portrait(fighter.id, true)}" class="${avatar.portraitUrl ? 'photo' : ''}" alt="${esc(playerName())} portrait"><h2>${esc(playerName())}</h2><p>${fighter.name} / ${fighter.type}</p></div><b class="vs">VS</b><div class="vs-player"><span class="corner-label">IN THE VIOLET CORNER</span><img src="${portrait(opponent.id)}" alt="${opponent.name} portrait"><h2>${opponent.name}</h2><p>CPU / ${opponent.type}</p></div></div><p class="micro">TWO FIGHTERS. THREE MOVES. ONE BRUISED EGO.</p><div class="loading-bar"></div></section>`; }
function hud() { return `<div class="hud"><div class="player-hud"><div class="hud-name"><span>${esc(playerName())}</span><small>YOU</small></div><div class="health"><i style="width:${100 - score[1] * 50}%"></i></div><div class="round-pips">${[0, 1].map(i => `<i class="${score[0] > i ? 'won' : ''}"></i>`).join('')}<small>${score[0]} WINS</small></div></div><div class="round-counter"><small>ROUND</small><b>${round.toString().padStart(2, '0')}</b><span>FIRST TO 2</span></div><div class="player-hud cpu"><div class="hud-name"><small>CPU</small><span>${opponent.name}</span></div><div class="health"><i style="width:${100 - score[0] * 50}%"></i></div><div class="round-pips">${[0, 1].map(i => `<i class="${score[1] > i ? 'won' : ''}"></i>`).join('')}<small>${score[1]} WINS</small></div></div></div>`; }
function fightView() {
  const showingMoves = ['reveal', 'result', 'ko'].includes(screen) && result;
  return `<section class="fight">${hud()}<div class="arena-stamp">TD / WORLD HAND SPORT LEAGUE</div><div class="announcement ${screen === 'ko' ? 'knockout' : ''}" aria-live="polite" role="status">${banner ? `<span class="eyebrow">${screen === 'locked' ? 'BOTH CHOICES LOCKED' : screen === 'result' ? result?.winner === 'draw' ? 'NO POINTS. RUN IT BACK.' : result?.winner === 'player' ? 'ROUND TO YOU' : 'ROUND TO ' + opponent.name : screen === 'ko' ? 'THAT SETTLES IT.' : 'THE MAIN EVENT'}</span><h2 key="${esc(banner)}">${esc(banner)}</h2>` : ''}</div>${showingMoves ? `<div class="reveal-moves"><span>${symbols[result!.player]} ${result!.player.toUpperCase()}</span><i>×</i><span>${symbols[result!.cpu]} ${result!.cpu.toUpperCase()}</span></div>` : ''}<div class="fight-bottom">${screen === 'choose' || screen === 'locked' ? `<div class="pick-heading"><span>${screen === 'choose' ? 'MAKE YOUR MOVE.' : 'CHOICE LOCKED.'}</span><small>${screen === 'choose' ? 'YOUR CHOICE STAYS SECRET' : 'NO TAKEBACKS. JUST TENSION.'}</small></div><div class="moves">${MOVES.map((m, i) => `<button class="move ${locked === m ? 'locked' : ''}" data-move="${m}" ${screen !== 'choose' ? 'disabled' : ''} aria-label="${m.toUpperCase()}"><small>0${i + 1} <span>${['R', 'P', 'S'][i]}</span></small><b>${symbols[m]}</b><strong>${m.toUpperCase()}</strong><em>${['CRUSH IT', 'WRAP IT UP', 'CUT LOOSE'][i]}</em></button>`).join('')}</div><p class="micro centered">${screen === 'choose' ? 'ONE TAP TO LOCK IN. WIN TWO ROUNDS TO TAKE IT ALL.' : 'YOUR OPPONENT’S MOVE IS HIDDEN UNTIL THE REVEAL.'}</p>` : screen === 'result' ? `<button class="primary next-round" data-action="next">NEXT ROUND <span>→</span></button>` : '<div class="broadcast-caption">LIVE FROM THE THROWDOWN ARENA</div>'}</div></section>`;
}
function winnerView() { const won = result?.matchWinner === 'player'; return `<section class="winner"><div class="winner-title"><p class="eyebrow">${won ? 'THE CROWD GOES UNREASONABLY WILD' : 'A BRUISED EGO. A WORTHY OPPONENT.'}</p><h1>${won ? 'BIG' : 'GOOD'}<br><span class="outline">${won ? 'HAND ENERGY.' : 'FIGHT.'}</span></h1></div><div class="winner-panel"><p class="eyebrow">WINNER</p><h2>${won ? esc(playerName()) : opponent.name}</h2><div class="final-score"><span>${esc(playerName())}</span><b>${score[0]} <i>–</i> ${score[1]}</b><span>${opponent.name}</span></div><button class="primary" data-action="rematch">RUN IT BACK <span>↻</span></button><div class="winner-secondary"><button class="secondary" data-action="new">NEW FIGHT</button><button class="secondary" data-action="share">SHARE RESULT ↗</button></div><p class="micro centered">${won ? 'GO ON. BE INSUFFERABLE ABOUT IT.' : 'THE REMATCH IS WHERE LEGENDS ARE MADE.'}</p></div></section>`; }
function render() {
  const openDialog = document.querySelector<HTMLDialogElement>('#info')?.open;
  const dialogContent = openDialog ? document.querySelector('#dialog-content')?.innerHTML : null;
  document.body.dataset.screen = screen;
  const toastElement = document.querySelector('#toast'), toastText = toastElement?.classList.contains('show') ? toastElement.textContent : '';
  app.innerHTML = `${header()}<main>${screen === 'room' ? friends.render() : screen === 'home' ? homeView() : screen === 'select' ? selectView() : screen === 'vs' ? vsView() : screen === 'winner' ? winnerView() : fightView()}</main>${footer()}<div id="toast" role="status" class="${toastText ? 'show' : ''}">${esc(toastText || '')}</div><dialog id="info"><button class="dialog-close icon-btn" aria-label="Close dialog">×</button><div id="dialog-content"></div></dialog>`;
  document.querySelector('#fighter-form')?.addEventListener('submit', e => { e.preventDefault(); name = document.querySelector<HTMLInputElement>('#player-name')!.value.trim(); if (mode === 'friends') void enterFriends(); else void startMatch(); });
  document.querySelector('#player-name')?.addEventListener('input', e => name = (e.target as HTMLInputElement).value);
  document.querySelector('#selfie')?.addEventListener('change', uploadPhoto);
  document.querySelector('.dialog-close')?.addEventListener('click', () => document.querySelector<HTMLDialogElement>('#info')!.close());
  if (dialogContent) dialog(dialogContent);
}
function toast(message: string) { const el = document.querySelector('#toast'); if (!el) return; el.textContent = message; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => document.querySelector('#toast')?.classList.remove('show'), 4500); }
function dialog(content: string) { document.querySelector('#dialog-content')!.innerHTML = content; document.querySelector<HTMLDialogElement>('#info')!.showModal(); }
async function goHome() { document.querySelector<HTMLDialogElement>('#info')?.close(); sequence++; submitting = false; screen = 'home'; await friends.leave(); roomCode = undefined; history.replaceState({}, '', '/'); arena.mode = 'home'; arena.reset(); render(); }
function chooseFighter() { document.querySelector<HTMLDialogElement>('#info')?.close(); sequence++; screen = 'select'; arena.mode = 'select'; arena.reset(); render(); }
async function enterFriends() {
  if (submitting) return;
  const token = sequence; submitting = true; audio.unlock(); render();
  try { await friends.join({ name: playerName(), fighterId: fighter.id }, roomCode); if (token !== sequence) { await friends.leave(); return; } screen = 'room'; render(); }
  catch (e) { toast((e as Error).message); }
  finally { submitting = false; if (screen === 'select') render(); }
}
async function uploadPhoto(e: Event) {
  const input = e.target as HTMLInputElement, file = input.files?.[0]; if (!file) return;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024) { toast('Choose a JPG, PNG or WebP under 8 MB.'); input.value = ''; return; }
  const token = sequence;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512; const ctx = canvas.getContext('2d')!;
    const size = Math.min(bitmap.width, bitmap.height); ctx.drawImage(bitmap, (bitmap.width - size) / 2, (bitmap.height - size) / 2, size, size, 0, 0, 512, 512); bitmap.close();
    if (token !== sequence || screen !== 'select') return;
    avatar.portraitUrl = canvas.toDataURL('image/jpeg', .85); render(); toast('Fight-card portrait ready. Your photo stays on this device.');
  } catch { toast('Couldn’t open that image. Try another JPG or PNG.'); }
}
async function startMatch(rematch = false) {
  const token = ++sequence; audio.unlock(); match = new LocalMatch(); score = [0, 0]; round = 1; result = null; locked = null;
  if (!rematch) opponent = FIGHTERS[(FIGHTERS.indexOf(fighter) + 1 + Math.floor(Math.random() * 5)) % FIGHTERS.length];
  arena.setFighters(fighter, opponent); arena.mode = 'home'; screen = 'vs'; render(); audio.say('Welcome to the main event.');
  if (!await delay(2800, token)) return;
  arena.enter(); screen = 'entrance'; banner = 'ROUND 1'; render(); audio.say('Round one.');
  if (!await delay(1600, token)) return;
  for (const n of ['3', '2', '1']) { banner = n; render(); audio.tone(260, .15, 'square', .035); if (!await delay(650, token)) return; }
  banner = 'FIGHT!'; render(); audio.say('Fight!'); audio.hit();
  if (!await delay(650, token)) return;
  beginRound();
}
function beginRound() { arena.reset(); match.prepare(); screen = 'choose'; banner = ''; locked = null; result = null; render(); }
async function lockMove(move: Move) {
  if (screen !== 'choose') return;
  const token = sequence; result = match.lock(move); locked = move; screen = 'locked'; audio.tone(440, .2, 'triangle');
  for (const n of ['3', '2', '1']) { banner = n; render(); audio.tone(240, .12, 'square', .035); if (!await delay(700, token)) return; }
  screen = 'reveal'; banner = result.winner === 'draw' ? 'CLASH!' : 'REVEAL'; render(); arena.playAttack(result); audio.tone(500, .4, 'sawtooth', .05);
  if (!await delay(800, token)) return;
  audio.hit(); if (!arena.reducedMotion) { document.body.classList.add('impact'); setTimeout(() => document.body.classList.remove('impact'), 200); }
  score = [...result.score]; banner = result.headline; render();
  if (!await delay(result.matchWinner ? 2100 : 1500, token)) return;
  if (result.matchWinner) { screen = 'ko'; banner = 'K.O.'; render(); audio.say('Knock out!'); audio.hit(); if (!await delay(1700, token)) return; arena.celebrate(result.matchWinner === 'player' ? 0 : 1); screen = 'winner'; render(); audio.say(`${result.matchWinner === 'player' ? playerName() : opponent.name} wins!`); }
  else { screen = 'result'; banner = result.headline; render(); audio.say(result.winner === 'draw' ? 'Draw. Run it back.' : result.winner === 'player' ? 'Round to you.' : 'Round to your opponent.'); }
}
async function nextRound() { const token = sequence; round++; screen = 'entrance'; banner = `ROUND ${round}`; arena.reset(); render(); audio.say(`Round ${round}`); if (!await delay(1000, token)) return; beginRound(); }
document.addEventListener('click', e => {
  const button = (e.target as HTMLElement).closest<HTMLButtonElement>('button'); if (!button || button.disabled) return;
  if (button.dataset.room) { void friends.action(button.dataset.room); return; }
  if (button.dataset.roomMove) { void friends.choose(button.dataset.roomMove as Move); return; }
  if (button.dataset.fighter) { fighter = FIGHTERS.find(f => f.id === button.dataset.fighter)!; avatar.presetId = fighter.id; arena.setFighters(fighter, opponent); audio.tone(); render(); return; }
  if (button.dataset.move) { void lockMove(button.dataset.move as Move); return; }
  switch (button.dataset.action) {
    case 'home': if (submitting) break; if (!['home', 'select', 'winner'].includes(screen)) { dialog('<p class="eyebrow">LEAVE THIS FIGHT?</p><h2>THROW IN<br>THE TOWEL?</h2><p>You’ll leave your seat. If you’re fighting, the match returns to the lobby.</p><button class="primary" data-action="quit">LEAVE FIGHT →</button>'); } else void goHome(); break;
    case 'quit': void goHome(); break;
    case 'create': mode = 'friends'; roomCode = undefined; audio.unlock(); chooseFighter(); break;
    case 'new': mode = 'cpu'; audio.unlock(); chooseFighter(); break;
    case 'join': mode = 'cpu'; roomCode = undefined; audio.unlock(); chooseFighter(); break;
    case 'music': musicDialog(); break;
    case 'music-toggle': audio.toggleMusic(); musicDialog(); break;
    case 'music-remove': audio.removeMusic(); musicDialog(); break;
    case 'sound': audio.unlock(); audio.toggle(); button.textContent = audio.enabled ? '◖))' : '◖×'; button.setAttribute('aria-label', audio.enabled ? 'Mute sound' : 'Enable sound'); break;
    case 'help': dialog(`<p class="eyebrow">THE ENTIRE RULEBOOK</p><h2>THREE MOVES.<br>YOU’VE GOT THIS.</h2><div class="rules"><p>✊ <b>ROCK</b> crushes scissors.</p><p>✋ <b>PAPER</b> covers rock.</p><p>✌ <b>SCISSORS</b> cut paper.</p></div><p>Tap a move to lock it. Both choices reveal together. Win two rounds to win the fight. Draws don’t count.</p><p class="micro">KEYBOARD: R / P / S · SOUND IS OPTIONAL</p><button class="secondary" data-action="motion">${arena.reducedMotion ? 'ENABLE' : 'REDUCE'} CAMERA MOTION</button>`); break;
    case 'motion': arena.reducedMotion = !arena.reducedMotion; document.body.classList.toggle('reduced-motion', arena.reducedMotion); button.textContent = `${arena.reducedMotion ? 'ENABLE' : 'REDUCE'} CAMERA MOTION`; break;
    case 'remove-photo': delete avatar.portraitUrl; render(); break;
    case 'next': void nextRound(); break;
    case 'rematch': void startMatch(true); break;
    case 'share': void shareResult(); break;
  }
});
document.addEventListener('keydown', e => { if (e.repeat || (e.target as HTMLElement).matches('input,textarea') || document.querySelector('dialog[open]')) return; const m = ({ r: 'rock', p: 'paper', s: 'scissors' } as Record<string, Move>)[e.key.toLowerCase()]; if (m && screen === 'room') void friends.choose(m); else if (m && screen === 'choose') void lockMove(m); });
async function shareResult() {
  const text = `${playerName()} ${score[0]} – ${score[1]} ${opponent.name} (CPU) at THROW DOWN. Three moves. Zero chill.`;
  try { if (navigator.share) await navigator.share({ title: 'THROW DOWN — Fight result', text }); else { await navigator.clipboard.writeText(text); toast('Fight result copied. Go talk your talk.'); } }
  catch (e) { if ((e as Error).name !== 'AbortError') dialog(`<p class="eyebrow">YOUR FIGHT RESULT</p><h2>SPREAD THE WORD.</h2><p class="copy-result">${esc(text)}</p><p>Select and copy this result to share it.</p>`); }
}
document.addEventListener('arena-lost', () => { sequence++; dialog('<h2>TIME OUT.</h2><p>The 3D connection was interrupted. Reload the page to return to the arena.</p><button class="primary" onclick="location.reload()">RELOAD ARENA</button>'); });
function musicDialog() {
  const current = document.querySelector<HTMLDialogElement>('#info'); if (current?.open) current.close();
  dialog(`<p class="eyebrow">YOUR WALKOUT SOUNDTRACK</p><h2>SET THE MOOD.</h2><p>${audio.musicName ? `Now loaded: ${esc(audio.musicName)}` : 'Add your instrumental audio file to loop in the background. The Rocky recording isn’t bundled.'}</p><label class="music-upload secondary" for="music-file">＋ CHOOSE AUDIO FILE<input id="music-file" type="file" accept="audio/*,.mp3,.m4a,.wav,.ogg"></label><p class="micro">MP3 / M4A / WAV / OGG · UP TO 30 MB · PLAYS ONLY ON YOUR DEVICE</p>${audio.musicName ? `<div class="music-controls"><button class="primary" data-action="music-toggle">${audio.musicPlaying ? 'PAUSE MUSIC' : 'PLAY MUSIC'}</button><button class="text-btn" data-action="music-remove">REMOVE TRACK</button></div><label class="music-volume" for="music-volume">VOLUME <input id="music-volume" type="range" min="0" max="100" value="${audio.musicVolume * 100}"></label>` : ''}`);
}
document.addEventListener('change', e => {
  if ((e.target as HTMLElement).id !== 'music-file') return;
  const file = (e.target as HTMLInputElement).files?.[0]; if (!file) return;
  void audio.loadMusic(file).then(() => musicDialog()).catch(e => toast(e.message));
});
document.addEventListener('input', e => { if ((e.target as HTMLElement).id === 'music-volume') { const input = e.target as HTMLInputElement; audio.setMusicVolume(Number(input.value) / 100); input.setAttribute('value', input.value); } });
render();
if (roomCode) {
  mode = 'friends'; chooseFighter();
  submitting = true; render();
  void friends.resume(roomCode).catch(e => toast((e as Error).message)).finally(() => { submitting = false; render(); });
} else if (location.pathname.startsWith('/fight/')) toast('That invite link is invalid. Ask your friend for a new link.');
