// 會同步到每個玩家畫面上的遊戲狀態。
// Colyseus 只會傳送有變動的欄位（delta），所以每 tick 改座標也不會吃太多流量。
import { schema, t, type SchemaType } from "@colyseus/schema";

export const Player = schema(
  {
    id: t.string().default(""),
    name: t.string().default(""),
    faction: t.uint8().default(0), // 陣營顏色（FACTIONS 的索引）
    hq: t.int8().default(-1), // 自己大本營是哪個據點
    isBot: t.boolean().default(false),
    connected: t.boolean().default(true),
    alive: t.boolean().default(true),
    rank: t.uint8().default(0), // 名次（出局時決定，贏家 = 1）
    funds: t.uint32().default(0),
    income: t.float32().default(0),
    forts: t.uint8().default(0), // 擁有幾個據點（含大本營）
    firepower: t.uint8().default(0),
    armor: t.uint8().default(0),
    logistics: t.uint8().default(0),
    deployReady: t.array("float32"), // 各兵種下次可部署時間，順序同 UNIT_TYPES
    airReady: t.array("float32"), // 空軍下次可用時間，順序同 AIR_KINDS
    unitCount: t.uint8().default(0),
    kills: t.uint16().default(0),
    captures: t.uint8().default(0),
    deployed: t.uint16().default(0),
    spent: t.uint32().default(0),

    fundsExact: t.number().noSync().default(0),
    wasBot: t.boolean().noSync().default(false), // 原本就是電腦（不是斷線代管）
  },
  "Player",
);
export type Player = SchemaType<typeof Player>;

/** 據點：大本營或堡壘，可以被攻破、佔領 */
export const MapNode = schema(
  {
    kind: t.string().default("fort"), // hq / fort / bigfort
    owner: t.string().default(""), // "" = 無主
    faction: t.int8().default(-1), // 擁有者的陣營顏色，-1 = 無主
    hp: t.float32().default(0),
    maxHp: t.float32().default(1),
    capturer: t.string().default(""), // 正在佔領的玩家
    capFaction: t.int8().default(-1),
    progress: t.float32().default(0), // 佔領進度 0~1
    shots: t.uint8().default(0),
    tl: t.int8().default(0), // 最近一次射擊目標所在的路
    tx: t.float32().default(0),
    airShots: t.uint8().default(0),
    ax: t.float32().default(0),
    ay: t.float32().default(0),

    cooldownLeft: t.number().noSync().default(0),
    airCooldownLeft: t.number().noSync().default(0),
  },
  "MapNode",
);
export type MapNode = SchemaType<typeof MapNode>;

export const Unit = schema(
  {
    id: t.string().default(""),
    type: t.string().default("rifle"),
    owner: t.string().default(""),
    faction: t.uint8().default(0),
    lane: t.uint8().default(0),
    x: t.float32().default(0), // 沿路的像素位置
    dir: t.int8().default(1),
    oy: t.int8().default(0),
    hp: t.float32().default(1),
    maxHp: t.float32().default(1),
    attacking: t.boolean().default(false),
    shots: t.uint8().default(0),
    tl: t.uint8().default(0), // 最近一次射擊目標所在的路
    tx: t.float32().default(0),
    landT: t.float32().default(0),

    cooldownLeft: t.number().noSync().default(0),
  },
  "Unit",
);
export type Unit = SchemaType<typeof Unit>;

/** 玩家蓋的工事（機槍碉堡、反戰車砲陣地、防空砲） */
export const Structure = schema(
  {
    id: t.string().default(""),
    kind: t.string().default("bunker"),
    owner: t.string().default(""),
    faction: t.uint8().default(0),
    lane: t.uint8().default(0),
    node: t.uint8().default(0), // 蓋在哪個據點旁邊
    slot: t.int8().default(0),
    x: t.float32().default(0),
    hp: t.float32().default(1),
    maxHp: t.float32().default(1),
    shots: t.uint8().default(0),
    tl: t.uint8().default(0),
    tx: t.float32().default(0),
    airShots: t.uint8().default(0),
    ax: t.float32().default(0),
    ay: t.float32().default(0),

    cooldownLeft: t.number().noSync().default(0),
    airCooldownLeft: t.number().noSync().default(0),
  },
  "Structure",
);
export type Structure = SchemaType<typeof Structure>;

export const Aircraft = schema(
  {
    id: t.string().default(""),
    kind: t.string().default("bomber"),
    owner: t.string().default(""),
    faction: t.uint8().default(0),
    x: t.float32().default(0),
    y: t.float32().default(0),
    angle: t.float32().default(0),
    hp: t.float32().default(1),
    maxHp: t.float32().default(1),
    lane: t.uint8().default(0),
    tx: t.float32().default(0),
    dropped: t.boolean().default(false),

    wx: t.number().noSync().default(0),
    wy: t.number().noSync().default(0),
  },
  "Aircraft",
);
export type Aircraft = SchemaType<typeof Aircraft>;

export const BattleState = schema(
  {
    phase: t.string().default("lobby"),
    hostId: t.string().default(""),
    mapChoice: t.string().default("random"), // 大廳選的地圖
    mapId: t.string().default(""), // 這局實際用的地圖
    time: t.float32().default(0),
    duration: t.float32().default(600),
    winnerId: t.string().default(""),
    endReason: t.string().default(""),
    players: t.map(Player),
    nodes: t.array(MapNode),
    units: t.map(Unit),
    structures: t.map(Structure),
    aircraft: t.map(Aircraft),
    fronts: t.array("float32"), // 每條路上雙方交戰的位置（畫面用）
  },
  "BattleState",
);
export type BattleState = SchemaType<typeof BattleState>;
