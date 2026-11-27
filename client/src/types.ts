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
  forEach?(cb: (value: T, index: number) => void): void;
}

export interface PlayerState {
  id: string;
  name: string;
  faction: number;
  hq: number;
  isBot: boolean;
  botLevel: string;
  connected: boolean;
  alive: boolean;
  rank: number;
  funds: number;
  income: number;
  upkeep: number;
  pop: number;
  forts: number;
  firepower: number;
  armor: number;
  logistics: number;
  airReady: ArrayLike<number>;
  kills: number;
  captures: number;
  deployed: number;
  spent: number;
}

export interface NodeState {
  kind: string; // hq / fort / bigfort
  owner: string;
  faction: number;
  hp: number;
  maxHp: number;
  capturer: string;
  capFaction: number;
  progress: number;
  contested: boolean; // 佔領暫停：附近還有別人的部隊
  incomeAt: number;
  spec: string;
  specAt: number;
  shots: number;
  tl: number;
  tx: number;
  airShots: number;
  ax: number;
  ay: number;
}

export interface UnitState {
  id: string;
  type: string;
  owner: string;
  faction: number;
  lane: number;
  x: number;
  dir: number;
  oy: number;
  hp: number;
  maxHp: number;
  attacking: boolean;
  shots: number;
  tl: number;
  tx: number;
  landT: number;
  inNode: number; // 駐紮在哪個據點（-1 = 野外）
  group: string;
  mode: string; // move / hold / retreat
  enter: boolean;
  hunt: string; // 特種部隊指定獵殺的兵種
  destNode: number;
  destLane: number;
  destX: number;
  route: ArrayLike<number>;
  airShots: number;
  ax: number;
  ay: number;
}

export interface StructureState {
  id: string;
  kind: string;
  owner: string;
  faction: number;
  lane: number;
  node: number;
  slot: number;
  x: number;
  hp: number;
  maxHp: number;
  shots: number;
  tl: number;
  tx: number;
  airShots: number;
  ax: number;
  ay: number;
  progress: number; // 施工進度 0~1
}

export interface AircraftState {
  id: string;
  kind: string;
  owner: string;
  faction: number;
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
  mapChoice: string;
  mapId: string;
  time: number;
  duration: number; // 0 = 不限時
  unlimited: boolean;
  winnerId: string;
  endReason: string;
  players: MapLike<PlayerState>;
  nodes: ArrayLike<NodeState>;
  units: MapLike<UnitState>;
  structures: MapLike<StructureState>;
  aircraft: MapLike<AircraftState>;
  fronts: ArrayLike<number>;
  leaderId: string;
  event: string;
  eventEnd: number;
  crates: MapLike<CrateState>;
}

export interface CrateState {
  id: string;
  lane: number;
  x: number;
  landT: number;
}
