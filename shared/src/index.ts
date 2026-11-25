// 前後端共用的遊戲規則與數值。
// 平衡調整只要改這個檔案，伺服器和畫面會一起更新。
export * from "./map";

export const ROOM_NAME = "battle";

// ---------- 對局 ----------
export const TICK_RATE = 20; // 伺服器每秒模擬幾次
export const MATCH_SECONDS = 600; // 一局最多 10 分鐘
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;
export const SPAWN_OFFSET = 30; // 部隊從距離據點多遠的地方出發（像素）
export const MAX_UNITS_PER_PLAYER = 40;

// ---------- 經濟 ----------
export const START_FUNDS = 250;
export const BASE_INCOME = 5; // 每秒固定收入
export const FORT_INCOME = 2; // 每座堡壘每秒收入
export const BIG_FORT_INCOME = 3.5; // 大型堡壘每秒收入
export const BOUNTY_RATIO = 0.25; // 擊殺獲得對方造價的 25%
export const HQ_KILL_BOUNTY = 300; // 打爆一座大本營的獎勵
export const FORT_BREAK_BOUNTY = 120; // 攻破一座堡壘的獎勵

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
export type ArmorClass = "soft" | "hard" | "building";
export type WeaponClass = "rifle" | "mg" | "at" | "cannon" | "shell" | "bomb";
// 距離、速度都是畫面上的像素

// 傷害倍率：武器打不同護甲的效果。剋制關係主要從這裡來。
export const DAMAGE_TABLE: Record<WeaponClass, Record<ArmorClass, number>> = {
  rifle: { soft: 1.0, hard: 0.15, building: 0.5 },
  mg: { soft: 1.0, hard: 0.1, building: 0.3 },
  at: { soft: 0.35, hard: 2.0, building: 1.0 },
  cannon: { soft: 1.0, hard: 1.0, building: 1.3 },
  shell: { soft: 1.0, hard: 0.5, building: 1.6 },
  bomb: { soft: 1.0, hard: 0.8, building: 1.4 },
};

// ---------- 地面部隊 ----------
export type UnitType = "rifle" | "mg" | "at" | "tank" | "artillery" | "para";
/** 可以從指揮部出兵的兵種（空降兵只能由運輸機投放） */
export const UNIT_TYPES: UnitType[] = ["rifle", "mg", "at", "tank", "artillery"];

export interface UnitDef {
  name: string;
  short: string; // 按鈕上的說明
  cost: number;
  hp: number;
  damage: number;
  cooldown: number; // 射擊間隔（秒）
  range: number;
  speed: number; // 每秒移動距離
  armor: ArmorClass;
  weapon: WeaponClass;
  deployCooldown: number; // 同一兵種兩次部署的間隔（秒）
  members: number; // 畫面上顯示幾個人／幾輛
  splash?: number; // 爆炸範圍（砲兵）
  hotkey: string;
}

export const UNITS: Record<UnitType, UnitDef> = {
  rifle: {
    name: "步兵班", short: "便宜耐打，剋反戰車砲", cost: 50, hp: 110, damage: 11, cooldown: 1.0,
    range: 90, speed: 30, armor: "soft", weapon: "rifle", deployCooldown: 1.0, members: 4, hotkey: "1",
  },
  mg: {
    name: "機槍組", short: "射程遠、壓制步兵", cost: 85, hp: 100, damage: 8, cooldown: 0.3,
    range: 125, speed: 24, armor: "soft", weapon: "mg", deployCooldown: 2.0, members: 2, hotkey: "2",
  },
  at: {
    name: "反戰車砲", short: "專打戰車與工事", cost: 110, hp: 100, damage: 70, cooldown: 2.5,
    range: 150, speed: 20, armor: "soft", weapon: "at", deployCooldown: 3.0, members: 3, hotkey: "3",
  },
  tank: {
    name: "戰車", short: "厚甲突破，剋步兵", cost: 220, hp: 480, damage: 45, cooldown: 1.8,
    range: 115, speed: 27, armor: "hard", weapon: "cannon", deployCooldown: 6.0, members: 1, hotkey: "4",
  },
  artillery: {
    name: "砲兵", short: "超遠射程範圍傷害，怕近身", cost: 160, hp: 70, damage: 38, cooldown: 3.5,
    range: 250, speed: 18, armor: "soft", weapon: "shell", deployCooldown: 5.0, members: 2, splash: 42, hotkey: "5",
  },
  para: {
    name: "空降兵", short: "由運輸機投放", cost: 100, hp: 100, damage: 12, cooldown: 1.0,
    range: 90, speed: 32, armor: "soft", weapon: "rifle", deployCooldown: 0, members: 4, hotkey: "",
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
}

export const STRUCTURES: Record<StructureKind, StructureDef> = {
  hq: {
    name: "大本營", short: "被打爆就出局", cost: 0, hp: 4000, damage: 24, cooldown: 1.0, range: 150, weapon: "cannon",
    airDamage: 15, airCooldown: 0.6, airRange: 220,
  },
  fort: {
    name: "堡壘", short: "攻破後可以佔領", cost: 0, hp: 1500, damage: 15, cooldown: 1.0, range: 135, weapon: "cannon",
    airDamage: 10, airCooldown: 0.7, airRange: 200,
  },
  bigfort: {
    name: "大型堡壘", short: "血多、收入高", cost: 0, hp: 2400, damage: 20, cooldown: 1.0, range: 145, weapon: "cannon",
    airDamage: 12, airCooldown: 0.6, airRange: 210,
  },
  bunker: {
    name: "機槍碉堡", short: "壓制步兵", cost: 140, hp: 650, damage: 9, cooldown: 0.35, range: 145, weapon: "mg",
    airDamage: 0, airCooldown: 1, airRange: 0,
  },
  atnest: {
    name: "反戰車砲陣地", short: "擋住戰車", cost: 170, hp: 550, damage: 80, cooldown: 2.4, range: 165, weapon: "at",
    airDamage: 0, airCooldown: 1, airRange: 0,
  },
  aa: {
    name: "防空砲", short: "打下經過的飛機", cost: 150, hp: 450, damage: 0, cooldown: 1, range: 0, weapon: "mg",
    airDamage: 40, airCooldown: 0.5, airRange: 280,
  },
};

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
  logistics: { name: "後勤", short: "收入 +1.5/秒、所有冷卻 -10%", costs: [120, 260, 450], hotkey: "C" },
};
export const FIREPOWER_PER_LEVEL = 0.15;
export const ARMOR_PER_LEVEL = 0.15;
export const LOGISTICS_INCOME_PER_LEVEL = 1.5;
export const LOGISTICS_COOLDOWN_PER_LEVEL = 0.1;

// ---------- 前後端訊息格式 ----------
export interface SpawnMsg { type: UnitType; lane: number; node: number }
export interface BuildMsg { lane: number; node: number; slot: number; kind: BuildKind }
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
export interface CapturedEvent { node: number; by: string; faction: number; from: string }
export interface FortFallenEvent { node: number; owner: string; faction: number; by: string }
export interface NoticeEvent { text: string }

export type Phase = "lobby" | "playing" | "ended";
export const WINNER_DRAW = "draw";
