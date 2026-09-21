export const MOVES = ['rock', 'paper', 'scissors'] as const;
export type Move = typeof MOVES[number];
export type Outcome = 'player' | 'cpu' | 'draw';
export type Score = [number, number];
export interface RoundResult { player: Move; cpu: Move; winner: Outcome; headline: string; score: Score; matchWinner: Exclude<Outcome, 'draw'> | null }
export const beats: Record<Move, Move> = { rock: 'scissors', paper: 'rock', scissors: 'paper' };
export const headlines: Record<Move, string> = { rock: 'ROCK CRUSHES SCISSORS', paper: 'PAPER COVERS ROCK', scissors: 'SCISSORS CUT PAPER' };
export function resolveRound(player: Move, cpu: Move, score: Score): RoundResult {
  const winner = player === cpu ? 'draw' : beats[player] === cpu ? 'player' : 'cpu';
  const next: Score = [...score];
  if (winner !== 'draw') next[winner === 'player' ? 0 : 1]++;
  return { player, cpu, winner, headline: winner === 'draw' ? 'CLASH! DRAW.' : headlines[winner === 'player' ? player : cpu], score: next, matchWinner: next[0] >= 2 ? 'player' : next[1] >= 2 ? 'cpu' : null };
}
// A fresh independent CPU move is committed before player input is enabled.
// Stage 2 replaces this local authority with a server; never send private moves in room snapshots.
export class LocalMatch {
  score: Score = [0, 0];
  round = 1;
  #cpu: Move | null = null;
  #finished = false;
  #chooseMove: () => Move;
  constructor(chooseMove: () => Move = () => {
    const random = new Uint32Array(1);
    crypto.getRandomValues(random);
    return MOVES[Math.floor(random[0] / 4294967296 * 3)];
  }) { this.#chooseMove = chooseMove; }
  prepare() {
    if (this.#finished) throw new Error('Match is finished');
    if (this.#cpu !== null) throw new Error('Round already prepared');
    this.#cpu = this.#chooseMove();
  }
  lock(move: Move): RoundResult {
    if (!MOVES.includes(move) || this.#cpu === null || this.#finished) throw new Error('No active round');
    const result = resolveRound(move, this.#cpu, this.score);
    this.#cpu = null;
    this.score = result.score;
    this.#finished = !!result.matchWinner;
    this.round++;
    return result;
  }
}
export interface AvatarDescriptor { kind: 'preset' | 'generated'; presetId: string; portraitUrl?: string; modelUrl?: string; generationStatus?: 'queued' | 'processing' | 'ready' | 'failed' }
export const FIGHTERS = [
  { id: 'brick', name: 'BRICK', role: 'THE HEAVY HITTER', type: 'BOXER', color: '#e7ff65', skin: '#b87654', bio: 'All fists. Absolutely no subtlety.', number: '01' },
  { id: 'phantom', name: 'PHANTOM', role: 'THE SILENT MENACE', type: 'NINJA', color: '#bb8dff', skin: '#b38a6c', bio: 'You never hear the paper coming.', number: '02' },
  { id: 'titan', name: 'TITAN', role: 'THE MAIN EVENT', type: 'WRESTLER', color: '#ff7656', skin: '#ba7055', bio: 'Big entrance. Bigger scissors.', number: '03' },
  { id: 'riot', name: 'RIOT', role: 'THE WILD CARD', type: 'STREET FIGHTER', color: '#f473b7', skin: '#865b40', bio: 'Street rules. Playground weapons.', number: '04' },
  { id: 'bolt', name: 'BOLT', role: 'THE BAD ALGORITHM', type: 'ROBOT', color: '#68e2f6', skin: '#53647a', bio: 'Calculating… still picks rock.', number: '05' },
  { id: 'zen', name: 'ZEN', role: 'THE CALM BEFORE', type: 'MARTIAL ARTIST', color: '#faf3df', skin: '#c58d66', bio: 'Inner peace. Outer chaos.', number: '06' },
];
export type Fighter = typeof FIGHTERS[number];
