// 電腦玩家：每隔一段時間看一下戰況，用跟真人一樣的指令買兵、派兵、調度、蓋工事、升級、叫空軍。
// 也用來代管斷線的玩家。
import {
  AIRCRAFT,
  AIR_KINDS,
  BOMB,
  BUILD_SLOTS,
  MAX_UPGRADE_LEVEL,
  STRUCTURES,
  UNITS,
  UPGRADES,
  UPGRADE_KINDS,
  nodeDistance,
  nodeEnd,
  nodeDir,
  type AirKind,
  type BuildKind,
  type UnitType,
} from "@frontline/shared";
import type { Battle } from "./Battle";
import type { Player, Unit } from "./schema";

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

  constructor(
    public playerId: string,
    private rng: () => number = Math.random,
  ) {
    this.nextThink = 0.5 + rng() * 1.5;
  }

  update(battle: Battle, dt: number) {
    const s = battle.state;
    if (s.phase !== "playing") return;
    this.nextThink -= dt;
    if (this.nextThink > 0) return;
    this.nextThink = 0.7 + this.rng() * 0.9;

    const p = s.players.get(this.playerId);
    if (!p || !p.alive) return;
    s.aircraft.forEach((a) => {
      if (a.owner !== p.id) this.sawEnemyAir = s.time;
    });
    const owned = battle.ownedNodes(p.id);
    if (owned.length === 0) return;

    const threats = this.scout(battle, p, owned);
    this.pickTarget(battle, p, owned);
    if (this.rng() < 0.5) this.tryAir(battle, p);
    if (s.time > 40 && this.rng() < 0.2) this.tryUpgrade(battle, p);
    if (this.rng() < 0.3) this.tryBuild(battle, p, threats);
    this.defend(battle, p, threats);
    this.buy(battle, p, owned, threats);
    this.attack(battle, p, owned);
    if (s.time >= this.nextRegroup) {
      this.nextRegroup = s.time + 5 + this.rng() * 4;
      this.regroup(battle, p);
    }
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
        score += 220 + (n.hp / n.maxHp) * 350;
        if (n.kind === "hq") score += 250;
        if (n.owner === s.leaderId) score -= 280;
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

  private chooseUnit(battle: Battle, threat: Threat | undefined): UnitType {
    const s = battle.state;
    if (threat && threat.hard >= 200 && this.rng() < 0.7) return "at";
    if (threat && threat.soft >= 250 && this.rng() < 0.4) return "mg";
    const t = this.target >= 0 ? s.nodes[this.target] : undefined;
    const enemyFort = !!t && !!t.owner && t.hp > 0;
    const roll = this.rng();
    if (enemyFort && roll < 0.2) return "engineer";
    if (roll < 0.36) return "rifle";
    if (roll < 0.5) return "mg";
    if (roll < 0.66) return "tank";
    if (roll < 0.76) return "at";
    if (roll < 0.86) return "medic";
    if (roll < 0.93) return "engineer";
    return "artillery";
  }

  private buy(battle: Battle, p: Player, owned: number[], threats: Threat[]) {
    // 有據點被打就在那裡補兵，不然在前線集結點補兵
    const danger = threats.filter((t) => t.value > 120).sort((a, b) => b.value - a.value)[0];
    const node = danger ? danger.node : this.staging(battle, owned);
    const reserve = battle.state.time > 60 ? 80 : 20;
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

  /** 集結點的兵夠多（或養兵費太高）就全部派去打目標 */
  private attack(battle: Battle, p: Player, owned: number[]) {
    if (this.target < 0) return;
    const s = battle.state;
    for (const node of owned) {
      const pop = battle.garrisonAt(node);
      if (pop === 0) continue;
      const need = node === p.hq ? 7 : 5;
      const ready = pop >= need + Math.min(6, Math.floor(s.time / 90)) || p.upkeep >= 2.2 || (s.time < 50 && pop >= 3);
      if (!ready) continue;
      // 大本營留一點兵防守
      const keep = node === p.hq && s.time > 120 ? 2 : 0;
      const inside = battle.garrisonUnits(p.id, node);
      if (inside.length <= keep) continue;
      const counts = new Map<UnitType, number>();
      inside.slice(keep).forEach((u) => counts.set(u.type as UnitType, (counts.get(u.type as UnitType) ?? 0) + 1));
      const arr = ["rifle", "mg", "at", "tank", "artillery", "engineer", "medic"].map((t) => counts.get(t as UnitType) ?? 0);
      battle.dispatch(this.playerId, node, arr, [], { node: this.target }, true);
    }
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
    if (idle.length > 0 && this.target >= 0) battle.order(this.playerId, idle, [], { node: this.target }, true);
    for (const g of groups.values()) {
      const ratio = g.reduce((a, u) => a + u.hp / u.maxHp, 0) / g.length;
      if (ratio < 0.3 && g.length >= 2 && this.rng() < 0.5) battle.retreat(this.playerId, g.map((u) => u.id));
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
