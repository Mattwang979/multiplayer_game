// 前端看到的同步狀態（跟 server/src/game/schema.ts 對應）
export interface MapLike<T> {
  get(key: string): T | undefined;
  forEach(cb: (value: T, key: string) => void): void;
  readonly size: number;
  values(): IterableIterator<T>;
}
export interface ArrayLike<T> {
  readonly length: number;
  [index: number]: T;
}

export interface PlayerState {
  id: string;
  name: string;
  faction: number;
  node: number;
  isBot: boolean;
  connected: boolean;
  alive: boolean;
  rank: number;
  funds: number;
  income: number;
  firepower: number;
  armor: number;
  logistics: number;
  deployReady: ArrayLike<number>;
  airReady: ArrayLike<number>;
  unitCount: number;
  kills: number;
  deployed: number;
  spent: number;
}

export interface UnitState {
  id: string;
  type: string;
  owner: string;
  side: number;
  lane: number;
  x: number;
  dir: number;
  oy: number;
  hp: number;
  maxHp: number;
  attacking: boolean;
  shots: number;
  tx: number;
  landT: number;
}

export interface StructureState {
  id: string;
  kind: string;
  owner: string;
  side: number;
  lane: number;
  slot: number;
  x: number;
  hp: number;
  maxHp: number;
  shots: number;
  tx: number;
  tl: number;
  airShots: number;
  ax: number;
  ay: number;
}

export interface AircraftState {
  id: string;
  kind: string;
  owner: string;
  side: number;
  x: number;
  y: number;
  angle: number;
  hp: number;
  maxHp: number;
  lane: number;
  tx: number;
  dropped: boolean;
}

export interface GameState {
  phase: "lobby" | "playing" | "ended";
  hostId: string;
  time: number;
  duration: number;
  winnerId: string;
  endReason: string;
  nodeCount: number;
  players: MapLike<PlayerState>;
  units: MapLike<UnitState>;
  structures: MapLike<StructureState>;
  aircraft: MapLike<AircraftState>;
  fronts: ArrayLike<number>;
}
