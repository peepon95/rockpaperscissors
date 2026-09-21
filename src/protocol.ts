import type { Move, RoundResult, Score } from './game';

export type RoomPhase = 'lobby' | 'intro' | 'choosing' | 'countdown' | 'reveal' | 'finished';
export interface PublicPlayer {
  id: string;
  name: string;
  fighterId: string;
  connected: boolean;
  ready: boolean;
  locked: boolean;
  reconnectUntil: number | null;
}
export interface RoomSnapshot {
  code: string;
  version: number;
  serverTime: number;
  hostId: string;
  players: PublicPlayer[];
  queue: string[];
  active: string[];
  phase: RoomPhase;
  deadline: number | null;
  paused: boolean;
  round: number;
  matchId: string;
  score: Score;
  result: RoundResult | null;
  winnerId: string | null;
  rematchVotes: string[];
  notice: string;
}
export interface ProfileInput { name: string; fighterId: string }
export interface Membership { code: string; playerId: string; token: string }
export type RoomAction =
  | { type: 'ready'; ready: boolean }
  | { type: 'start' }
  | { type: 'choice'; move: Move; matchId: string; round: number }
  | { type: 'rematch'; matchId: string }
  | { type: 'next'; matchId: string };
export type Reply<T = undefined> = { ok: true; data: T } | { ok: false; error: string; code: string };
