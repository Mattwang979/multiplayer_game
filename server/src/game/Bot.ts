// 電腦玩家：每隔一段時間看一下戰況，用跟真人一樣的指令買兵、派兵、調度、蓋工事、升級、叫空軍。
// 也用來代管斷線的玩家（固定用普通難度）。
// 難度不改規則，只改「腦袋」：反應速度、會用的兵種與手段、會不會看對手出兵來剋制；
// 只有地獄難度另外在 Battle 裡多 30% 收入。
import {
  AIRCRAFT,
  AIR_KINDS,
  BOMB,
  BUILD_SLOTS,
  FORT_SPEC_DEFS,
  GARRISON_FIRE_BONUS,
  GARRISON_FIRE_MAX,
  POP_CAP,
  MAX_UPGRADE_LEVEL,
  UNIT_TYPES,
  STRUCTURES,
  UNITS,
  UPGRADES,
  UPGRADE_KINDS,
  nodeDistance,
  nodeEnd,
  nodeDir,
  roadDistance,
  upkeepFor,
  type AirKind,
  type BotLevel,
  type BuildKind,
  type FortSpec,
  type UnitType,
} from "@frontline/shared";
import type { Battle } from "./Battle";
import type { Player, Unit } from "./schema";

/** 各難度的打法設定 */
export interface Profile {
  think: [number, number]; // 每隔幾秒想一次（越短反應越快）
  units: UnitType[] | null; // 會出的兵種（null = 全部）
  counter: number; // 看對手兵種出剋制兵種的機率
  air: number; // 每次想事情時考慮叫空軍的機率
  upgrade: number;
  build: number;
  convert: number;
  crates: boolean; // 會不會去搶補給箱
  defend: boolean; // 據點被打會不會把駐軍派出來迎戰
  retreat: number; // 殘兵撤退的機率（0 = 不撤退）
  retreatAt: number; // 平均血量低於多少就撤退
  attackNeed: number; // 集結多少人口才出擊（加在基本值上）
  reserve: number; // 買兵時留多少錢
  focus: boolean; // 會不會優先打懸賞中、血少的目標
  plan: number; // >0：估算目標的防禦，自己兵力到這個倍數才出擊（0 = 只看人數）
  consolidate: boolean; // 把後方據點的兵集中到前線集結點
}

export const PROFILES: Record<BotLevel, Profile> = {
  // 簡單：反應慢、兵一買好就零零星星派出去、據點被打會衝出去送、不會存錢
  easy: {
    think: [2.2, 3.4], units: ["rifle", "mg", "at", "tank", "artillery"], counter: 0, air: 0, upgrade: 0, build: 0.06, convert: 0,
    crates: false, defend: true, retreat: 0, retreatAt: 0, attackNeed: -2, reserve: 20, focus: false,
    plan: 0, consolidate: false,
  },
  // 普通：會蓋工事、升級、叫空軍；兵種較單純，集滿人數就出擊
  normal: {
    think: [0.7, 1.6], units: ["rifle", "mg", "at", "tank", "artillery", "medic", "engineer", "flak"],
    counter: 0.35, air: 0.5, upgrade: 0.2, build: 0.3, convert: 0.15,
    crates: true, defend: false, retreat: 0.5, retreatAt: 0.3, attackNeed: 0, reserve: 100, focus: true,
    plan: 0, consolidate: false,
  },
  // 困難：守在堡壘裡等對手撞牆、存一筆錢在被打的據點即時補兵、集中兵力算好再打、看你出什麼就剋制
  hard: {
    think: [0.4, 0.8], units: ["rifle", "mg", "at", "tank", "artillery", "medic", "engineer", "flak", "commando"], counter: 0.6, air: 0.7, upgrade: 0.3, build: 0.4, convert: 0.25,
    crates: true, defend: false, retreat: 0.9, retreatAt: 0.4, attackNeed: 0, reserve: 150, focus: true,
    plan: 1.4, consolidate: true,
  },
  brutal: {
    think: [0.35, 0.7], units: ["rifle", "mg", "at", "tank", "artillery", "medic", "engineer", "flak", "commando"], counter: 0.6, air: 0.8, upgrade: 0.35, build: 0.45, convert: 0.3,
    crates: true, defend: false, retreat: 0.9, retreatAt: 0.4, attackNeed: 0, reserve: 150, focus: true,
    plan: 1.4, consolidate: true,
  },
};

interface Threat {
  node: number;
  value: number;
  soft: number;
  hard: number;
  lane: number; // 敵人從哪條路來
  x: number; // 最近的敵人在路上的位置
}

export class BotBrain {
  private nextThink: number;
  private sawEnemyAir = 0;
  private target = -1;
  private targetUntil = 0;
  private nextRegroup = 8;
  private chasedCrates = new Set<string>();
  private prof: Profile;

  constructor(
    public playerId: string,
    private rng: () => number = Math.random,
    level: BotLevel | Profile = "normal",
  ) {
    // 傳入 Profile 物件是給平衡測試用的
    this.prof = typeof level === "string" ? (PROFILES[level] ?? PROFILES.normal) : level;
    this.nextThink = 0.5 + rng() * 1.5;
  }

  update(battle: Battle, dt: number) {
    const s = battle.state;
    if (s.phase !== "playing") return;
    this.nextThink -= dt;
    if (this.nextThink > 0) return;
    const [lo, hi] = this.prof.think;
    this.nextThink = lo + this.rng() * (hi - lo);

    const p = s.players.get(this.playerId);
    if (!p || !p.alive) return;
    s.aircraft.forEach((a) => {
      if (a.owner !== p.id) this.sawEnemyAir = s.time;
    });
    const owned = battle.ownedNodes(p.id);
    if (owned.length === 0) return;

    const pr = this.prof;
    const threats = this.scout(battle, p, owned);
    this.pickTarget(battle, p, owned);
    if (this.rng() < pr.air) this.tryAir(battle, p);
    if (s.time > 40 && this.rng() < pr.upgrade) this.tryUpgrade(battle, p);
    if (this.rng() < pr.build) this.tryBuild(battle, p, threats);
    if (pr.defend) this.defend(battle, p, threats);
    this.buy(battle, p, owned, threats);
    this.attack(battle, p, owned);
    if (pr.crates) this.chaseCrates(battle, p);
    this.aimHunters(battle, p);
    if (this.rng() < pr.convert) this.tryConvert(battle, p, owned);
    if (s.time >= this.nextRegroup) {
      this.nextRegroup = s.time + 5 + this.rng() * 4;
      this.regroup(battle, p);
    }
  }

  /** 特種部隊：獵殺敵人場上總價值最高的兵種（醫療兵不算） */
  private aimHunters(battle: Battle, p: Player) {
    const s = battle.state;
    const worth = new Map<string, number>();
    const mine: Unit[] = [];
    s.units.forEach((u) => {
      if (u.hp <= 0) return;
      if (u.owner === p.id) {
        if (u.type === "commando") mine.push(u);
      } else if (u.type !== "medic" && u.type !== "para") {
        worth.set(u.type, (worth.get(u.type) ?? 0) + UNITS[u.type as UnitType].cost);
      }
    });
    if (mine.length === 0) return;
    let best = "";
    let bestV = 0;
    worth.forEach((v, t) => {
      if (v > bestV) {
        bestV = v;
        best = t;
      }
    });
    const stale = mine.filter((u) => u.hunt !== best);
    if (stale.length && best) battle.setHunt(p.id, stale.map((u) => u.id), best);
  }

  /** 每個自己的據點附近有多少敵軍 */
  private scout(battle: Battle, p: Player, owned: number[]): Threat[] {
    const s = battle.state;
    const out: Threat[] = owned.map((node) => ({ node, value: 0, soft: 0, hard: 0, lane: -1, x: 0 }));
    s.units.forEach((u) => {
      if (u.owner === p.id || u.inNode >= 0 || u.hp <= 0) return;
      const def = UNITS[u.type as UnitType];
      const geom = battle.map.lanes[u.lane];
      for (const t of out) {
        if (geom.a !== t.node && geom.b !== t.node) continue;
        const d = Math.abs(u.x - nodeEnd(geom, t.node));
        if (d > 280) continue;
        const v = def.cost * (u.hp / u.maxHp);
        t.value += v;
        if (def.armor === "hard") t.hard += v;
        else t.soft += v;
        if (t.lane < 0 || d < Math.abs(t.x - nodeEnd(battle.map.lanes[t.lane], t.node))) {
          t.lane = u.lane;
          t.x = u.x;
        }
      }
    });
    return out;
  }

  /** 進攻目標：近的、血少的、懸賞中的；開局先搶無主堡壘 */
  private pickTarget(battle: Battle, p: Player, owned: number[]) {
    const s = battle.state;
    const cur = this.target >= 0 ? s.nodes[this.target] : undefined;
    if (cur && !(cur.owner === p.id && cur.hp > 0) && s.time < this.targetUntil) return;
    let best = -1;
    let bestScore = Infinity;
    for (let i = 0; i < s.nodes.length; i++) {
      const n = s.nodes[i];
      if (n.owner === p.id && n.hp > 0) continue;
      let d = Infinity;
      for (const o of owned) d = Math.min(d, nodeDistance(battle.map, o, i));
      if (!Number.isFinite(d)) continue;
      let score = d;
      const enemy = !!n.owner && n.hp > 0;
      if (enemy) {
        score += 220 + (this.prof.focus ? (n.hp / n.maxHp) * 350 : 175);
        if (n.kind === "hq") score += 250;
        if (this.prof.focus && n.owner === s.leaderId) score -= 280;
      } else {
        score -= s.time < 120 ? 200 : 60;
      }
      score += this.rng() * 140;
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    this.target = best;
    this.targetUntil = s.time + 25 + this.rng() * 20;
  }

  /** 離目標最近的自己據點：在這裡集結 */
  private staging(battle: Battle, owned: number[]): number {
    if (this.target < 0) return owned[0];
    let best = owned[0];
    let bestD = Infinity;
    for (const o of owned) {
      const d = nodeDistance(battle.map, o, this.target);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    return best;
  }

  /** 自己的兵力組成（野外＋駐軍） */
  private myComp(battle: Battle) {
    const counts = new Map<UnitType, number>();
    let combat = 0; // 不含工兵、醫療兵
    let infantry = 0; // 會被醫療兵治療的戰鬥步兵
    battle.state.units.forEach((u) => {
      if (u.owner !== this.playerId || u.hp <= 0) return;
      const type = u.type as UnitType;
      counts.set(type, (counts.get(type) ?? 0) + 1);
      if (type === "medic" || type === "engineer") return;
      combat += 1;
      if (UNITS[type].armor === "soft") infantry += 1;
    });
    return { counts, combat, infantry };
  }

  private chooseUnit(battle: Battle, threat: Threat | undefined): UnitType {
    const s = battle.state;
    const pr = this.prof;
    const allowed = (t: UnitType) => !pr.units || pr.units.includes(t);
    const pick = (t: UnitType, fallback: UnitType = "rifle") => (allowed(t) ? t : fallback);
    if (threat && threat.hard >= 200 && this.rng() < 0.7) return "at";
    if (threat && threat.soft >= 250 && this.rng() < 0.4) return pick(this.rng() < 0.5 ? "mg" : "flame", "mg");
    // 支援兵種有上限：醫療兵約每 6 個步兵一個，工兵只在要打敵方堡壘時帶
    const mine = this.myComp(battle);
    const t = this.target >= 0 ? s.nodes[this.target] : undefined;
    const enemyFort = !!t && !!t.owner && t.hp > 0;
    if (allowed("medic") && mine.infantry >= 6 && (mine.counts.get("medic") ?? 0) * 6 < mine.infantry && this.rng() < 0.5) return "medic";
    if (allowed("engineer") && enemyFort && mine.combat >= 5 && (mine.counts.get("engineer") ?? 0) * 7 < mine.combat && this.rng() < 0.4) {
      return "engineer";
    }
    // 看對手主力是什麼兵，出剋制的兵種
    if (this.rng() < pr.counter) {
      const c = this.counterPick(battle);
      if (c && allowed(c)) return c;
    }
    if (!enemyFort && s.time < 120 && this.rng() < 0.25) return pick("car", "rifle"); // 開局用裝甲車搶點
    const sawAir = this.sawEnemyAir > 0 && s.time - this.sawEnemyAir < 60;
    if (sawAir && (mine.counts.get("flak") ?? 0) < 2 && this.rng() < 0.2) return pick("flak", "rifle");
    const weights: [UnitType, number][] = (
      [
        ["rifle", 24], ["mg", 12], ["sniper", 6], ["flame", 7], ["car", 7], ["tank", 14],
        ["at", 8], ["flak", 2], ["artillery", 5],
      ] as [UnitType, number][]
    ).filter(([u]) => allowed(u));
    let roll = this.rng() * weights.reduce((a, [, w]) => a + w, 0);
    for (const [type, w] of weights) {
      roll -= w;
      if (roll <= 0) return type;
    }
    return "rifle";
  }

  /** 剋制：統計敵人在野外的兵力，挑最能打它們的兵種 */
  private counterPick(battle: Battle): UnitType | null {
    const s = battle.state;
    let soft = 0;
    let light = 0;
    let hard = 0;
    let longRange = 0; // 機槍、砲兵、狙擊手
    s.units.forEach((u) => {
      if (u.hp <= 0 || u.owner === this.playerId) return;
      const def = UNITS[u.type as UnitType];
      const v = def.cost * (u.hp / u.maxHp);
      if (def.armor === "hard") hard += v;
      else if (def.armor === "light") light += v;
      else soft += v;
      if (u.type === "mg" || u.type === "artillery" || u.type === "sniper") longRange += v;
    });
    const total = soft + light + hard;
    if (total < 150) return null;
    if (hard / total > 0.35) return this.rng() < 0.6 ? "at" : "tank";
    if (light / total > 0.25) return this.rng() < 0.7 ? "at" : "tank";
    if (longRange / total > 0.3) return this.rng() < 0.5 ? "sniper" : "car";
    if (soft / total > 0.6) return this.rng() < 0.4 ? "flame" : this.rng() < 0.5 ? "tank" : "mg";
    return null;
  }

  /** 補給箱：派最近的閒置部隊去撿 */
  private chaseCrates(battle: Battle, p: Player) {
    const s = battle.state;
    s.crates.forEach((c) => {
      if (this.chasedCrates.has(c.id)) return;
      let best: Unit | null = null;
      let bestD = 520;
      s.units.forEach((u) => {
        if (u.owner !== p.id || u.inNode >= 0 || u.hp <= 0 || u.mode === "retreat" || u.attacking) return;
        const d = roadDistance(battle.map, u.lane, u.x, c.lane, c.x);
        if (d < bestD) {
          bestD = d;
          best = u;
        }
      });
      if (!best) return;
      this.chasedCrates.add(c.id);
      battle.order(this.playerId, [(best as Unit).id], [], { lane: c.lane, x: c.x }, true);
    });
  }

  /** 有閒錢就把堡壘改建（補給站、砲台、兵營為主） */
  private tryConvert(battle: Battle, p: Player, owned: number[]) {
    const s = battle.state;
    const forts = owned.filter((i) => s.nodes[i].kind !== "hq" && !s.nodes[i].spec);
    if (!forts.length) return;
    const node = forts[Math.floor(this.rng() * forts.length)];
    const roll = this.rng();
    const spec: FortSpec = roll < 0.35 ? "depot" : roll < 0.65 ? "battery" : roll < 0.85 ? "barracks" : roll < 0.95 ? "hospital" : "flak";
    if (p.fundsExact < FORT_SPEC_DEFS[spec].cost + 250) return;
    battle.convert(this.playerId, node, spec);
  }

  private buy(battle: Battle, p: Player, owned: number[], threats: Threat[]) {
    // 有據點被打就在那裡補兵，不然在前線集結點補兵
    const danger = threats.filter((t) => t.value > 120).sort((a, b) => b.value - a.value)[0];
    const node = danger ? danger.node : this.staging(battle, owned);
    // 平常留一筆錢；據點被打時（會規劃的電腦）把存款全部拿來在那裡補兵
    const reserve =
      danger && this.prof.plan > 0 ? 0 : battle.state.time > 60 ? this.prof.reserve : Math.min(20, this.prof.reserve);
    for (let i = 0; i < 3; i++) {
      const type = this.chooseUnit(battle, danger);
      if (p.fundsExact < UNITS[type].cost + reserve) return;
      if (battle.buy(this.playerId, node, type, 1) !== null) return;
    }
  }

  /** 據點附近有敵人：把裡面的兵派到門口迎戰 */
  private defend(battle: Battle, p: Player, threats: Threat[]) {
    for (const t of threats) {
      if (t.value < 100 || t.lane < 0) continue;
      const inside = battle.garrisonUnits(p.id, t.node);
      if (inside.length === 0) continue;
      const geom = battle.map.lanes[t.lane];
      const from = nodeEnd(geom, t.node);
      const x = from + nodeDir(geom, t.node) * Math.min(70, Math.abs(t.x - from) * 0.5);
      battle.dispatch(this.playerId, t.node, [], [], { lane: t.lane, x }, true);
    }
  }

  private value(u: Unit) {
    return UNITS[u.type as UnitType].cost * (u.hp / u.maxHp);
  }

  /** 估計打下這個據點要面對多少防禦（換算成兵力的錢） */
  private defenseOf(battle: Battle, node: number): number {
    const s = battle.state;
    const n = s.nodes[node];
    let v = 0;
    let gpop = 0;
    s.units.forEach((u) => {
      if (u.owner === this.playerId || u.hp <= 0) return;
      if (u.inNode === node) {
        v += this.value(u);
        gpop += UNITS[u.type as UnitType].pop;
        return;
      }
      if (u.inNode >= 0) return;
      const geom = battle.map.lanes[u.lane];
      if (geom.a !== node && geom.b !== node) return;
      if (Math.abs(u.x - nodeEnd(geom, node)) <= 260) v += this.value(u);
    });
    if (n.owner && n.owner !== this.playerId && n.hp > 0) {
      v += n.hp * 0.25 * (1 + Math.min(GARRISON_FIRE_MAX, gpop * GARRISON_FIRE_BONUS));
    }
    s.structures.forEach((st) => {
      if (st.owner === this.playerId || !st.owner || st.node !== node || st.hp <= 0) return;
      v += STRUCTURES[st.kind as BuildKind].cost * 1.5 * (st.hp / st.maxHp);
    });
    return v;
  }

  /** 集結點的兵夠多（或養兵費太高）就全部派去打目標 */
  private attack(battle: Battle, p: Player, owned: number[]) {
    if (this.target < 0) return;
    if (this.prof.plan > 0) return this.attackPlanned(battle, p, owned);
    const s = battle.state;
    for (const node of owned) {
      const pop = battle.garrisonAt(node);
      if (pop === 0) continue;
      const need = (node === p.hq ? 7 : 5) + this.prof.attackNeed;
      const hoarding = upkeepFor(battle.garrisonPopOf(p.id)) >= 2.2;
      const ready = pop >= need + Math.min(6, Math.floor(s.time / 90)) || hoarding || (s.time < 50 && pop >= 3);
      if (!ready) continue;
      // 大本營留一點兵防守
      const keep = node === p.hq && s.time > 120 ? 2 : 0;
      const inside = battle.garrisonUnits(p.id, node);
      if (inside.length <= keep) continue;
      const counts = new Map<UnitType, number>();
      inside.slice(keep).forEach((u) => counts.set(u.type as UnitType, (counts.get(u.type as UnitType) ?? 0) + 1));
      const arr = UNIT_TYPES.map((t) => counts.get(t) ?? 0);
      battle.dispatch(this.playerId, node, arr, [], { node: this.target }, true);
    }
  }

  /**
   * 有計畫的進攻：後方據點的兵先集中到集結點，
   * 等集結點的兵力夠壓過目標的防禦（堡壘血量、駐軍、附近敵軍、工事）才一起出擊。
   */
  private attackPlanned(battle: Battle, p: Player, owned: number[]) {
    const s = battle.state;
    const pr = this.prof;
    const stage = this.staging(battle, owned);
    if (pr.consolidate) {
      for (const node of owned) {
        if (node === stage) continue;
        const inside = battle.garrisonUnits(p.id, node);
        const keep = node === p.hq ? 3 : 1;
        if (inside.length < keep + 3 || this.nearEnemies(battle, node) > 0) continue;
        const counts = new Map<UnitType, number>();
        inside.slice(keep).forEach((u) => counts.set(u.type as UnitType, (counts.get(u.type as UnitType) ?? 0) + 1));
        battle.dispatch(this.playerId, node, UNIT_TYPES.map((t) => counts.get(t) ?? 0), [], { node: stage }, true);
      }
    }
    const inside = battle.garrisonUnits(p.id, stage);
    const keep = stage === p.hq && s.time > 120 ? 2 : 0;
    if (inside.length <= keep) return;
    // 已經在路上打這個目標的兵也算進去
    let force = 0;
    s.units.forEach((u) => {
      if (u.owner !== p.id || u.hp <= 0) return;
      if ((u.inNode === stage && u.departAt === 0) || (u.inNode < 0 && u.destNode === this.target && u.mode !== "retreat")) {
        force += this.value(u);
      }
    });
    const defense = this.defenseOf(battle, this.target);
    // 快結束時要搶據點，標準放寬
    // 快結束時（有時限的對局）不再慢慢集結
    const ratio = s.duration > 0 && s.time > s.duration - 120 ? pr.plan * 0.6 : pr.plan;
    const pop = battle.garrisonAt(stage);
    const full = pop >= battle.garrisonCapAt(stage) - 1 || p.pop >= POP_CAP - 4 || upkeepFor(battle.garrisonPopOf(p.id)) >= 2.6;
    const rush = s.time < 50 && pop >= 3 && defense < 120;
    if (force < defense * ratio + 60 && !full && !rush) return;
    const counts = new Map<UnitType, number>();
    inside.slice(keep).forEach((u) => counts.set(u.type as UnitType, (counts.get(u.type as UnitType) ?? 0) + 1));
    battle.dispatch(this.playerId, stage, UNIT_TYPES.map((t) => counts.get(t) ?? 0), [], { node: this.target }, true);
  }

  /** 據點附近的敵軍兵力 */
  private nearEnemies(battle: Battle, node: number) {
    let v = 0;
    battle.state.units.forEach((u) => {
      if (u.owner === this.playerId || u.inNode >= 0 || u.hp <= 0) return;
      const geom = battle.map.lanes[u.lane];
      if (geom.a !== node && geom.b !== node) return;
      if (Math.abs(u.x - nodeEnd(geom, node)) <= 300) v += this.value(u);
    });
    return v;
  }

  /** 閒著的部隊（守在路上、或打完的）重新派去目標；血太少的撤退 */
  private regroup(battle: Battle, p: Player) {
    const s = battle.state;
    const idle: string[] = [];
    const groups = new Map<string, Unit[]>();
    s.units.forEach((u) => {
      if (u.owner !== p.id || u.inNode >= 0 || u.hp <= 0 || u.landT > s.time) return;
      if (u.mode === "hold" && !u.attacking) {
        const atOwnedDest = u.destNode >= 0 && battle.owns(p.id, u.destNode);
        if (u.destNode < 0 || atOwnedDest) idle.push(u.id);
      }
      if (u.mode !== "retreat" && u.group) {
        const g = groups.get(u.group) ?? [];
        g.push(u);
        groups.set(u.group, g);
      }
    });
    if (idle.length > 0 && this.target >= 0) {
      if (this.prof.plan > 0) {
        // 零散的兵先回集結點，跟大部隊一起再出發
        const owned = battle.ownedNodes(p.id);
        if (owned.length) battle.order(this.playerId, idle, [], { node: this.staging(battle, owned) }, true);
      } else battle.order(this.playerId, idle, [], { node: this.target }, true);
    }
    for (const g of groups.values()) {
      const ratio = g.reduce((a, u) => a + u.hp / u.maxHp, 0) / g.length;
      if (this.prof.retreat > 0 && ratio < this.prof.retreatAt && g.length >= 2 && this.rng() < this.prof.retreat) {
        battle.retreat(this.playerId, g.map((u) => u.id));
      }
    }
  }

  private tryBuild(battle: Battle, p: Player, threats: Threat[]) {
    if (p.fundsExact < 320) return;
    const recentlyBombed = this.sawEnemyAir > 0 && battle.state.time - this.sawEnemyAir < 60;
    let hasAA = false;
    battle.state.structures.forEach((st) => {
      if (st.owner === p.id && st.kind === "aa") hasAA = true;
    });
    const sorted = [...threats].sort((a, b) => b.value - a.value);
    for (const t of sorted) {
      if (t.value === 0 && !recentlyBombed) continue;
      const lane = t.lane >= 0 ? t.lane : battle.map.adj[t.node][0];
      if (lane === undefined) continue;
      for (let slot = BUILD_SLOTS.length - 1; slot >= 0; slot--) {
        if (!battle.slotFits(lane, slot)) continue;
        if (battle.state.structures.has(`s${lane}_${t.node}_${slot}`)) continue;
        let kind: BuildKind = t.hard > t.soft ? "atnest" : "bunker";
        if (recentlyBombed && !hasAA) kind = "aa";
        if (p.fundsExact < STRUCTURES[kind].cost + 150) return;
        battle.build(this.playerId, lane, t.node, slot, kind);
        return;
      }
    }
  }

  private tryUpgrade(battle: Battle, p: Player) {
    let bestKind: (typeof UPGRADE_KINDS)[number] | null = null;
    let bestCost = Infinity;
    for (const kind of UPGRADE_KINDS) {
      const level = p[kind];
      if (level >= MAX_UPGRADE_LEVEL) continue;
      const cost = UPGRADES[kind].costs[level];
      if (cost < bestCost) {
        bestCost = cost;
        bestKind = kind;
      }
    }
    if (bestKind && p.fundsExact >= bestCost + 250) battle.upgrade(this.playerId, bestKind);
  }

  /** 找敵人最密集的地方叫轟炸，或把空降兵丟到無主堡壘／敵方砲兵旁邊 */
  private tryAir(battle: Battle, p: Player) {
    const s = battle.state;
    const kind: AirKind = this.rng() < 0.6 ? "bomber" : "transport";
    const idx = AIR_KINDS.indexOf(kind);
    if (s.time < (p.airReady[idx] ?? 0) || p.fundsExact < AIRCRAFT[kind].cost + 80) return;

    const enemies: Unit[] = [];
    s.units.forEach((u) => {
      if (u.owner !== p.id && u.landT <= s.time && u.inNode < 0) enemies.push(u);
    });
    if (kind === "bomber") {
      let bestValue = 0;
      let best: Unit | null = null;
      for (const e of enemies) {
        let value = 0;
        for (const o of enemies) {
          if (o.lane === e.lane && Math.abs(o.x - e.x) <= BOMB.spacing * 2 + BOMB.radius) value += UNITS[o.type as UnitType].cost;
        }
        if (value > bestValue) {
          bestValue = value;
          best = e;
        }
      }
      if (best && bestValue >= 300) battle.callAir(this.playerId, "bomber", best.lane, best.x);
      return;
    }
    const targets: { lane: number; x: number }[] = [];
    s.nodes.forEach((n, i) => {
      if ((n.owner && n.hp > 0) || battle.map.adj[i].length === 0) return;
      const lane = battle.map.adj[i][0];
      const geom = battle.map.lanes[lane];
      const end = nodeEnd(geom, i);
      targets.push({ lane, x: end === 0 ? 30 : geom.len - 30 });
    });
    if (targets.length === 0) for (const e of enemies) if (e.type === "artillery") targets.push({ lane: e.lane, x: e.x });
    if (targets.length === 0) return;
    const t = targets[Math.floor(this.rng() * targets.length)];
    battle.callAir(this.playerId, "transport", t.lane, t.x);
  }
}
