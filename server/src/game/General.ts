// 將軍：會「算」的電腦。
//
// 跟原本的電腦（Bot.ts）一樣只用玩家指令，但每個決定都先估算：
//   - 戰鬥模擬：雙方兵力依傷害表、射程、血量、醫療、範圍傷害、堡壘火力與駐軍、
//     對方之後趕到的援軍（附近野戰軍、駐軍、用存款當場補的兵）粗略打一遍，
//     看誰剩下多少，划算才打；打不贏的仗及早撤退，保住兵力也不讓對方領賞金。
//   - 經濟：先搶無主堡壘、升後勤、後方堡壘改補給站、前線開兵營（買兵 85 折）；
//     不在堡壘裡囤兵（駐軍養兵費會越來越貴），主力在堡壘前的路上待命。
//   - 兵種：看對手的兵種、要打的堡壘和工事，算每種兵加進來能多出多少戰力（蘭徹斯特平方律的邊際值），
//     挑每塊錢效益最高的；醫療兵、工兵、防空砲車按需要帶。
//   - 兵法：集中兵力（先在敵方射程外集結，到齊才一起突擊）、避實擊虛（挑防守弱、對方主力不在的地方）、
//     圍點打援（守在自己堡壘火力下迎擊）、被打時評估守不守得住（調主力、當場補兵、叫轟炸、守不住就撤出）、
//     轟炸機挑兵力密集又沒有防空的地方、空降兵搶遠方無主堡壘、特種部隊獵殺對方最值錢的兵種、
//     有時限的對局最後階段算堡壘數（領先就守、落後就搶）。
import {
  AIRCRAFT,
  AIR_KINDS,
  BOMB,
  BUILD_SLOTS,
  CAPTURE_TIME,
  DAMAGE_TABLE,
  FIREPOWER_PER_LEVEL,
  FORT_SPEC_DEFS,
  GARRISON_FIRE_BONUS,
  GARRISON_FIRE_MAX,
  LOGISTICS_INCOME_PER_LEVEL,
  MAX_UPGRADE_LEVEL,
  POP_CAP,
  STRUCTURES,
  UNITS,
  UNIT_TYPES,
  UPGRADES,
  BATTERY_DAMAGE,
  BATTERY_RANGE,
  DEPOT_INCOME,
  FORT_INCOME,
  BIG_FORT_INCOME,
  lanePoint,
  nodeDir,
  nodeEnd,
  planRoute,
  type ArmorClass,
  type BuildKind,
  type Dest,
  type FortSpec,
  type StructureKind,
  type UnitType,
} from "@frontline/shared";
import type { Battle } from "./Battle";
import { MATCH_SMALL, MATCH_TYPES } from "./matchups";
import type { Player, Structure, Unit } from "./schema";

export interface GeneralOptions {
  /** false = 反應慢一點、不做細部操作（給「困難」用） */
  sharp?: boolean;
}

const ARMORS: ArmorClass[] = ["soft", "light", "hard", "building"];
const AI = { soft: 0, light: 1, hard: 2, building: 3 } as const;

/** 戰鬥模擬裡的一疊兵（同一種兵種合在一起） */
interface Stack {
  type: string;
  armor: number; // ARMORS 的索引
  hp: number;
  max: number;
  unitHp: number;
  dps: number[]; // 每一個單位對四種護甲的每秒傷害
  range: number;
  heal: number; // 每一個單位每秒幫步兵回多少血
  splash: number; // 範圍傷害半徑（0 = 沒有）
  worth: number; // 每 1 血值多少錢
  join: number; // 幾秒後加入戰鬥；-1 = 堡壘被攻破才出來（駐軍）
  speed: number;
  delay?: number; // 模擬用：開始開火前要走幾秒
  regen?: number; // 每秒自己回多少血（據點裡的工兵在修）
  fort?: boolean;
}

interface SimResult {
  win: boolean; // 進攻方把防守方全部打光
  aLeft: number; // 進攻方剩下的價值比例
  bLeft: number;
  aLoss: number; // 進攻方損失的價值（錢）
  bLoss: number;
  t: number;
}

interface Op {
  target: number;
  phase: "gather" | "assault";
  assembly: Dest;
  since: number;
  units: Set<string>;
  expect: number; // 開打前估計的勝算（進攻方剩下比例）
}

/** 各兵種作戰數值（還沒乘上升級） */
function baseDps(type: UnitType): number[] {
  const d = UNITS[type];
  if (!d.damage) return [0, 0, 0, 0];
  // 引擎每 0.05 秒算一次，冷卻到 0 的那一格（浮點誤差）通常會多等一格
  const per = d.damage / (d.cooldown + 0.05);
  return ARMORS.map((a) => per * DAMAGE_TABLE[d.weapon][a]);
}
const DPS: Record<string, number[]> = {};
for (const t of [...UNIT_TYPES, "para" as UnitType]) DPS[t] = baseDps(t);

// 戰鬥模擬的兩個校正值（用 scripts/simcheck.ts 對引擎實測的對打調出來的）
const SPLASH_GAP = 8; // 停下來打的兵大約每幾像素一個（範圍傷害打到幾個）
const RAMP = 0.5; // 一排兵走進射程的時間 × 這個倍率

export class GeneralBrain {
  private nextThink: number;
  private think: [number, number];
  private sharp: boolean;
  private dist: number[][] = [];
  private mapId = "";
  private op: Op | null = null;
  private captures = new Map<number, { units: string[]; until: number }>(); // 無主堡壘 → 派去佔領的部隊
  private sawAir = -999;
  private enemyAirCount = 0;
  private seenAir = new Set<string>();
  private lastDefense = new Map<number, number>();
  private nextSlow = 0;
  private retreating = new Set<string>();
  private barracksNode = -1;
  private nextPlan = 0;
  private guard: { node: number; until: number } | null = null; // 主力被調回去守的據點
  private avoid = new Map<number, number>(); // 剛放棄的目標 → 幾秒前不再考慮
  private nextCheck = 0;
  private nextLocal = 0;
  private nextRedeploy = 0;
  private debug = false;
  private now = 0;

  /** 指令成功就記一筆 */
  private did(msg: string, r: string | null) {
    if (r === null) this.log(msg);
    return r;
  }

  private dump(st: Stack[]) {
    return st.map((x) => `${x.type}${x.fort ? "■" : ""}:${Math.round(x.fort ? x.hp : x.hp * x.worth)}${x.join ? `@${x.join}` : ""}`).join(" ");
  }

  private log(msg: string) {
    if (this.debug) console.log(`  [${this.playerId} ${this.now.toFixed(0)}s] ${msg}`);
  }

  constructor(
    public playerId: string,
    private rng: () => number = Math.random,
    opts: GeneralOptions = {},
  ) {
    this.sharp = opts.sharp !== false;
    this.debug = process.env.GENERAL_DEBUG === playerId || process.env.GENERAL_DEBUG === "all";
    this.think = this.sharp ? [0.3, 0.5] : [0.6, 1.0];
    this.nextThink = 0.3 + rng() * 0.4;
  }

  // ================================================================ 主迴圈

  update(battle: Battle, dt: number) {
    const s = battle.state;
    if (s.phase !== "playing") return;
    this.nextThink -= dt;
    if (this.nextThink > 0) return;
    this.nextThink = this.think[0] + this.rng() * (this.think[1] - this.think[0]);
    const p = s.players.get(this.playerId);
    if (!p || !p.alive) return;
    if (this.mapId !== s.mapId || this.dist.length !== battle.map.nodes.length) this.precompute(battle);

    this.now = s.time;
    const w = new World(battle, p, this.dist);
    if (w.owned.length === 0) return;
    this.watchAir(battle);

    this.defend(w); // 先顧家
    this.economy(w); // 擴張、升級、改建
    this.campaign(w); // 主力：挑目標、集結、突擊、撤退
    this.expand(w); // 派小部隊佔無主堡壘
    this.buyArmy(w); // 剩下的錢買主力
    this.micro(w); // 傷兵撤退、整補、獵殺目標
    this.air(w);
    if (s.time >= this.nextSlow) {
      this.nextSlow = s.time + 2;
      this.towers(w);
      this.upgrades(w);
    }
  }

  private precompute(battle: Battle) {
    this.mapId = battle.state.mapId;
    const n = battle.map.nodes.length;
    // 全部兩兩距離（Dijkstra，據點最多幾十個）
    const d: number[][] = [];
    for (let i = 0; i < n; i++) {
      const row = new Array(n).fill(Infinity);
      row[i] = 0;
      const done = new Array(n).fill(false);
      for (;;) {
        let k = -1;
        for (let j = 0; j < n; j++) if (!done[j] && row[j] < Infinity && (k < 0 || row[j] < row[k])) k = j;
        if (k < 0) break;
        done[k] = true;
        for (const li of battle.map.adj[k]) {
          const L = battle.map.lanes[li];
          const o = L.a === k ? L.b : L.a;
          if (row[k] + L.len < row[o]) row[o] = row[k] + L.len;
        }
      }
      d.push(row);
    }
    this.dist = d;
    this.op = null;
    this.captures.clear();
  }

  private watchAir(battle: Battle) {
    battle.state.aircraft.forEach((a) => {
      if (a.owner === this.playerId || this.seenAir.has(a.id)) return;
      this.seenAir.add(a.id);
      this.sawAir = battle.state.time;
      this.enemyAirCount += 1;
    });
  }

  // ================================================================ 戰鬥模擬

  /** 測試用：花 budget 買同一種兵的一疊 */
  debugStack(type: UnitType, budget: number): Stack {
    const d = UNITS[type];
    const n = Math.max(1, Math.round(budget / d.cost));
    return {
      type, armor: AI[d.armor], hp: n * d.hp, max: n * d.hp, unitHp: d.hp, dps: DPS[type], range: d.range,
      heal: (d.heal ?? 0) * (d.healTargets ?? 1), splash: d.splash ?? 0, worth: d.cost / d.hp, join: 0, speed: d.speed,
    };
  }

  /** 把一群部隊依兵種合成幾疊 */
  private stacksOf(w: World, units: Unit[], join = 0): Stack[] {
    const by = new Map<string, Stack>();
    for (const u of units) {
      const type = u.type as UnitType;
      const key = `${u.owner}:${type}:${join}`;
      let st = by.get(key);
      if (!st) {
        const def = UNITS[type];
        const fp = w.fp(u.owner);
        st = {
          type,
          armor: AI[def.armor],
          hp: 0,
          max: 0,
          unitHp: u.maxHp,
          dps: DPS[type].map((v) => v * fp),
          range: def.range,
          heal: (def.heal ?? 0) * (def.healTargets ?? 1) * fp,
          splash: def.splash ?? 0,
          worth: def.cost / u.maxHp,
          join,
          speed: def.speed,
        };
        by.set(key, st);
      }
      st.hp += Math.max(0, u.hp);
      st.max += u.maxHp;
    }
    return [...by.values()];
  }

  /** 一座有主的據點本身（含駐軍火力加成、砲台） */
  private fortStack(w: World, node: number, extraGarrisonPop = 0): Stack | null {
    const n = w.s.nodes[node];
    if (!n.owner || n.hp <= 0) return null;
    const def = STRUCTURES[n.kind as StructureKind];
    const spec = n.spec && n.specDone ? (n.spec as FortSpec) : "";
    const gpop = w.battle.garrisonAt(node) + extraGarrisonPop;
    const bonus = 1 + Math.min(GARRISON_FIRE_MAX, gpop * GARRISON_FIRE_BONUS);
    const specDmg = spec === "battery" ? BATTERY_DAMAGE : spec === "barracks" ? 0.8 : 1;
    const per = (def.damage / def.cooldown) * w.fp(n.owner) * bonus * specDmg;
    let fixers = 0;
    w.s.units.forEach((u) => {
      if (u.inNode === node && u.owner === n.owner && u.type === "engineer" && u.hp > 0) fixers += 1;
    });
    return {
      regen: fixers * (UNITS.engineer.repair ?? 30) * 0.6,
      type: "fort",
      armor: AI.building,
      hp: n.hp,
      max: n.maxHp,
      unitHp: n.maxHp,
      dps: ARMORS.map((a) => per * DAMAGE_TABLE[def.weapon][a]),
      range: def.range + (spec === "battery" ? BATTERY_RANGE : 0),
      heal: 0,
      splash: 0,
      worth: 0,
      join: 0,
      speed: 0,
      fort: true,
    };
  }

  private structStack(w: World, st: Structure): Stack {
    const def = STRUCTURES[st.kind as StructureKind];
    const per = st.progress >= 0.8 && def.damage > 0 ? (def.damage / def.cooldown) * w.fp(st.owner) : 0;
    return {
      type: st.kind,
      armor: AI.building,
      hp: st.hp,
      max: st.maxHp,
      unitHp: st.maxHp,
      dps: ARMORS.map((a) => per * DAMAGE_TABLE[def.weapon][a]),
      range: def.range,
      heal: 0,
      splash: 0,
      worth: def.cost / st.maxHp,
      join: 0,
      speed: 0,
      fort: true,
    };
  }

  /** 用存款當場在據點補兵：當成一疊會在堡壘被攻破時衝出來的兵 */
  private reinforceStack(w: World, owner: Player, node: number, money: number, join = -1): Stack | null {
    const room = Math.max(0, w.battle.garrisonCapAt(node) - w.battle.garrisonAt(node));
    const popRoom = Math.max(0, POP_CAP - owner.pop);
    const value = Math.min(money, Math.min(room, popRoom) * 75);
    if (value < 40) return null;
    // 混合兵（步兵、機槍、反戰車）：每塊錢大約的血量與火力
    const hp = value * 1.6;
    const fp = w.fp(owner.id);
    return {
      type: "reinforce",
      armor: AI.soft,
      hp,
      max: hp,
      unitHp: 105,
      dps: [16 * fp, 14 * fp, 12 * fp, 6 * fp],
      range: 120,
      heal: 0,
      splash: 0,
      worth: value / hp,
      join,
      speed: 26,
    };
  }

  /**
   * 進攻方 A 對防守方 B 打到一方全滅（最多 maxT 秒）。
   * 每一疊把火力依「對方各疊的血量 × 暴露程度」分攤；堡壘、工事打不到射程比它遠的兵（砲兵、狙擊手）。
   */
  simulate(A: Stack[], B: Stack[], maxT = 90): SimResult {
    const a = A.map((x) => ({ ...x }));
    const b = B.map((x) => ({ ...x }));
    const worth = (side: Stack[]) => side.reduce((v, x) => v + x.hp * x.worth, 0);
    const a0 = worth(a);
    const b0 = worth(b);
    let fortDeadB = !b.some((x) => x.fort && x.type === "fort");
    let fortDeadA = !a.some((x) => x.fort && x.type === "fort");
    const dt = 1;
    let t = 0;
    // 射程短的要先頂著對方火力走近才能開火（最多 10 秒）；堡壘、工事不用走
    const reach = (side: Stack[]) => side.reduce((r, x) => (x.dps.some((v) => v > 0) ? Math.max(r, x.range) : r), 0);
    const ra = reach(a);
    const rb = reach(b);
    for (const x of a) x.delay = x.fort ? 0 : Math.min(10, Math.max(0, rb - x.range) / Math.max(15, x.speed));
    for (const x of b) x.delay = x.fort ? 0 : Math.min(10, Math.max(0, ra - x.range) / Math.max(15, x.speed));
    const alive = (x: Stack, fortDead: boolean) => x.hp > 0 && (x.join === -1 ? fortDead : x.join <= t);
    const pending = (side: Stack[], fortDead: boolean) => side.some((x) => x.hp > 0 && !alive(x, fortDead));
    for (; t < maxT; t += dt) {
      const la = a.filter((x) => alive(x, fortDeadA));
      const lb = b.filter((x) => alive(x, fortDeadB));
      if (la.length === 0 && !pending(a, fortDeadA)) break;
      if (lb.length === 0 && !pending(b, fortDeadB)) break;
      const da = this.volley(lb, la, t);
      const db = this.volley(la, lb, t);
      la.forEach((x, i) => (x.hp = Math.max(0, x.hp - da[i] * dt)));
      lb.forEach((x, i) => (x.hp = Math.max(0, x.hp - db[i] * dt)));
      for (const x of [...la, ...lb]) if (x.regen && x.hp > 0) x.hp = Math.min(x.max, x.hp + x.regen * dt);
      this.healSide(la, dt);
      this.healSide(lb, dt);
      if (!fortDeadB && !b.some((x) => x.type === "fort" && x.hp > 0)) fortDeadB = true;
      if (!fortDeadA && !a.some((x) => x.type === "fort" && x.hp > 0)) fortDeadA = true;
    }
    const aw = worth(a);
    const bw = worth(b);
    const bAlive = b.some((x) => x.hp > 0 && (x.dps.some((v) => v > 0) || x.fort));
    const aAlive = a.some((x) => x.hp > 0 && x.dps.some((v) => v > 0));
    return {
      win: !bAlive && aAlive,
      aLeft: a0 > 0 ? aw / a0 : 0,
      bLeft: b0 > 0 ? bw / b0 : bAlive ? 1 : 0,
      aLoss: a0 - aw,
      bLoss: b0 - bw,
      t,
    };
  }

  /** shooters 對 targets 每一疊每秒造成多少傷害 */
  private volley(shooters: Stack[], targets: Stack[], t: number): number[] {
    const out = new Array(targets.length).fill(0);
    if (targets.length === 0) return out;
    const nonFort = targets.some((x) => !x.fort);
    const countUnits = targets.reduce((n, x) => n + (x.fort ? 0 : x.hp / x.unitHp), 0);
    for (const s of shooters) {
      const n = s.fort ? 1 : s.hp / s.unitHp;
      if (n <= 0 || s.dps.every((v) => v === 0)) continue;
      // 駐軍、援軍出來之後也要走近；從加入的時間開始算
      const start = s.join > 0 ? s.join : 0;
      if (t < start + (s.delay ?? 0)) continue;
      let wsum = 0;
      const ws = targets.map((t) => {
        // 堡壘、工事打不到射程比它遠的兵
        if (s.fort && t.range > s.range + 5) return 0;
        let e = t.hp;
        if (t.armor === AI.hard) e *= 1.5; // 戰車走在前面吃砲火
        else if (t.armor === AI.light) e *= 1.2;
        if (t.fort && nonFort) e *= 0.5; // 有野戰部隊擋在前面，先打部隊
        if (t.range >= 180 && !t.fort) e *= 0.6; // 遠程兵躲在後面
        wsum += e;
        return e;
      });
      if (wsum <= 0) continue;
      // 範圍傷害：打到停下來擠在一起的兵（大約每 SPLASH_GAP 像素一個）
      const splash = s.splash ? Math.max(1, Math.min(countUnits, 1 + s.splash / SPLASH_GAP)) : 1;
      // 一長排兵是一個一個走進射程的：兵越多、走越慢，越久才全部開火
      const spread = s.fort ? 0 : (n * SPLASH_GAP) / Math.max(15, s.speed);
      const ramp = spread > 0 ? Math.max(0, Math.min(1, (t - start - (s.delay ?? 0) + 1) / (spread * RAMP))) : 1;
      targets.forEach((t, i) => {
        const mult = t.fort ? 1 : splash;
        out[i] += n * s.dps[t.armor] * mult * ramp * (ws[i] / wsum);
      });
    }
    return out;
  }

  private healSide(side: Stack[], dt: number) {
    let heal = 0;
    let softUnits = 0;
    for (const x of side) {
      heal += (x.hp / x.unitHp) * x.heal;
      if (x.armor === AI.soft && !x.fort) softUnits += x.hp / x.unitHp;
    }
    if (heal <= 0) return;
    heal = Math.min(heal, softUnits * 7) * dt; // 每個醫療兵同時治 3 個
    const hurt = side.filter((x) => x.armor === AI.soft && !x.fort && x.hp < x.max);
    const missing = hurt.reduce((m, x) => m + (x.max - x.hp), 0);
    if (missing <= 0) return;
    for (const x of hurt) x.hp = Math.min(x.max, x.hp + heal * ((x.max - x.hp) / missing));
  }

  /** 打下這個據點要面對的全部防禦（從我的角度：B 方） */
  private defenseOf(w: World, node: number, travel = 0): Stack[] {
    const n = w.s.nodes[node];
    const out: Stack[] = [];
    const fort = this.fortStack(w, node);
    if (fort) out.push(fort);
    // 據點旁的工事
    w.s.structures.forEach((st) => {
      if (st.hp <= 0 || st.owner === this.playerId || !st.owner) return;
      if (st.node === node) out.push(this.structStack(w, st));
    });
    // 附近的敵軍：路上 300 以內馬上參戰；再遠一點的看多久走得到
    const near: Unit[] = [];
    const later: Map<number, Unit[]> = new Map();
    for (const e of w.enemies) {
      if (e.inNode >= 0) continue;
      const d = w.unitToNode(e, node);
      if (d <= 300) near.push(e);
      else if (d <= 1500) {
        const arrive = Math.round((d - 200) / Math.max(18, UNITS[e.type as UnitType].speed) - Math.min(travel, 40) * 0.3);
        if (arrive > 60) continue;
        // 遠一點的不一定會回防：900 以外的算一半
        const k = Math.max(1, arrive) * (d > 900 ? -100 : 1);
        const list = later.get(k) ?? [];
        list.push(e);
        later.set(k, list);
      }
    }
    out.push(...this.stacksOf(w, near));
    later.forEach((list, k) => {
      const far = k < 0;
      for (const st of this.stacksOf(w, list, far ? -k / 100 : k)) {
        if (far) {
          st.hp *= 0.5;
          st.max *= 0.5;
        }
        out.push(st);
      }
    });
    // 駐軍：堡壘被攻破才衝出來
    if (n.owner && n.hp > 0) {
      const g = w.enemies.filter((e) => e.inNode === node);
      out.push(...this.stacksOf(w, g, -1));
      const owner = w.s.players.get(n.owner);
      if (owner && owner.alive) {
        // 對方可能把存款拿來當場補兵（真人、電腦都會）
        const r = this.reinforceStack(w, owner, node, owner.fundsExact + 8 * Math.min(travel, 25) * 0.3);
        if (r) out.push(r);
      }
    }
    return out;
  }

  /** 我方在這個據點可以用來防守的：堡壘、工事、附近部隊、駐軍、存款 */
  private myDefense(w: World, node: number, money: number): Stack[] {
    const out: Stack[] = [];
    const fort = this.fortStack(w, node);
    if (fort) out.push(fort);
    w.s.structures.forEach((st) => {
      if (st.hp > 0 && st.owner === this.playerId && st.node === node) out.push(this.structStack(w, st));
    });
    const near = w.mine.filter((u) => u.inNode < 0 && u.mode !== "retreat" && w.unitToNode(u, node) <= 320);
    out.push(...this.stacksOf(w, near));
    const g = w.mine.filter((u) => u.inNode === node);
    out.push(...this.stacksOf(w, g, -1));
    const r = this.reinforceStack(w, w.me, node, money, 2);
    if (r) out.push(r);
    return out;
  }

  // ================================================================ 防守

  private defend(w: World) {
    const s = w.s;
    for (const node of w.owned) {
      const threat = w.enemies.filter((e) => e.inNode < 0 && w.unitToNode(e, node) <= 380);
      if (threat.length === 0) continue;
      const tv = threat.reduce((v, e) => v + w.value(e), 0);
      if (tv < 90) continue;
      const isHq = node === w.me.hq;
      const A = this.stacksOf(w, threat);
      // fall = 來犯的敵軍打贏我方這個據點的全部防守
      const fall = this.simulate(A, this.myDefense(w, node, 0));
      if (!fall.win) continue; // 守得住，交給堡壘火力和附近部隊
      const reserve = isHq ? w.me.fundsExact : Math.min(w.me.fundsExact, 450);
      const base = this.myDefense(w, node, reserve);
      const fallMoney = this.simulate(A, base);
      // 主力趕得回來嗎：900 以內的主力，依距離晚幾秒到
      const army = this.armyUnits(w).filter((u) => {
        const d = w.unitToNode(u, node);
        return d > 320 && d < 900;
      });
      const late = new Map<number, Unit[]>();
      for (const u of army) {
        const k = Math.max(1, Math.round(w.unitToNode(u, node) / Math.max(18, UNITS[u.type as UnitType].speed)));
        const list = late.get(k) ?? [];
        list.push(u);
        late.set(k, list);
      }
      const withArmy = [...base];
      late.forEach((list, k) => withArmy.push(...this.stacksOf(w, list, k)));
      const fallArmy = army.length ? this.simulate(A, withArmy) : fallMoney;
      this.lastDefense.set(node, s.time);
      this.log(`防守 ${node}：來犯 ${tv.toFixed(0)}，補兵${fallMoney.win ? "守不住" : "守得住"}，加主力${fallArmy.win ? "守不住" : "守得住"}`);
      if (tv >= 300) this.bomb(w, threat, 220);
      // 當場補兵（剋制來犯的兵種），出門守在堡壘火力範圍內
      if (!fallMoney.win || isHq || (!fallArmy.win && tv > 250)) {
        const need = isHq ? w.me.fundsExact : Math.min(w.me.fundsExact, tv * 1.2);
        this.buyAt(w, node, need, threat, true);
      }
      // 主力回防：補兵不夠、主力回來就守得住的時候（正在攻打大本營或很有把握的仗就不回頭，除非是自己的大本營）
      if (fallMoney.win && (!fallArmy.win || isHq) && army.length) {
        const op = this.op;
        const keepOp = !!op && op.phase === "assault" && !isHq && (s.nodes[op.target].kind === "hq" || op.expect > 0.5);
        if (!keepOp) {
          if (op) this.log(`放棄 ${op.target}，回防 ${node}`);
          this.op = null;
          this.guard = { node, until: s.time + 15 };
          const ids = army.filter((u) => u.destNode !== node).map((u) => u.id);
          for (let i = 0; i < ids.length; i += 80) w.battle.order(this.playerId, ids.slice(i, i + 80), [], { node }, false);
        }
      }
      // 怎樣都守不住的小堡壘：駐軍撤出保住兵力（大本營死守）
      if (!isHq && fallArmy.win && fallArmy.aLeft > 0.35 && tv > 300) {
        const g = w.battle.garrisonUnits(this.playerId, node);
        if (g.length) {
          const safe = this.safestNode(w, node);
          if (safe >= 0 && this.did(`撤出 ${node} → ${safe}`, w.battle.dispatch(this.playerId, node, [], [], { node: safe }, true)) === null) {
            this.avoid.set(node, s.time + 20);
          }
        }
      }
    }
  }

  private safestNode(w: World, from: number): number {
    let best = -1;
    let bestScore = Infinity;
    for (const o of w.owned) {
      if (o === from) continue;
      const threat = w.enemies.filter((e) => e.inNode < 0 && w.unitToNode(e, o) <= 380).length;
      const score = this.dist[from][o] + threat * 400;
      if (score < bestScore) {
        bestScore = score;
        best = o;
      }
    }
    return best;
  }

  /** 在某個據點買兵：依對手兵種挑最划算的，買完派到門口（out = true）或之後交給主力 */
  private buyAt(w: World, node: number, budget: number, against: Unit[], out: boolean) {
    let spent = 0;
    const bought: UnitType[] = [];
    for (let i = 0; i < 6; i++) {
      const type = this.chooseUnit(w, against, bought, node);
      const price = w.battle.unitPrice(type, node);
      const n = Math.max(1, Math.min(Math.round(300 / price), Math.floor((budget - spent) / price), Math.floor(w.me.fundsExact / price)));
      if (spent + price > budget || w.me.fundsExact < price) break;
      if (w.battle.buy(this.playerId, node, type, n) !== null) break;
      spent += price * n;
      for (let k = 0; k < n; k++) bought.push(type);
    }
    if (bought.length) this.log(`買 ${bought.join(",")} @${node}${out ? "（防守）" : ""}`);
    if (out && bought.length) {
      // 出門迎戰：站在堡壘前面一點（還在堡壘火力下）
      const lane = this.threatLane(w, node, against);
      const L = lane >= 0 ? w.battle.map.lanes[lane] : undefined;
      const spot = L ? this.safeSpot(w, lane, node, Math.min(45, L.len / 3)) : null;
      if (spot) {
        const counts = UNIT_TYPES.map((t) => bought.filter((b) => b === t).length);
        w.battle.dispatch(this.playerId, node, counts, [], spot, false);
      }
    }
    return spent;
  }

  private threatLane(w: World, node: number, threat: Unit[]): number {
    const lanes = w.battle.map.adj[node];
    let best = lanes[0] ?? -1;
    let bestV = -1;
    for (const li of lanes) {
      let v = 0;
      for (const e of threat) if (e.lane === li) v += w.value(e);
      if (v > bestV) {
        bestV = v;
        best = li;
      }
    }
    return best;
  }

  // ================================================================ 兵種

  /**
   * 挑兵：把「我方現有部隊 + 一批這種兵（約 300 元）」和對手的部隊（調成勢均力敵的規模）
   * 用戰鬥模擬打一遍，看哪一種讓結果變得最好。混編的效果（戰車在前面吃砲火、砲兵躲在後面、
   * 醫療兵、範圍傷害）都在模擬裡；引擎實測的等價對打表（matchups.ts）當作一點點加分。
   * 支援兵種（醫療、工兵、防空）照比例另外處理。
   */
  private chooseUnit(w: World, against: Unit[], plus: UnitType[], node: number): UnitType {
    const s = w.s;
    const mine = w.mine.filter((u) => u.mode !== "retreat");
    const counts = new Map<string, number>();
    let soft = 0;
    for (const u of mine) counts.set(u.type, (counts.get(u.type) ?? 0) + 1);
    for (const t of plus) counts.set(t, (counts.get(t) ?? 0) + 1);
    counts.forEach((n, t) => {
      const def = UNITS[t as UnitType];
      if (def.armor === "soft" && !def.heal && def.damage > 0) soft += n;
    });
    const have = (t: string) => counts.get(t) ?? 0;
    // 支援兵種
    const sawAir = s.time - this.sawAir < 90 && this.enemyAirCount >= 2;
    if (sawAir && have("flak") < (this.enemyAirCount >= 5 ? 2 : 1) && this.rng() < 0.5) return "flak";
    if (soft >= 6 && (have("medic") + 1) * 7 <= soft && this.rng() < 0.45) return "medic";
    const tgt = this.op ? s.nodes[this.op.target] : undefined;
    const sieging = !!tgt && !!tgt.owner && tgt.hp > 0 && !against.length;
    if (sieging && have("engineer") < Math.max(1, Math.floor(mine.length / 9)) && this.rng() < 0.35) return "engineer";

    // 對手：指定的敵人（防守時），不然是對手全部部隊；攻城時加上目標堡壘與工事
    const foes = against.length ? against : w.enemies;
    let B = this.stacksOf(w, foes);
    if (sieging && this.op) {
      const f = this.fortStack(w, this.op.target);
      if (f) B.push({ ...f, hp: f.hp * 0.5, max: f.max * 0.5 });
    }
    const valueOf = (side: Stack[]) => side.reduce((v, x) => v + x.hp * x.worth, 0) + side.reduce((v, x) => v + (x.fort ? x.hp * 0.25 : 0), 0);
    if (valueOf(B) < 300) {
      // 還看不出對手出什麼：當成常見的混編
      const prior: [UnitType, number][] = [["rifle", 4], ["mg", 2], ["tank", 1], ["at", 1], ["flame", 1]];
      B = [...B, ...prior.map(([t, n]) => this.debugStack(t, UNITS[t].cost * n))];
    }
    const A0 = this.stacksOf(w, mine);
    for (const t of plus) A0.push(this.debugStack(t, UNITS[t].cost));
    const pop = w.me.pop;
    const popRoom = POP_CAP - pop;
    // 經驗加分：引擎實測對上對手組成的勝負
    const K = MATCH_TYPES.length;
    const ev = new Array(K).fill(0);
    for (const e of foes) {
      const i = MATCH_TYPES.indexOf((e.type === "para" ? "rifle" : e.type) as UnitType);
      if (i >= 0) ev[i] += w.value(e);
    }
    const eTot = ev.reduce((x, y) => x + y, 0);
    let best: UnitType = "rifle";
    let bestScore = -Infinity;
    for (const type of MATCH_TYPES) {
      if (type === "engineer") continue;
      const def = UNITS[type];
      if (def.pop > popRoom) continue;
      const price = w.battle.unitPrice(type, node);
      const n = Math.max(1, Math.round(300 / price));
      const A = [...A0, this.debugStack(type, def.cost * n)];
      const av = valueOf(A);
      // 對手調成跟我方一樣大，才看得出差別
      const bv = valueOf(B);
      const k = Math.max(1, av / Math.max(1, bv));
      const Bs = B.map((x) => ({ ...x, hp: x.hp * k, max: x.max * k }));
      const r = this.simulate(A, Bs, 75);
      let score = (r.aLeft * av - r.bLeft * bv * k) / av;
      if (eTot > 200) {
        let m = 0;
        for (let j = 0; j < K; j++) m += (ev[j] / eTot) * MATCH_SMALL[type][j];
        score += m * 0.08;
      }
      // 人口快滿：每人口的戰力比較重要
      score -= Math.max(0, (pop - 40) / 20) * (def.pop - 1.5) * 0.04;
      score += (this.rng() - 0.5) * 0.03;
      if (score > bestScore) {
        bestScore = score;
        best = type;
      }
    }
    return best;
  }

  // ================================================================ 經濟

  private economy(w: World) {
    const s = w.s;
    const p = w.me;
    const left = this.timeLeft(w);
    // 後勤：收入 +1.5/秒，回本快
    const lv = p.logistics;
    if (lv < MAX_UPGRADE_LEVEL && s.time > 12) {
      const cost = UPGRADES.logistics.costs[lv];
      const payback = cost / LOGISTICS_INCOME_PER_LEVEL;
      const danger = this.underPressure(w);
      if (left > payback * 1.6 && p.fundsExact >= cost + (danger ? 250 : lv === 0 ? 0 : 60)) this.did(`升後勤 ${lv + 1}`, w.battle.upgrade(this.playerId, "logistics"));
    }
    // 改建：後方堡壘改補給站（+2.5/秒）；前線靠敵人的開兵營
    for (const node of w.owned) {
      const n = s.nodes[node];
      if (n.kind === "hq" || n.spec || s.time < n.incomeAt - 10) continue;
      const front = this.frontness(w, node);
      if (front > 650 || (w.owned.length >= 4 && front > 420)) {
        const cost = FORT_SPEC_DEFS.depot.cost;
        if (left > 100 && p.fundsExact >= cost + (s.time < 60 ? 0 : 80)) this.did(`補給站 ${node}`, w.battle.convert(this.playerId, node, "depot"));
      }
    }
    // 兵營：離敵人最近、但不是最前線的一座（沒有就最前線的）
    if (this.barracksNode >= 0 && !w.battle.owns(this.playerId, this.barracksNode)) this.barracksNode = -1;
    if (this.barracksNode < 0 && s.time > 70 && w.owned.length >= 3 && p.fundsExact >= FORT_SPEC_DEFS.barracks.cost + 200) {
      let best = -1;
      let bestD = Infinity;
      for (const node of w.owned) {
        const n = s.nodes[node];
        if (n.kind === "hq" || (n.spec && n.spec !== "")) continue;
        const f = this.frontness(w, node);
        if (f < bestD) {
          bestD = f;
          best = node;
        }
      }
      if (best >= 0 && this.did(`兵營 ${best}`, w.battle.convert(this.playerId, best, "barracks")) === null) this.barracksNode = best;
    }
    // 前線堡壘：對手常用空軍就改防空要塞
    if (this.enemyAirCount >= 3 && s.time - this.sawAir < 60) {
      for (const node of w.owned) {
        const n = s.nodes[node];
        if (n.kind === "hq" || n.spec) continue;
        if (this.frontness(w, node) < 500 && p.fundsExact >= FORT_SPEC_DEFS.flak.cost + 200) {
          this.did(`防空要塞 ${node}`, w.battle.convert(this.playerId, node, "flak"));
          break;
        }
      }
    }
  }

  /** 離最近的敵方據點（或敵軍）多遠 */
  private frontness(w: World, node: number): number {
    let d = Infinity;
    w.s.nodes.forEach((n, i) => {
      if (n.owner && n.owner !== this.playerId && n.hp > 0) d = Math.min(d, this.dist[node][i]);
    });
    for (const e of w.enemies) if (e.inNode < 0) d = Math.min(d, w.unitToNode(e, node) + 150);
    return d;
  }

  private underPressure(w: World) {
    for (const node of w.owned) {
      for (const e of w.enemies) if (e.inNode < 0 && w.unitToNode(e, node) < 300) return true;
    }
    return false;
  }

  private timeLeft(w: World) {
    const s = w.s;
    return s.duration > 0 ? Math.max(0, s.duration - s.time) : 1800;
  }

  private upgrades(w: World) {
    const p = w.me;
    if (w.s.time < 60) return;
    const armyValue = w.mine.reduce((v, u) => v + w.value(u), 0);
    for (const kind of ["firepower", "armor"] as const) {
      const lv = p[kind];
      if (lv >= MAX_UPGRADE_LEVEL) continue;
      const cost = UPGRADES[kind].costs[lv];
      const gain = armyValue * 0.15 * Math.min(1, this.timeLeft(w) / 200);
      if (gain >= cost * 1.1 && p.fundsExact >= cost + 120) {
        this.did(`升${kind} ${lv + 1}`, w.battle.upgrade(this.playerId, kind));
        return;
      }
    }
  }

  /** 前線工事：面對敵方據點的路上蓋碉堡／反戰車陣地；常被轟炸就蓋防空砲 */
  private towers(w: World) {
    const s = w.s;
    const p = w.me;
    if (s.time < 50 || p.fundsExact < 330) return;
    let mineCount = 0;
    s.structures.forEach((st) => {
      if (st.owner === this.playerId) mineCount++;
    });
    const cap = 2 + Math.floor(s.time / 100);
    if (mineCount >= cap) return;
    let eArmor = 0;
    let eSoft = 0;
    for (const e of w.enemies) {
      const a = UNITS[e.type as UnitType].armor;
      if (a === "soft") eSoft += w.value(e);
      else eArmor += w.value(e);
    }
    // 最需要的：據點被打過、離敵人近的那條路
    let best: { lane: number; node: number; score: number } | null = null;
    for (const node of w.owned) {
      const front = this.frontness(w, node);
      if (front > 700) continue;
      for (const lane of w.battle.map.adj[node]) {
        const L = w.battle.map.lanes[lane];
        const other = L.a === node ? L.b : L.a;
        const on = s.nodes[other];
        if (on.owner === this.playerId && on.hp > 0) continue; // 兩端都是自己的，不用蓋
        if (!w.battle.slotFits(lane, 0)) continue;
        if (s.structures.has(`s${lane}_${node}_0`)) continue;
        const hostile = on.owner && on.owner !== this.playerId && on.hp > 0 ? 1 : 0.4;
        const hit = s.time - (this.lastDefense.get(node) ?? -999) < 60 ? 1.5 : 1;
        const hq = node === p.hq ? 1.3 : 1;
        const score = (hostile * hit * hq * 1000) / (front + 200);
        if (!best || score > best.score) best = { lane, node, score };
      }
    }
    if (!best || best.score < 0.9) return;
    let kind: BuildKind = eArmor > eSoft * 0.6 ? "atnest" : "bunker";
    if (this.enemyAirCount >= 3 && s.time - this.sawAir < 60 && this.rng() < 0.5) kind = "aa";
    if (p.fundsExact >= STRUCTURES[kind].cost + 180) this.did(`工事 ${kind} @${best.node}`, w.battle.build(this.playerId, best.lane, best.node, 0, kind));
  }

  // ================================================================ 擴張：佔無主堡壘

  private expand(w: World) {
    const s = w.s;
    // 清掉已經結束的佔領任務
    for (const [node, job] of this.captures) {
      const n = s.nodes[node];
      const alive = job.units.filter((id) => {
        const u = s.units.get(id);
        return u && u.hp > 0;
      });
      if ((n.owner && n.hp > 0) || alive.length === 0 || s.time > job.until) this.captures.delete(node);
      else job.units = alive;
    }
    const neutral: number[] = [];
    s.nodes.forEach((n, i) => {
      if (!n.owner || n.hp <= 0) neutral.push(i);
    });
    if (neutral.length === 0) return;
    const busy = new Set<string>();
    for (const job of this.captures.values()) for (const id of job.units) busy.add(id);
    if (this.op) for (const id of this.op.units) busy.add(id);
    for (const node of neutral) {
      if (this.captures.has(node)) continue;
      if (this.op && this.op.target === node) continue;
      // 附近有敵軍：當成戰鬥評估
      const enemyNear = w.enemies.filter((e) => e.inNode < 0 && w.unitToNode(e, node) <= 320);
      const ev = enemyNear.reduce((v, e) => v + w.value(e), 0);
      // 找最近的閒置部隊（不在任務中、血夠的）
      const cands = w.mine
        .filter((u) => !busy.has(u.id) && u.mode !== "retreat" && u.hp > u.maxHp * 0.5 && UNITS[u.type as UnitType].damage > 0)
        .map((u) => ({ u, d: w.unitToNode(u, node) }))
        .filter((c) => c.d < 1100)
        .sort((a, b) => a.d - b.d);
      const squad: Unit[] = [];
      let val = 0;
      const need = Math.max(90, ev * 1.6);
      for (const c of cands) {
        // 駐軍要從據點派，這裡只拿野外的；駐軍另外處理
        if (c.u.inNode >= 0 && c.u.departAt === 0) continue;
        squad.push(c.u);
        val += w.value(c.u);
        if (val >= need && squad.length >= 2) break;
      }
      if (val >= need && ev > 0) {
        const r = this.simulate(this.stacksOf(w, squad), this.stacksOf(w, enemyNear));
        if (!r.win || r.aLeft < 0.4) continue;
      }
      if (val >= need) {
        squad.forEach((u) => busy.add(u.id));
        w.battle.order(this.playerId, squad.map((u) => u.id), [], { node }, false);
        this.captures.set(node, { units: squad.map((u) => u.id), until: s.time + 60 });
        continue;
      }
      if (ev > 0) continue;
      // 沒有閒兵：從最近的自己據點派駐軍或買兵（越早越值得；裝甲車跑最快）
      let from = -1;
      let fd = Infinity;
      for (const o of w.owned) {
        if (this.dist[o][node] < fd) {
          fd = this.dist[o][node];
          from = o;
        }
      }
      if (from < 0 || fd > 1400) continue;
      const g = w.battle.garrisonUnits(this.playerId, from).filter((u) => UNITS[u.type as UnitType].damage > 0 && u.hp > u.maxHp * 0.6);
      const threatened = w.enemies.some((e) => e.inNode < 0 && w.unitToNode(e, from) < 350);
      if (g.length >= 2 && !threatened) {
        const pick = g.slice(0, 3);
        const counts = UNIT_TYPES.map((t) => pick.filter((u) => u.type === t).length);
        if (w.battle.dispatch(this.playerId, from, counts, [], { node }, false) === null) {
          this.captures.set(node, { units: pick.map((u) => u.id), until: s.time + 60 });
        }
        continue;
      }
      const left = this.timeLeft(w);
      const n = s.nodes[node];
      const income = n.kind === "bigfort" ? BIG_FORT_INCOME : FORT_INCOME;
      const travel = fd / 45 + CAPTURE_TIME;
      const worth = income * Math.max(0, left - travel - 15);
      const type: UnitType = fd > 500 ? "car" : "rifle";
      const n2 = type === "car" ? 1 : 2;
      const price = w.battle.unitPrice(type, from) * n2;
      if (worth < price * 0.8 || w.me.fundsExact < price) continue;
      if (w.battle.buy(this.playerId, from, type, n2) === null) {
        const counts = UNIT_TYPES.map((t) => (t === type ? n2 : 0));
        w.battle.dispatch(this.playerId, from, counts, [], { node }, false);
        // 剛買的兵 id 還不知道：用一個空任務佔位，之後由閒置清單接手
        this.captures.set(node, { units: this.newestIds(w, type, from, n2), until: s.time + 70 });
      }
    }
  }

  private newestIds(w: World, type: string, node: number, n: number): string[] {
    const list: Unit[] = [];
    w.s.units.forEach((u) => {
      if (u.owner === this.playerId && u.type === type && u.inNode === node && u.departAt > 0) list.push(u);
    });
    return list.slice(-n).map((u) => u.id);
  }

  // ================================================================ 主力作戰

  /** 主力：不在佔領任務、不在撤退中的野外部隊 */
  private armyUnits(w: World): Unit[] {
    const busy = new Set<string>();
    for (const job of this.captures.values()) for (const id of job.units) busy.add(id);
    return w.mine.filter((u) => (u.inNode < 0 || u.departAt > 0) && !busy.has(u.id) && u.mode !== "retreat" && u.landT <= w.s.time);
  }

  private campaign(w: World) {
    const s = w.s;
    const army = this.armyUnits(w);
    if (this.guard) {
      const g = this.guard;
      const still = w.enemies.some((e) => e.inNode < 0 && w.unitToNode(e, g.node) < 450);
      if (s.time > g.until || !w.battle.owns(this.playerId, g.node) || !still) this.guard = null;
      else {
        const ids = army.filter((u) => u.destNode !== g.node && !u.attacking && w.unitToNode(u, g.node) < 1200).map((u) => u.id);
        if (ids.length) w.battle.order(this.playerId, ids.slice(0, 80), [], { node: g.node }, false);
        return;
      }
    }
    const op = this.op;
    if (op) {
      const t = s.nodes[op.target];
      // 目標已經是我的（佔下來了）或任務太久：結束
      if ((t.owner === this.playerId && t.hp > 0) || s.time - op.since > 150) {
        this.op = null;
      } else {
        this.runOp(w, op, army);
        return;
      }
    }
    if (army.length === 0) return;
    // 挑目標：估算每個可以打的據點，算划不划算（每秒多算一次就好）
    if (s.time < this.nextPlan) return;
    this.nextPlan = s.time + (this.sharp ? 1 : 2);
    const pick = this.chooseTarget(w, army);
    if (pick) {
      const assembly = this.assemblyPoint(w, army, pick.node);
      this.op = { target: pick.node, phase: "gather", assembly, since: s.time, units: new Set(army.map((u) => u.id)), expect: pick.left };
      this.log(`目標 ${pick.node}（剩 ${(pick.left * 100).toFixed(0)}%、分數 ${pick.score.toFixed(0)}）兵 ${army.length}`);
      this.sendAll(w, army, assembly);
      this.pullGarrisons(w, assembly, pick.node);
      return;
    }
    // 沒有划算的仗：主力在前線堡壘前面待命，繼續存兵
    const rally = this.rallyPoint(w);
    if (rally) {
      const idle = army.filter((u) => !this.near(w, u, rally, 90) && !u.attacking);
      if (idle.length) this.sendAll(w, idle, rally);
    }
  }

  /** 主力走到目標大約要幾秒（看部隊實際的位置） */
  private travelTime(w: World, units: Unit[], target: number): number {
    if (!units.length) return 0;
    let d = 0;
    for (const u of units) d += Math.min(3000, w.unitToNode(u, target));
    return d / units.length / 26;
  }

  private headingTo(u: Unit, d: Dest) {
    if ("node" in d) return u.destNode === d.node;
    return u.destNode < 0 && u.destLane === d.lane && Math.abs(u.destX - d.x) < 30;
  }

  private near(w: World, u: Unit, d: Dest, r: number) {
    if ("node" in d) return w.unitToNode(u, d.node) <= r;
    if (u.inNode >= 0) return false;
    if (u.lane === d.lane) return Math.abs(u.x - d.x) <= r;
    return false;
  }

  private sendAll(w: World, units: Unit[], dest: Dest) {
    const ids = units.filter((u) => u.inNode < 0 || u.departAt > 0).map((u) => u.id);
    for (let i = 0; i < ids.length; i += 80) w.battle.order(this.playerId, ids.slice(i, i + 80), [], dest, false);
  }

  /** 把沒有被威脅的據點裡、血夠的駐軍派到集結點（大本營留幾個） */
  private pullGarrisons(w: World, dest: Dest, target: number) {
    for (const node of w.owned) {
      const g = w.battle.garrisonUnits(this.playerId, node).filter((u) => u.hp >= u.maxHp * 0.8 && UNITS[u.type as UnitType].damage > 0);
      if (!g.length) continue;
      const threatened = w.enemies.some((e) => e.inNode < 0 && w.unitToNode(e, node) < 450);
      if (threatened) continue;
      if (this.dist[node][target] > 2600) continue;
      const counts = UNIT_TYPES.map((t) => g.filter((u) => u.type === t).length);
      w.battle.dispatch(this.playerId, node, counts, [], dest, false);
    }
  }

  /** 敵方據點、工事在這條路上打得到哪裡：回傳 [起點, 終點] 的區間（路上的座標） */
  private dangerZones(w: World, lane: number): [number, number][] {
    const L = w.battle.map.lanes[lane];
    const out: [number, number][] = [];
    for (const ni of [L.a, L.b]) {
      const n = w.s.nodes[ni];
      if (!n.owner || n.owner === this.playerId || n.hp <= 0) continue;
      const r = STRUCTURES[n.kind as StructureKind].range + (n.spec === "battery" && n.specDone ? BATTERY_RANGE : 0) + 20;
      const x = nodeEnd(L, ni);
      out.push([x - r, x + r]);
    }
    w.s.structures.forEach((st) => {
      if (!st.owner || st.owner === this.playerId || st.hp <= 0 || st.lane !== lane) return;
      const r = STRUCTURES[st.kind as StructureKind].range + 20;
      if (r > 20) out.push([st.x - r, st.x + r]);
    });
    return out;
  }

  /** 從 node 出發沿著 lane 最多走 want 遠、又不在敵方火力範圍內的位置；沒有就回傳 null */
  private safeSpot(w: World, lane: number, node: number, want: number): Dest | null {
    const L = w.battle.map.lanes[lane];
    const zones = this.dangerZones(w, lane);
    const from = nodeEnd(L, node);
    const dir = nodeDir(L, node);
    for (let d = Math.min(want, L.len - 10); d >= 0; d -= 5) {
      const x = from + dir * d;
      if (zones.every(([a, b]) => x < a || x > b)) return { lane, x };
    }
    return null;
  }

  /** 前線待命位置：離敵人最近的自己據點前面一點（在堡壘火力下） */
  private rallyPoint(w: World): Dest | null {
    let best = -1;
    let bestD = Infinity;
    for (const node of w.owned) {
      const f = this.frontness(w, node) + (node === w.me.hq ? 120 : 0);
      if (f < bestD) {
        bestD = f;
        best = node;
      }
    }
    if (best < 0) return null;
    // 朝向最近的敵方據點的那條路
    let enemy = -1;
    let ed = Infinity;
    w.s.nodes.forEach((n, i) => {
      if (n.owner && n.owner !== this.playerId && n.hp > 0 && this.dist[best][i] < ed) {
        ed = this.dist[best][i];
        enemy = i;
      }
    });
    if (enemy < 0) return { node: best };
    const plan = planRoute(w.battle.map, { node: best }, [], { node: enemy });
    if (!plan || plan.lanes.length === 0) return { node: best };
    // 站在自己堡壘前面一點，但不能站進敵方堡壘、工事的射程
    const L = w.battle.map.lanes[plan.lanes[0]];
    return this.safeSpot(w, plan.lanes[0], best, Math.min(55, L.len / 4)) ?? { node: best };
  }

  /** 在目標的射程（含工事）外面集結 */
  private assemblyPoint(w: World, army: Unit[], target: number): Dest {
    // 從主力目前的位置規劃到目標的路
    let from = -1;
    let fd = Infinity;
    for (const o of w.owned) {
      const d = this.dist[o][target];
      if (d < fd) {
        fd = d;
        from = o;
      }
    }
    const start = from >= 0 ? { node: from } : army[0].inNode >= 0 ? { node: army[0].inNode } : { lane: army[0].lane, x: army[0].x };
    const plan = planRoute(w.battle.map, start, [], { node: target });
    if (!plan || plan.lanes.length === 0) return { node: target };
    const last = plan.lanes[plan.lanes.length - 1];
    const L = w.battle.map.lanes[last];
    // 對方在這條路上最遠打得到哪裡
    const n = w.s.nodes[target];
    let reach = 0;
    if (n.owner && n.hp > 0) {
      const def = STRUCTURES[n.kind as StructureKind];
      reach = def.range + (n.spec === "battery" ? BATTERY_RANGE : 0);
    }
    w.s.structures.forEach((st) => {
      if (st.owner && st.owner !== this.playerId && st.hp > 0 && st.lane === last && st.node === target) {
        reach = Math.max(reach, BUILD_SLOTS[st.slot] + STRUCTURES[st.kind as StructureKind].range);
      }
    });
    const back = reach + 50;
    const other = L.a === target ? L.b : L.a;
    if (back >= L.len - 25) {
      // 這條路太短：在路的另一端（通常是自己的據點）集結
      return { node: other };
    }
    const x = nodeEnd(L, target) + nodeDir(L, target) * back;
    // 另一端如果也是敵人的，確認不在它的射程裡
    const zones = this.dangerZones(w, last);
    if (zones.some(([a, b]) => x >= a && x <= b)) return { node: other };
    return { lane: last, x };
  }

  private chooseTarget(w: World, army: Unit[]): { node: number; left: number; score: number } | null {
    const s = w.s;
    const left = this.timeLeft(w);
    const timed = s.duration > 0;
    const force = this.stacksOf(w, army);
    // 也算進還在據點裡、可以叫出來的兵
    const extra: Unit[] = [];
    for (const node of w.owned) {
      const threatened = w.enemies.some((e) => e.inNode < 0 && w.unitToNode(e, node) < 450);
      if (threatened) continue;
      for (const u of w.battle.garrisonUnits(this.playerId, node)) if (u.hp >= u.maxHp * 0.8 && UNITS[u.type as UnitType].damage > 0) extra.push(u);
    }
    const all = [...force, ...this.stacksOf(w, extra, 6)];
    const myValue = army.reduce((v, u) => v + w.value(u), 0) + extra.reduce((v, u) => v + w.value(u), 0);
    if (myValue < 150) return null;
    const leader = s.leaderId;
    const standings = this.standings(w);
    let best: { node: number; left: number; score: number } | null = null;
    for (let i = 0; i < s.nodes.length; i++) {
      const n = s.nodes[i];
      if (n.owner === this.playerId && n.hp > 0) continue;
      if ((this.avoid.get(i) ?? 0) > s.time) continue;
      let d = Infinity;
      for (const o of w.owned) d = Math.min(d, this.dist[o][i]);
      if (!Number.isFinite(d)) continue;
      const travel = Math.max(d / 26, this.travelTime(w, army, i));
      if (timed && travel + 25 > left) continue;
      const enemy = !!n.owner && n.hp > 0;
      const B = this.defenseOf(w, i, travel);
      const r = this.simulate(all, B, 120);
      if (!r.win) continue;
      if (r.aLeft < (enemy ? 0.4 : 0.25)) continue;
      // 打下來的價值：收入 × 剩下時間、攻破獎勵、打掉對方收入；大本營 = 淘汰
      const income = n.kind === "bigfort" || n.kind === "hq" ? BIG_FORT_INCOME : FORT_INCOME;
      const remain = Math.max(0, left - travel - r.t - CAPTURE_TIME - 15);
      let gain = income * remain * (enemy ? 2 : 1) + (n.spec === "depot" ? DEPOT_INCOME * remain : 0);
      if (enemy) {
        gain += 120 * (n.owner === leader ? 2 : 1) + r.bLoss * 0.25;
        if (n.kind === "hq") gain += 2500;
        if (n.owner === leader) gain += 200;
        // 落後的對手（快被淘汰的）優先收掉
        const st = standings.get(n.owner);
        if (st !== undefined && st <= 1) gain += 150;
      }
      if (timed && left < 150) gain += 600; // 最後階段：據點數決定勝負
      const cost = r.aLoss + travel * 6 + (1 - r.aLeft) * 80;
      const score = gain - cost;
      if (score <= 0) continue;
      if (!best || score > best.score) best = { node: i, left: r.aLeft, score };
      if (this.debug) {
        const val = (st: Stack[]) => st.reduce((v, x) => v + x.hp * x.worth, 0).toFixed(0);
        this.log(`  候選 ${i}：我 ${val(all)}，敵 ${val(B)}，剩 ${(r.aLeft * 100).toFixed(0)}%，行軍 ${travel.toFixed(0)}s，分數 ${score.toFixed(0)}`);
      }
    }
    // 有時限、我已經領先：不冒險，只打很穩的
    if (best && timed && left < 120 && this.leading(w) && best.left < 0.6) return null;
    return best;
  }

  /** 每個對手的據點數 */
  private standings(w: World): Map<string, number> {
    const m = new Map<string, number>();
    w.s.players.forEach((p) => {
      if (p.alive && p.id !== this.playerId) m.set(p.id, p.forts);
    });
    return m;
  }

  private leading(w: World) {
    let max = 0;
    w.s.players.forEach((p) => {
      if (p.alive && p.id !== this.playerId) max = Math.max(max, p.forts);
    });
    return w.me.forts > max;
  }

  private runOp(w: World, op: Op, army: Unit[]) {
    const s = w.s;
    // 新來的兵加進任務
    for (const u of army) op.units.add(u.id);
    const units = army;
    if (units.length === 0) {
      this.op = null;
      return;
    }
    const target = op.target;
    if (op.phase === "gather") {
      const total = units.reduce((v, u) => v + w.value(u), 0);
      const there = units.filter((u) => this.near(w, u, op.assembly, 140)).reduce((v, u) => v + w.value(u), 0);
      const waited = s.time - op.since;
      if (s.time < this.nextCheck) return;
      this.nextCheck = s.time + 1;
      // 集結時重新評估：變得打不贏就取消
      const travel = this.travelTime(w, units, target);
      const r = this.simulate(this.stacksOf(w, units), this.defenseOf(w, target, travel), 120);
      // 有一點緩衝：開打前估計的勝算掉很多才取消（避免一下要打、一下不打）
      if ((!r.win && r.aLeft < 0.08) || r.aLeft < op.expect - 0.55) {
        const val = (st: Stack[]) => st.reduce((v, x) => v + x.hp * x.worth, 0).toFixed(0);
        this.log(`取消 ${target}：剩 ${(r.aLeft * 100).toFixed(0)}%（我 ${val(this.stacksOf(w, units))}，敵 ${val(this.defenseOf(w, target, travel))}，行軍 ${travel.toFixed(0)}s）`);
        this.avoid.set(target, s.time + 25);
        this.op = null;
        const rally = this.rallyPoint(w);
        if (rally) this.sendAll(w, units, rally);
        return;
      }
      // 還沒往集結點走的（新買的、剛養好傷的）叫過去
      const lagging = units.filter((u) => !this.near(w, u, op.assembly, 140) && !u.attacking && !this.headingTo(u, op.assembly));
      if (lagging.length) this.sendAll(w, lagging, op.assembly);
      if (there >= total * 0.8 || waited > 35) {
        op.phase = "assault";
        op.expect = r.aLeft;
        this.log(`突擊 ${target}：到齊 ${((there / total) * 100).toFixed(0)}%、估剩 ${(r.aLeft * 100).toFixed(0)}%`);
        this.log(`    我 ${this.dump(this.stacksOf(w, units))}`);
        this.log(`    敵 ${this.dump(this.defenseOf(w, target, travel))}`);
        this.sendAll(w, units, { node: target });
      }
      return;
    }
    // 突擊中：還沒到的兵直接前往目標；打得太差就撤退
    const off = units.filter((u) => u.destNode !== target && !u.attacking);
    if (off.length) this.sendAll(w, off, { node: target });
    const engaged = units.filter((u) => w.unitToNode(u, target) < 420);
    if (engaged.length >= 2 && this.sharp && s.time >= this.nextCheck) {
      this.nextCheck = s.time + 1;
      const r = this.simulate(this.stacksOf(w, units), this.defenseOf(w, target, 0), 120);
      if (!r.win && r.aLeft < 0.15 && r.bLeft > 0.35) {
        // 打不下來：撤退保住兵力（不讓對方拿賞金）
        this.log(`撤退 ${target}：估剩 ${(r.aLeft * 100).toFixed(0)}%、敵剩 ${(r.bLeft * 100).toFixed(0)}%`);
        this.log(`    我 ${this.dump(this.stacksOf(w, units))}`);
        this.log(`    敵 ${this.dump(this.defenseOf(w, target, 0))}`);
        w.battle.retreat(this.playerId, units.filter((u) => u.inNode < 0).map((u) => u.id).slice(0, 80));
        this.avoid.set(target, s.time + 40);
        this.op = null;
      }
    }
  }

  /** 剩下的錢：在兵營（或前線）買主力，留一點應急 */
  private buyArmy(w: World) {
    const s = w.s;
    const p = w.me;
    if (p.pop >= POP_CAP - 1) return;
    const pressure = this.underPressure(w);
    let reserve = s.time < 45 ? 0 : pressure ? 60 : 120;
    // 後勤、補給站快可以買的時候先存錢
    if (p.logistics === 0 && s.time > 8 && s.time < 60) reserve = Math.max(reserve, UPGRADES.logistics.costs[0]);
    if (p.fundsExact < reserve + 50) return;
    const node = this.buyNode(w);
    if (node < 0) return;
    // 在戰場上：依要打的目標附近的敵軍挑兵
    const against: Unit[] = [];
    if (this.op) for (const e of w.enemies) if (w.unitToNode(e, this.op.target) < 700) against.push(e);
    const budget = p.fundsExact - reserve;
    const before = p.fundsExact;
    this.buyAt(w, node, budget, against.length >= 3 ? against : [], false);
    if (p.fundsExact < before) {
      // 買好的兵出門加入主力（駐軍養兵費很貴）
      const dest = this.op ? (this.op.phase === "assault" ? ({ node: this.op.target } as Dest) : this.op.assembly) : this.rallyPoint(w);
      if (dest && !("node" in dest && dest.node === node)) {
        const fresh = w.battle.garrisonUnits(this.playerId, node).filter((u) => u.hp >= u.maxHp * 0.95);
        const counts = UNIT_TYPES.map((t) => fresh.filter((u) => u.type === t).length);
        if (counts.some((c) => c > 0)) w.battle.dispatch(this.playerId, node, counts, [], dest, false);
      }
    }
  }

  /** 在哪裡買兵：兵營優先，不然離目標（或敵人）最近、沒有被圍的據點 */
  private buyNode(w: World): number {
    const s = w.s;
    const ok = (n: number) => w.battle.owns(this.playerId, n) && w.battle.garrisonCapAt(n) - w.battle.garrisonAt(n) >= 3;
    const target = this.op?.target ?? -1;
    if (this.barracksNode >= 0 && ok(this.barracksNode)) {
      const bn = s.nodes[this.barracksNode];
      const near = target < 0 || this.dist[this.barracksNode][target] < 1500;
      if (bn.spec === "barracks" && bn.specDone && near) return this.barracksNode;
    }
    let best = -1;
    let bestD = Infinity;
    for (const node of w.owned) {
      if (!ok(node)) continue;
      const d = target >= 0 ? this.dist[node][target] : this.frontness(w, node);
      // 被圍住的據點買了出不去
      const besieged = w.enemies.filter((e) => e.inNode < 0 && w.unitToNode(e, node) < 200).length >= 3;
      const score = d + (besieged ? 2000 : 0);
      if (score < bestD) {
        bestD = score;
        best = node;
      }
    }
    return best;
  }

  // ================================================================ 細部操作

  private micro(w: World) {
    const s = w.s;
    // 特種部隊：獵殺對手場上總價值最高的兵種
    const worth = new Map<string, number>();
    for (const e of w.enemies) if (e.type !== "medic" && e.type !== "para") worth.set(e.type, (worth.get(e.type) ?? 0) + w.value(e));
    let prey = "";
    let pv = 0;
    worth.forEach((v, t) => {
      if (v > pv) {
        pv = v;
        prey = t;
      }
    });
    const hunters = w.mine.filter((u) => u.type === "commando" && u.hunt !== prey);
    if (hunters.length && prey) w.battle.setHunt(this.playerId, hunters.map((u) => u.id), prey);

    if (!this.sharp) return;
    // 重傷的兵撤回最近的據點養傷（駐紮每秒回 5%），不在打贏的仗裡硬撐
    const hurt: string[] = [];
    for (const u of w.mine) {
      if (u.inNode >= 0 || u.mode === "retreat" || u.landT > s.time) continue;
      const ratio = u.hp / u.maxHp;
      const def = UNITS[u.type as UnitType];
      const limit = def.armor === "hard" ? 0.22 : def.armor === "light" ? 0.25 : 0.3;
      if (ratio >= limit || !u.attacking) continue;
      // 有醫療兵在旁邊的步兵不用撤
      if (def.armor === "soft" && w.mine.some((m) => m.type === "medic" && m.inNode < 0 && m.lane === u.lane && Math.abs(m.x - u.x) < 80)) continue;
      hurt.push(u.id);
      this.retreating.add(u.id);
    }
    if (hurt.length) w.battle.retreat(this.playerId, hurt.slice(0, 80));
    // 養好傷的駐軍重新出門（交給 pullGarrisons / buyArmy），這裡只處理據點裡被丟著的人
    for (const id of [...this.retreating]) {
      const u = s.units.get(id);
      if (!u || u.hp <= 0) this.retreating.delete(id);
      else if (u.inNode >= 0 && u.hp >= u.maxHp * 0.9) this.retreating.delete(id);
    }
    // 局部戰鬥：一群兵打不贏又沒有堡壘可靠，撤
    if (s.time >= this.nextLocal) {
      this.nextLocal = s.time + 1.5;
      this.localRetreats(w);
    }
    // 據點裡養好的兵：派去主力
    if (s.time >= this.nextRedeploy) {
      this.nextRedeploy = s.time + 3;
      const dest = this.op ? (this.op.phase === "assault" ? ({ node: this.op.target } as Dest) : this.op.assembly) : this.rallyPoint(w);
      if (dest) {
        for (const node of w.owned) {
          if ("node" in dest && dest.node === node) continue;
          const threatened = w.enemies.some((e) => e.inNode < 0 && w.unitToNode(e, node) < 420);
          if (threatened) continue;
          const g = w.battle.garrisonUnits(this.playerId, node).filter((u) => u.hp >= u.maxHp * 0.9 && UNITS[u.type as UnitType].damage > 0);
          const keep = node === w.me.hq ? 0 : 0;
          if (g.length <= keep) continue;
          const counts = UNIT_TYPES.map((t) => g.filter((u) => u.type === t).length);
          w.battle.dispatch(this.playerId, node, counts, [], dest, false);
        }
      }
    }
  }

  private localRetreats(w: World) {
    const s = w.s;
    const field = w.mine.filter((u) => u.inNode < 0 && u.mode !== "retreat" && u.attacking);
    const done = new Set<string>();
    for (const u of field) {
      if (done.has(u.id)) continue;
      const group = field.filter((o) => o.lane === u.lane && Math.abs(o.x - u.x) < 220);
      group.forEach((o) => done.add(o.id));
      const foes = w.enemies.filter((e) => e.inNode < 0 && w.unitDist(e, u) < 320);
      if (foes.length === 0) continue;
      // 附近有自己的堡壘可以依靠就不撤
      const L = w.battle.map.lanes[u.lane];
      const homeA = w.battle.owns(this.playerId, L.a) && u.x < 200;
      const homeB = w.battle.owns(this.playerId, L.b) && L.len - u.x < 200;
      if (homeA || homeB) continue;
      // 正在打敵方據點的不在這裡判斷（runOp 會判斷）
      if (this.op && this.op.phase === "assault" && group.some((o) => w.unitToNode(o, this.op!.target) < 420)) continue;
      const B = this.stacksOf(w, foes);
      w.s.structures.forEach((st) => {
        if (st.owner && st.owner !== this.playerId && st.hp > 0 && st.lane === u.lane && Math.abs(st.x - u.x) < 260) B.push(this.structStack(w, st));
      });
      for (const ni of [L.a, L.b]) {
        const n = s.nodes[ni];
        if (n.owner && n.owner !== this.playerId && n.hp > 0 && Math.abs(nodeEnd(L, ni) - u.x) < 260) {
          const f = this.fortStack(w, ni);
          if (f) B.push(f);
        }
      }
      const r = this.simulate(this.stacksOf(w, group), B, 60);
      if (!r.win && r.aLeft < 0.12 && r.bLeft > 0.4) {
        this.log(`局部撤退 ${group.length} 支`);
        w.battle.retreat(this.playerId, group.map((o) => o.id).slice(0, 80));
        if (this.op) for (const o of group) this.op.units.delete(o.id);
      }
    }
  }

  // ================================================================ 空軍

  private air(w: World) {
    const s = w.s;
    if (s.event === "storm") return;
    // 轟炸：找打得到最多價值、路上防空又不強的地方
    const field = w.enemies.filter((e) => e.inNode < 0 && e.landT <= s.time);
    if (field.length) this.bomb(w, field, 300);
    // 空降：遠方沒人顧的無主堡壘
    const idx = AIR_KINDS.indexOf("transport");
    const p = w.me;
    if (s.time < (p.airReady[idx] ?? 0) || p.fundsExact < AIRCRAFT.transport.cost + 150 || p.pop > POP_CAP - 3) return;
    let best: { lane: number; x: number; score: number } | null = null;
    s.nodes.forEach((n, i) => {
      if (n.owner && n.hp > 0) return;
      if (this.captures.has(i) || (this.op && this.op.target === i)) return;
      const enemyNear = w.enemies.some((e) => e.inNode < 0 && w.unitToNode(e, i) < 380);
      if (enemyNear) return;
      let d = Infinity;
      for (const o of w.owned) d = Math.min(d, this.dist[o][i]);
      if (d < 600) return; // 近的走路去就好
      const lane = w.battle.map.adj[i][0];
      if (lane === undefined) return;
      const L = w.battle.map.lanes[lane];
      const x = nodeEnd(L, i) + nodeDir(L, i) * 35;
      const pt = lanePoint(L, x);
      const risk = this.flightRisk(w, pt.x, pt.y);
      if (risk > 0.6) return;
      const income = n.kind === "bigfort" ? BIG_FORT_INCOME : FORT_INCOME;
      const score = income * Math.max(0, this.timeLeft(w) - 20) - AIRCRAFT.transport.cost - risk * 300;
      if (score > 80 && (!best || score > best.score)) best = { lane, x, score };
    });
    if (best) this.did("空降", w.battle.callAir(this.playerId, "transport", (best as { lane: number }).lane, (best as { x: number }).x));
  }

  /** 對一群敵人叫轟炸：算 5 顆炸彈打得到的價值，扣掉被打下來的風險 */
  private bomb(w: World, foes: Unit[], minValue: number) {
    const s = w.s;
    const p = w.me;
    const idx = AIR_KINDS.indexOf("bomber");
    if (s.time < (p.airReady[idx] ?? 0) || p.fundsExact < AIRCRAFT.bomber.cost || s.event === "storm") return;
    const fp = w.fp(this.playerId);
    let best: { lane: number; x: number; value: number } | null = null;
    for (const c of foes) {
      if (c.inNode >= 0) continue;
      let value = 0;
      for (const e of foes) {
        if (e.lane !== c.lane || e.inNode >= 0) continue;
        const off = e.x - c.x;
        let hits = 0;
        for (let k = 0; k < BOMB.count; k++) if (Math.abs(off - (k - (BOMB.count - 1) / 2) * BOMB.spacing) <= BOMB.radius) hits++;
        if (!hits) continue;
        const dmg = hits * BOMB.damage * fp * DAMAGE_TABLE.bomb[UNITS[e.type as UnitType].armor];
        value += Math.min(1, dmg / Math.max(1, e.hp)) * w.value(e);
      }
      // 打得到自己人就不要
      for (const m of w.mine) if (m.inNode < 0 && m.lane === c.lane && Math.abs(m.x - c.x) < 90) value -= w.value(m);
      if (value > (best?.value ?? 0)) best = { lane: c.lane, x: c.x, value };
    }
    if (!best || best.value < minValue) return;
    const pt = lanePoint(w.battle.map.lanes[best.lane], best.x);
    const risk = this.flightRisk(w, pt.x, pt.y);
    if (best.value * (1 - risk) < minValue * 0.85) return;
    this.did(`轟炸 價值 ${best.value.toFixed(0)}`, w.battle.callAir(this.playerId, "bomber", best.lane, best.x));
  }

  /** 飛機從大本營直線飛到 (x, y)，沿路被敵方防空打掉多少比例的血（0～1+） */
  private flightRisk(w: World, x: number, y: number): number {
    const s = w.s;
    const home = w.battle.map.nodes[w.me.hq];
    if (!home) return 1;
    const speed = 260;
    let dmg = 0;
    const chord = (cx: number, cy: number, r: number) => {
      // 線段與圓相交的長度
      const dx = x - home.x;
      const dy = y - home.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      const t = (cx - home.x) * ux + (cy - home.y) * uy;
      const px = home.x + ux * t;
      const py = home.y + uy * t;
      const dd = Math.hypot(cx - px, cy - py);
      if (dd >= r) return 0;
      const half = Math.sqrt(r * r - dd * dd);
      const a = Math.max(0, t - half);
      const b = Math.min(len, t + half);
      return Math.max(0, b - a);
    };
    s.nodes.forEach((n, i) => {
      if (!n.owner || n.owner === this.playerId || n.hp <= 0) return;
      const def = STRUCTURES[n.kind as StructureKind];
      const flak = n.spec === "flak" && n.specDone;
      const r = def.airRange + (flak ? 80 : 0);
      const nd = w.battle.map.nodes[i];
      const gb = 1 + Math.min(GARRISON_FIRE_MAX, w.battle.garrisonAt(i) * GARRISON_FIRE_BONUS);
      dmg += (chord(nd.x, nd.y, r) / speed) * (def.airDamage / def.airCooldown) * gb * (flak ? 3 : 1);
    });
    s.structures.forEach((st) => {
      if (!st.owner || st.owner === this.playerId || st.hp <= 0 || st.kind !== "aa" || st.progress < 1) return;
      const pt = lanePoint(w.battle.map.lanes[st.lane], st.x);
      dmg += (chord(pt.x, pt.y, STRUCTURES.aa.airRange) / speed) * (STRUCTURES.aa.airDamage / STRUCTURES.aa.airCooldown);
    });
    for (const e of w.enemies) {
      if (e.type !== "flak" || e.inNode >= 0) continue;
      const pt = lanePoint(w.battle.map.lanes[e.lane], e.x);
      dmg += (chord(pt.x, pt.y, UNITS.flak.airRange ?? 230) / speed) * ((UNITS.flak.airDamage ?? 30) / (UNITS.flak.airCooldown ?? 0.45));
    }
    return dmg / (AIRCRAFT.bomber.hp * w.am());
  }
}

/** 一次思考用的戰況快照 */
class World {
  s;
  mine: Unit[] = [];
  enemies: Unit[] = [];
  owned: number[];
  constructor(
    public battle: Battle,
    public me: Player,
    private dist: number[][],
  ) {
    this.s = battle.state;
    const now = this.s.time;
    this.s.units.forEach((u) => {
      if (u.hp <= 0 || u.landT > now) return;
      if (u.owner === me.id) this.mine.push(u);
      else this.enemies.push(u);
    });
    this.owned = battle.ownedNodes(me.id);
  }

  value(u: Unit) {
    return UNITS[u.type as UnitType].cost * (u.hp / u.maxHp);
  }

  fp(owner: string) {
    const p = this.s.players.get(owner);
    return 1 + (p ? p.firepower * FIREPOWER_PER_LEVEL : 0);
  }

  am() {
    return 1 + this.me.armor * 0.15;
  }

  /** 部隊（野外或駐軍）沿路走到某個據點的距離 */
  unitToNode(u: Unit, node: number): number {
    if (u.inNode >= 0) return this.dist[u.inNode][node];
    const L = this.battle.map.lanes[u.lane];
    if (!L) return Infinity;
    return Math.min(u.x + this.dist[L.a][node], L.len - u.x + this.dist[L.b][node]);
  }

  /** 兩支野外部隊沿路的距離（大概） */
  unitDist(a: Unit, b: Unit): number {
    if (a.inNode >= 0 || b.inNode >= 0) return Infinity;
    if (a.lane === b.lane) return Math.abs(a.x - b.x);
    const La = this.battle.map.lanes[a.lane];
    const Lb = this.battle.map.lanes[b.lane];
    let best = Infinity;
    for (const [na, xa] of [
      [La.a, a.x],
      [La.b, La.len - a.x],
    ] as const) {
      for (const [nb, xb] of [
        [Lb.a, b.x],
        [Lb.b, Lb.len - b.x],
      ] as const) {
        best = Math.min(best, xa + this.dist[na][nb] + xb);
      }
    }
    return best;
  }
}

