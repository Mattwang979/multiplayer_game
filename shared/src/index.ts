// 前後端共用的遊戲規則與數值。
// 平衡調整只要改這個檔案，伺服器和畫面會一起更新。
export * from "./map";

export const ROOM_NAME = "battle";

// ---------- 對局 ----------
export const TICK_RATE = 20; // 伺服器每秒模擬幾次
export const MATCH_SECONDS = 600; // 一局最多 10 分鐘
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;
export const SPAWN_OFFSET = 14; // 部隊從距離據點多遠的地方出發（像素）

// ---------- 駐軍與派兵 ----------
export const POP_CAP = 60; // 每人總兵力上限（人口；戰車算 3、砲兵算 2）
/** 每座據點最多能駐紮多少人口 */
export const GARRISON_CAP: Record<string, number> = { hq: 24, bigfort: 16, fort: 12 };
export const RELEASE_INTERVAL = 0.45; // 一次派出很多兵時，每支部隊出門的間隔（秒）
export const GARRISON_HEAL = 0.05; // 駐紮在據點裡每秒回復最大血量的 5%
export const GARRISON_FIRE_BONUS = 0.04; // 據點火力：每 1 人口駐軍 +4%
export const GARRISON_FIRE_MAX = 0.5; // 最多 +50%
export const RETREAT_SPEED = 1.25; // 撤退時移動速度倍率（撤退中不會開火）
export const MAX_ORDER_UNITS = 80; // 一次指令最多帶幾支部隊

// 養兵費：野外的兵每人口固定收費；堡壘裡囤的兵越多，每人口越貴（逼你把兵派出去用）
export const FIELD_UPKEEP_PER_POP = 0.06;
export const UPKEEP_PER_POP = 0.1;
export const UPKEEP_SCALE = 12;
export function upkeepFor(garrisonPop: number, fieldPop = 0) {
  const g = garrisonPop <= 0 ? 0 : UPKEEP_PER_POP * garrisonPop * (1 + garrisonPop / UPKEEP_SCALE);
  return g + Math.max(0, fieldPop) * FIELD_UPKEEP_PER_POP;
}

// ---------- 經濟 ----------
export const START_FUNDS = 250;
export const BASE_INCOME = 5; // 每秒固定收入
export const FORT_INCOME = 2; // 每座堡壘每秒收入
export const BIG_FORT_INCOME = 3.5; // 大型堡壘每秒收入
export const BOUNTY_RATIO = 0.25; // 擊殺獲得對方造價的 25%
export const HQ_KILL_BOUNTY = 300; // 打爆一座大本營的獎勵
export const FORT_BREAK_BOUNTY = 120; // 攻破一座堡壘的獎勵
export const CAPTURE_GRACE = 15; // 剛佔下的堡壘幾秒內不產錢
// 領先者懸賞：堡壘數唯一最多的玩家被懸賞，攻破他的堡壘、擊殺他的部隊賞金加成
export const LEADER_FORT_BOUNTY_MULT = 2;
export const LEADER_KILL_BOUNTY_MULT = 1.5;

// ---------- 佔領 ----------
export const CAPTURE_TIME = 3; // 部隊在無主堡壘旁邊站幾秒可以佔領
export const CAPTURE_RADIUS = 46; // 離堡壘多近才算在佔領（像素）
export const CAPTURE_HP = 0.5; // 佔下來時有幾成血

// ---------- 陣營 ----------
export interface Faction {
  name: string;
  color: number; // Phaser 用
  css: string; // 網頁用
  light: string; // 深色介面上的文字色（對比度 ≥ 4.5:1）
  bar: string; // 深色介面上的血條色
  mark: string; // 陣營色上面的徽記顏色
  emblem: "star" | "cross" | "triangle" | "ring";
}
// 四隊在淺色草地／沙地上要看得清楚、彼此也要能用明暗分開：
// 深藍、烈橘、墨黑、雪白，畫面上的單位一律加深色描邊。
export const FACTIONS: Faction[] = [
  { name: "鋼鐵旅", color: 0x1f4fa8, css: "#1f4fa8", light: "#8db8ff", bar: "#4f86e8", mark: "#ffffff", emblem: "cross" },
  { name: "赤焰旅", color: 0xf26b21, css: "#f26b21", light: "#ff9a5c", bar: "#f26b21", mark: "#1d1d17", emblem: "triangle" },
  { name: "黑鷹旅", color: 0x2a2a2a, css: "#2a2a2a", light: "#d0d0d0", bar: "#bdbdbd", mark: "#ffffff", emblem: "star" },
  { name: "雪原旅", color: 0xf2f4f6, css: "#f2f4f6", light: "#f2f4f6", bar: "#f2f4f6", mark: "#1d1d17", emblem: "ring" },
];
export const OUTLINE = 0x1d1d17;

// ---------- 傷害類型與護甲 ----------
export type ArmorClass = "soft" | "light" | "hard" | "building"; // 步兵、輕裝甲車輛、戰車、建築
export type WeaponClass = "rifle" | "mg" | "at" | "cannon" | "shell" | "bomb" | "demo" | "sniper" | "flame" | "flak" | "none";
// 距離、速度都是畫面上的像素

// 傷害倍率：武器打不同護甲的效果。剋制關係主要從這裡來。
export const DAMAGE_TABLE: Record<WeaponClass, Record<ArmorClass, number>> = {
  rifle: { soft: 1.0, light: 0.5, hard: 0.15, building: 0.5 },
  mg: { soft: 1.0, light: 0.45, hard: 0.1, building: 0.3 },
  at: { soft: 0.35, light: 1.6, hard: 2.0, building: 1.0 },
  cannon: { soft: 1.0, light: 1.2, hard: 1.0, building: 1.3 },
  shell: { soft: 1.0, light: 0.8, hard: 0.5, building: 1.0 },
  bomb: { soft: 1.0, light: 1.0, hard: 0.8, building: 1.4 },
  demo: { soft: 0.25, light: 0.8, hard: 0.6, building: 3.0 }, // 工兵爆破
  sniper: { soft: 1.0, light: 0.15, hard: 0.05, building: 0.1 }, // 狙擊：一槍一個，打不穿裝甲
  flame: { soft: 1.3, light: 0.7, hard: 0.3, building: 1.2 }, // 火焰：近距離燒一片
  flak: { soft: 0.8, light: 1.0, hard: 0.3, building: 0.3 }, // 防空砲車平射
  none: { soft: 0, light: 0, hard: 0, building: 0 },
};

// ---------- 地面部隊 ----------
export type UnitType =
  | "rifle" | "mg" | "sniper" | "flame" | "car" | "tank" | "at" | "flak" | "artillery" | "engineer" | "medic" | "para";
/** 可以在據點買的兵種（空降兵只能由運輸機投放） */
export const UNIT_TYPES: UnitType[] = ["rifle", "mg", "sniper", "flame", "car", "tank", "at", "flak", "artillery", "engineer", "medic"];
/** 介面上的兵種分頁 */
export const UNIT_GROUPS: { name: string; types: UnitType[] }[] = [
  { name: "步兵", types: ["rifle", "mg", "sniper", "flame"] },
  { name: "車砲", types: ["car", "tank", "at", "flak"] },
  { name: "支援", types: ["artillery", "engineer", "medic"] },
];
/** 一次派出很多兵時的出門順序：前排先走、支援部隊殿後 */
export const RELEASE_ORDER: UnitType[] = ["tank", "car", "rifle", "flame", "para", "mg", "sniper", "at", "flak", "engineer", "medic", "artillery"];

export interface UnitDef {
  name: string;
  short: string; // 按鈕上的說明
  cost: number;
  pop: number; // 佔多少人口
  hp: number;
  damage: number;
  cooldown: number; // 射擊間隔（秒）
  range: number;
  minRange?: number; // 最小射程：比這更近的敵人打不到（砲兵）
  speed: number; // 每秒移動距離
  armor: ArmorClass;
  weapon: WeaponClass;
  members: number; // 畫面上顯示幾個人／幾輛
  splash?: number; // 範圍傷害半徑（砲兵、火焰兵）
  heal?: number; // 醫療兵：每秒幫範圍內每個友軍回多少血
  healTargets?: number; // 醫療兵：同時治療幾個
  repair?: number; // 工兵：每秒修理多少血（據點、工事、車輛）；也會加快工事施工
  airDamage?: number; // 防空砲車：對空傷害
  airCooldown?: number;
  airRange?: number;
  hotkey: string;
}

export const UNITS: Record<UnitType, UnitDef> = {
  rifle: {
    name: "步兵班", short: "便宜耐打，剋反戰車砲", cost: 50, pop: 1, hp: 110, damage: 11, cooldown: 1.0,
    range: 90, speed: 30, armor: "soft", weapon: "rifle", members: 4, hotkey: "1",
  },
  mg: {
    name: "機槍組", short: "射程遠、壓制步兵", cost: 85, pop: 1, hp: 100, damage: 8, cooldown: 0.3,
    range: 125, speed: 24, armor: "soft", weapon: "mg", members: 2, hotkey: "2",
  },
  sniper: {
    name: "狙擊手", short: "超遠射程點殺步兵，剋機槍、砲兵", cost: 120, pop: 1, hp: 70, damage: 50, cooldown: 3.0,
    range: 190, speed: 26, armor: "soft", weapon: "sniper", members: 1, hotkey: "3",
  },
  flame: {
    name: "火焰兵", short: "近距離燒一片，剋擠在一起的步兵", cost: 100, pop: 1, hp: 130, damage: 13, cooldown: 0.5,
    range: 55, speed: 27, armor: "soft", weapon: "flame", members: 2, splash: 24, hotkey: "4",
  },
  car: {
    name: "裝甲車", short: "跑最快的輕裝甲，搶點、追殺步兵", cost: 140, pop: 2, hp: 260, damage: 7, cooldown: 0.35,
    range: 115, speed: 46, armor: "light", weapon: "mg", members: 1, hotkey: "5",
  },
  tank: {
    name: "戰車", short: "厚甲突破，剋步兵與裝甲車", cost: 220, pop: 3, hp: 480, damage: 45, cooldown: 1.8,
    range: 115, speed: 27, armor: "hard", weapon: "cannon", members: 1, hotkey: "6",
  },
  at: {
    name: "反戰車砲", short: "專打戰車與裝甲車", cost: 110, pop: 1, hp: 100, damage: 70, cooldown: 2.5,
    range: 150, speed: 20, armor: "soft", weapon: "at", members: 3, hotkey: "7",
  },
  flak: {
    name: "防空砲車", short: "跟著部隊打飛機，也能平射", cost: 150, pop: 2, hp: 220, damage: 10, cooldown: 0.45,
    range: 120, speed: 30, armor: "light", weapon: "flak", members: 1, airDamage: 30, airCooldown: 0.45, airRange: 230, hotkey: "8",
  },
  artillery: {
    name: "砲兵", short: "遠程範圍傷害，70 以內打不到", cost: 180, pop: 2, hp: 70, damage: 30, cooldown: 4.0,
    range: 200, minRange: 70, speed: 18, armor: "soft", weapon: "shell", members: 2, splash: 32, hotkey: "9",
  },
  engineer: {
    name: "工兵", short: "爆破堡壘、修理建築與車輛、加快施工", cost: 90, pop: 1, hp: 90, damage: 30, cooldown: 1.5,
    range: 50, speed: 28, armor: "soft", weapon: "demo", members: 2, repair: 30, hotkey: "0",
  },
  medic: {
    name: "醫療兵", short: "幫附近步兵回血，不會攻擊", cost: 70, pop: 1, hp: 80, damage: 0, cooldown: 1,
    range: 80, speed: 30, armor: "soft", weapon: "none", members: 2, heal: 7, healTargets: 3, hotkey: "-",
  },
  para: {
    name: "空降兵", short: "由運輸機投放", cost: 100, pop: 1, hp: 100, damage: 12, cooldown: 1.0,
    range: 90, speed: 32, armor: "soft", weapon: "rifle", members: 4, hotkey: "",
  },
};

// ---------- 空軍 ----------
export type AirKind = "bomber" | "transport";
export const AIR_KINDS: AirKind[] = ["bomber", "transport"];

export interface AirDef {
  name: string;
  short: string;
  cost: number;
  cooldown: number;
  hp: number;
  speed: number; // 畫面座標每秒
  hotkey: string;
}
export const AIRCRAFT: Record<AirKind, AirDef> = {
  bomber: { name: "轟炸機", short: "對任一路線地毯式轟炸", cost: 240, cooldown: 25, hp: 280, speed: 270, hotkey: "B" },
  transport: { name: "空降", short: "把兩班空降兵丟到敵後", cost: 200, cooldown: 30, hp: 260, speed: 240, hotkey: "P" },
};
export const AIR_UNLOCK_TIME = 30; // 開局幾秒後才能叫空軍
export const BOMB = { count: 5, spacing: 26, interval: 0.14, damage: 85, radius: 38, weapon: "bomb" as WeaponClass };
export const PARA_SQUADS = 2;
export const PARA_LAND_TIME = 1.6; // 跳傘到落地的秒數

// ---------- 據點（大本營、堡壘）與工事（塔防） ----------
export type StructureKind = "hq" | "fort" | "bigfort" | "bunker" | "atnest" | "aa";
export type BuildKind = "bunker" | "atnest" | "aa";
export const BUILD_KINDS: BuildKind[] = ["bunker", "atnest", "aa"];

export interface StructureDef {
  name: string;
  short: string;
  cost: number;
  hp: number;
  damage: number; // 對地
  cooldown: number;
  range: number;
  weapon: WeaponClass;
  airDamage: number; // 對空
  airCooldown: number;
  airRange: number;
  buildTime?: number; // 工事施工秒數（附近有工兵會比較快）
}

export const STRUCTURES: Record<StructureKind, StructureDef> = {
  hq: {
    name: "大本營", short: "被打爆就出局", cost: 0, hp: 4000, damage: 60, cooldown: 1.0, range: 200, weapon: "cannon",
    airDamage: 22, airCooldown: 0.6, airRange: 230,
  },
  fort: {
    name: "堡壘", short: "攻破後可以佔領", cost: 0, hp: 1500, damage: 38, cooldown: 1.0, range: 175, weapon: "cannon",
    airDamage: 15, airCooldown: 0.7, airRange: 210,
  },
  bigfort: {
    name: "大型堡壘", short: "血多、收入高", cost: 0, hp: 2400, damage: 48, cooldown: 1.0, range: 185, weapon: "cannon",
    airDamage: 18, airCooldown: 0.6, airRange: 220,
  },
  bunker: {
    name: "機槍碉堡", short: "壓制步兵", cost: 140, hp: 800, damage: 18, cooldown: 0.35, range: 160, weapon: "mg",
    airDamage: 0, airCooldown: 1, airRange: 0, buildTime: 12,
  },
  atnest: {
    name: "反戰車砲陣地", short: "擋住戰車", cost: 170, hp: 700, damage: 150, cooldown: 2.4, range: 180, weapon: "at",
    airDamage: 0, airCooldown: 1, airRange: 0, buildTime: 15,
  },
  aa: {
    name: "防空砲", short: "打下經過的飛機", cost: 150, hp: 450, damage: 0, cooldown: 1, range: 0, weapon: "mg",
    airDamage: 55, airCooldown: 0.5, airRange: 290, buildTime: 12,
  },
};

// 施工：一開始只有 25% 血、不能開火，蓋好才滿血
export const BUILD_START_HP = 0.25;
export const ENGINEER_BUILD_BONUS = 1.0; // 附近每個工兵 +100% 施工速度
export const ENGINEER_BUILD_MAX = 3.0; // 最多 +300%
export const ENGINEER_BUILD_RANGE = 90;

// ---------- 堡壘改建（佔下來的堡壘可以改成不同用途） ----------
export type FortSpec = "" | "battery" | "barracks" | "depot" | "flak" | "hospital";
export const FORT_SPECS: Exclude<FortSpec, "">[] = ["battery", "barracks", "depot", "flak", "hospital"];
export const FORT_SPEC_DEFS: Record<Exclude<FortSpec, "">, { name: string; short: string; cost: number }> = {
  battery: { name: "砲台", short: "對地火力 +60%、射程 +30，駐軍上限 -4", cost: 150 },
  barracks: { name: "兵營", short: "駐軍上限 +8、駐軍回血加倍、在這裡買兵 85 折，火力 -20%", cost: 120 },
  depot: { name: "補給站", short: "收入 +2.5/秒，但血量 -20%", cost: 140 },
  flak: { name: "防空要塞", short: "對空火力 ×3、對空射程 +80", cost: 110 },
  hospital: { name: "野戰醫院", short: "附近 160 內的己方步兵每秒回 6 血、駐軍回血加倍", cost: 130 },
};
export const CONVERT_TIME = 10; // 改建要幾秒（期間沒有特殊效果）
export const BATTERY_DAMAGE = 1.6;
export const BATTERY_RANGE = 30;
export const BARRACKS_CAP = 8;
export const BARRACKS_DISCOUNT = 0.85;
export const BATTERY_CAP = -4;
export const DEPOT_INCOME = 2.5;
export const DEPOT_HP = 0.8;
export const FLAK_FORT_AIR = 3;
export const FLAK_FORT_RANGE = 80;
export const HOSPITAL_HEAL = 6;
export const HOSPITAL_RANGE = 160;

// ---------- 隨機事件 ----------
export type EventKind = "supply" | "storm" | "barrage" | "reinforce" | "fuel" | "bounty";
export const EVENT_KINDS: EventKind[] = ["supply", "storm", "barrage", "reinforce", "fuel", "bounty"];
export const EVENTS: Record<EventKind, { name: string; desc: string; duration: number }> = {
  supply: { name: "補給空投", desc: "地圖上空投了 2 個補給箱，部隊先碰到的人拿 $200", duration: 45 },
  storm: { name: "暴風雨", desc: "飛機無法起飛，所有射程 -20%", duration: 30 },
  barrage: { name: "砲擊彈幕", desc: "不明砲火無差別轟炸，看到紅圈快躲開", duration: 16 },
  reinforce: { name: "援軍抵達", desc: "堡壘最少的玩家，大本營免費多 3 支部隊", duration: 6 },
  fuel: { name: "燃料短缺", desc: "戰車、裝甲車、防空砲車移動速度減半", duration: 30 },
  bounty: { name: "戰功懸賞", desc: "擊殺敵軍的賞金加倍", duration: 40 },
};
export const EVENT_FIRST = 70; // 第一個事件在開局幾秒後
export const EVENT_GAP: [number, number] = [45, 75]; // 事件結束後隔多久出下一個
export const SUPPLY_AMOUNT = 200;
export const CRATE_RADIUS = 34;
export const CRATE_LAND_TIME = 2.5;
export const STORM_RANGE = 0.8;
export const FUEL_SPEED = 0.5;
export const BOUNTY_EVENT_MULT = 2;
export const BARRAGE = { interval: 0.7, warn: 2, radius: 40, damage: 70, weapon: "bomb" as WeaponClass };

// 自己的據點旁邊，每條路上可以蓋工事的位置（距離據點幾像素）
export const BUILD_SLOTS = [95, 170];
/** 這條路的這一格放得下工事嗎（太短的路只有第一格） */
export function slotFits(laneLength: number, slot: number) {
  return slot >= 0 && slot < BUILD_SLOTS.length && BUILD_SLOTS[slot] + 60 <= laneLength / 2;
}

// ---------- 升級 ----------
export type UpgradeKind = "firepower" | "armor" | "logistics";
export const UPGRADE_KINDS: UpgradeKind[] = ["firepower", "armor", "logistics"];
export const MAX_UPGRADE_LEVEL = 3;

export const UPGRADES: Record<UpgradeKind, { name: string; short: string; costs: number[]; hotkey: string }> = {
  firepower: { name: "火力", short: "部隊、工事、炸彈傷害 +15%", costs: [150, 300, 500], hotkey: "Z" },
  armor: { name: "裝甲", short: "部隊與工事血量 +15%", costs: [150, 300, 500], hotkey: "X" },
  logistics: { name: "後勤", short: "收入 +1.5/秒、空軍冷卻 -10%", costs: [120, 260, 450], hotkey: "C" },
};
export const FIREPOWER_PER_LEVEL = 0.15;
export const ARMOR_PER_LEVEL = 0.15;
export const LOGISTICS_INCOME_PER_LEVEL = 1.5;
export const LOGISTICS_COOLDOWN_PER_LEVEL = 0.1;

// ---------- 前後端訊息格式 ----------
import type { Dest } from "./map";
export interface BuyMsg { node: number; type: UnitType; count: number }
/** 從據點派兵：counts 依 UNIT_TYPES 順序，via 是途經的據點，enter = 到了／佔下目的地據點後進駐 */
export interface DispatchMsg { node: number; counts: number[]; via: number[]; dest: Dest; enter: boolean }
/** 調度已經在野外的部隊 */
export interface OrderMsg { units: string[]; via: number[]; dest: Dest; enter: boolean }
export interface RetreatMsg { units: string[] }
export interface BuildMsg { lane: number; node: number; slot: number; kind: BuildKind }
export interface ConvertMsg { node: number; spec: FortSpec }
export interface UpgradeMsg { kind: UpgradeKind }
export interface AirMsg { kind: AirKind; lane: number; x: number }
export interface AddBotMsg { faction?: number }
export interface RemovePlayerMsg { id: string }
export interface SetFactionMsg { faction: number }
export interface SetMapMsg { map: string } // "random" = 隨機

// 伺服器廣播給所有人的事件（畫特效、跳提示用）
export interface BombEvent { lane: number; x: number }
export interface ParadropEvent { lane: number; x: number; faction: number }
export interface AirDownEvent { x: number; y: number; angle: number; kind: AirKind }
export interface AirIncomingEvent { owner: string; faction: number; kind: AirKind; lane: number; x: number }
export interface EliminatedEvent { id: string; name: string; faction: number; by: string }
export interface HqAlertEvent { owner: string; level: number }
export interface CapturedEvent { node: number; by: string; faction: number }
export interface LeaderEvent { id: string; faction: number } // id = "" 代表沒人被懸賞
export interface FortFallenEvent { node: number; owner: string; faction: number; by: string }
export interface NoticeEvent { text: string }

export type Phase = "lobby" | "playing" | "ended";
export const WINNER_DRAW = "draw";

/** 房主把玩家移出房間時用的關閉代碼（Colyseus 的 4000 是「自願離開」，不能拿來用） */
export const KICK_CODE = 4100;

// ---------- 結算的勢力變化圖 ----------
export const HISTORY_INTERVAL = 5; // 每幾秒記一次
/** 勢力 = 部隊價值（造價 × 剩餘血量比例）＋工事價值＋據點價值 */
export const NODE_POWER: Record<string, number> = { hq: 400, bigfort: 250, fort: 150 };
export interface HistorySample {
  t: number;
  /** 玩家 id → [勢力, 兵力（部隊價值）, 據點數] */
  v: Record<string, [number, number, number]>;
}
export interface BattleHistory {
  players: { id: string; name: string; faction: number }[];
  samples: HistorySample[];
  out: { t: number; id: string }[]; // 出局時間
}

// ---------- 電腦難度 ----------
export type BotLevel = "easy" | "normal" | "hard" | "brutal";
export const BOT_LEVELS: BotLevel[] = ["easy", "normal", "hard", "brutal"];
export const BOT_LEVEL_DEFS: Record<BotLevel, { name: string; short: string }> = {
  easy: { name: "簡單", short: "反應慢、兵一買就零星送上來、只出基本兵種" },
  normal: { name: "普通", short: "會蓋工事、升級、叫空軍，集滿人數才進攻" },
  hard: { name: "困難", short: "集中兵力算好才打、被打時即時補兵、會剋制你的兵種" },
  brutal: { name: "地獄", short: "困難的打法，再加上收入 +30%" },
};
export const BRUTAL_INCOME = 1.3;
export const isBotLevel = (v: unknown): v is BotLevel => typeof v === "string" && (BOT_LEVELS as string[]).includes(v);
