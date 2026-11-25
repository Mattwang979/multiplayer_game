// 會同步到每個玩家畫面上的遊戲狀態。
// Colyseus 只會傳送有變動的欄位（delta），所以每 tick 改座標也不會吃太多流量。
import { schema, t, type SchemaType } from "@colyseus/schema";

export const Player = schema(
  {
    id: t.string().default(""),
    name: t.string().default(""),
    faction: t.uint8().default(0), // 陣營顏色（FACTIONS 的索引）
    node: t.int8().default(-1), // 開局後分配到的指揮部位置
    isBot: t.boolean().default(false),
    connected: t.boolean().default(true),
    alive: t.boolean().default(true),
    rank: t.uint8().default(0), // 名次（出局時決定，贏家 = 1）
    funds: t.uint32().default(0),
    income: t.float32().default(0),
    firepower: t.uint8().default(0),
    armor: t.uint8().default(0),
    logistics: t.uint8().default(0),
    // 各兵種下次可以部署的時間（對局秒數），順序同 UNIT_TYPES
    deployReady: t.array("float32"),
    // 空軍下次可用時間，順序同 AIR_KINDS
    airReady: t.array("float32"),
    unitCount: t.uint8().default(0),
    // 戰績
    kills: t.uint16().default(0),
    deployed: t.uint16().default(0),
    spent: t.uint32().default(0),

    // 只在伺服器使用、不會同步的欄位
    fundsExact: t.number().noSync().default(0),
    wasBot: t.boolean().noSync().default(false), // 原本就是電腦（不是斷線代管）
  },
  "Player",
);
export type Player = SchemaType<typeof Player>;

export const Unit = schema(
  {
    id: t.string().default(""),
    type: t.string().default("rifle"),
    owner: t.string().default(""),
    side: t.uint8().default(0), // 屬於哪個指揮部
    lane: t.uint8().default(0),
    x: t.float32().default(0),
    dir: t.int8().default(1), // 在這條路線上往哪邊走
    oy: t.int8().default(0), // 畫面上的左右錯位，避免全部疊在一起
    hp: t.float32().default(1),
    maxHp: t.float32().default(1),
    attacking: t.boolean().default(false),
    shots: t.uint8().default(0), // 每開一槍 +1，前端看到變化就畫彈道
    tx: t.float32().default(0), // 最近一次射擊的目標位置
    landT: t.float32().default(0), // 空降兵落地時間

    cooldownLeft: t.number().noSync().default(0),
  },
  "Unit",
);
export type Unit = SchemaType<typeof Unit>;

export const Structure = schema(
  {
    id: t.string().default(""),
    kind: t.string().default("hq"),
    owner: t.string().default(""),
    side: t.uint8().default(0),
    lane: t.int8().default(-1), // 指揮部是 -1（守住相連的所有路線）
    slot: t.int8().default(-1),
    x: t.float32().default(0),
    hp: t.float32().default(1),
    maxHp: t.float32().default(1),
    shots: t.uint8().default(0),
    tx: t.float32().default(0),
    tl: t.int8().default(0), // 最近一次射擊目標所在的路線
    airShots: t.uint8().default(0), // 對空射擊次數
    ax: t.float32().default(0), // 對空射擊的位置（畫面座標）
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
    side: t.uint8().default(0),
    x: t.float32().default(0), // 畫面座標
    y: t.float32().default(0),
    angle: t.float32().default(0),
    hp: t.float32().default(1),
    maxHp: t.float32().default(1),
    lane: t.uint8().default(0),
    tx: t.float32().default(0), // 目標在路線上的位置
    dropped: t.boolean().default(false),

    wx: t.number().noSync().default(0), // 目標的畫面座標
    wy: t.number().noSync().default(0),
  },
  "Aircraft",
);
export type Aircraft = SchemaType<typeof Aircraft>;

export const BattleState = schema(
  {
    phase: t.string().default("lobby"),
    hostId: t.string().default(""),
    time: t.float32().default(0), // 對局已進行秒數
    duration: t.float32().default(600),
    winnerId: t.string().default(""), // 贏家的玩家 id，平手是 "draw"
    endReason: t.string().default(""),
    nodeCount: t.uint8().default(0), // 這局有幾個指揮部（決定地圖形狀）
    players: t.map(Player),
    units: t.map(Unit),
    structures: t.map(Structure),
    aircraft: t.map(Aircraft),
    fronts: t.array("float32"), // 每條路線的前線位置（0 = a 端, 1000 = b 端）
  },
  "BattleState",
);
export type BattleState = SchemaType<typeof BattleState>;
