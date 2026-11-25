// 電腦玩家：每隔一段時間看一下戰況，用跟真人一樣的指令出兵、蓋工事、升級、叫空軍。
// 也用來代管斷線的玩家。
import {
  AIRCRAFT,
  AIR_KINDS,
  BOMB,
  BUILD_SLOTS,
  MAX_UPGRADE_LEVEL,
  STRUCTURES,
  UNITS,
  UNIT_TYPES,
  UPGRADES,
  UPGRADE_KINDS,
  nodeEnd,
  otherEnd,
  type AirKind,
  type BuildKind,
  type UnitType,
} from "@frontline/shared";
import type { Battle } from "./Battle";
import type { Player, Unit } from "./schema";

interface RouteReport {
  node: number;
  lane: number;
  mine: number;
  enemy: number;
  enemySoft: number;
  enemyHard: number;
  danger: number; // 敵人離這個據點多近（0~1）
  targetFree: boolean; // 路的另一端是無主據點
  targetEnemy: boolean; // 路的另一端是敵人的據點
}

export class BotBrain {
  private nextThink: number;
  private savingFor: UnitType | null = null;
  private sawEnemyAir = 0;

  constructor(
    public playerId: string,
    private rng: () => number = Math.random,
  ) {
    this.nextThink = 1 + rng() * 1.5;
  }

  update(battle: Battle, dt: number) {
    const s = battle.state;
    if (s.phase !== "playing") return;
    this.nextThink -= dt;
    if (this.nextThink > 0) return;
    this.nextThink = 0.7 + this.rng() * 1.1;

    const p = s.players.get(this.playerId);
    if (!p || !p.alive) return;
    s.aircraft.forEach((a) => {
      if (a.owner !== p.id) this.sawEnemyAir = s.time;
    });

    const reports = this.scout(battle, p);
    if (reports.length === 0) return;
    if (this.rng() < 0.5) this.tryAir(battle, p);
    if (s.time > 40 && this.rng() < 0.25) this.tryUpgrade(battle, p);
    if (this.rng() < 0.3) this.tryBuild(battle, p, reports);
    this.trySpawn(battle, p, reports);
  }

  private scout(battle: Battle, p: Player): RouteReport[] {
    const s = battle.state;
    const routes = battle.routesFor(p.id);
    const reports: RouteReport[] = routes.map(({ node, lane }) => {
      const far = otherEnd(battle.map.lanes[lane], node);
      const fn = s.nodes[far];
      return {
        node, lane, mine: 0, enemy: 0, enemySoft: 0, enemyHard: 0, danger: 0,
        targetFree: !fn.owner || fn.hp <= 0,
        targetEnemy: !!fn.owner && fn.owner !== p.id && fn.hp > 0,
      };
    });
    s.units.forEach((u) => {
      const def = UNITS[u.type as UnitType];
      const value = def.cost * (u.hp / u.maxHp);
      for (const r of reports) {
        if (r.lane !== u.lane) continue;
        if (u.owner === p.id) {
          r.mine += value;
          continue;
        }
        r.enemy += value;
        if (def.armor === "hard") r.enemyHard += value;
        else r.enemySoft += value;
        const home = nodeEnd(battle.map.lanes[u.lane], r.node);
        r.danger = Math.max(r.danger, 1 - Math.abs(u.x - home) / battle.map.lanes[u.lane].len);
      }
    });
    return reports;
  }

  private pickRoute(reports: RouteReport[], time: number): RouteReport {
    if (this.rng() < 0.2) return reports[Math.floor(this.rng() * reports.length)];
    let best = reports[0];
    let bestScore = -Infinity;
    for (const r of reports) {
      // 開局搶無主堡壘；之後看哪裡壓力大、哪裡可以打敵人
      let score = r.enemy - r.mine + r.danger * 260 + this.rng() * 50;
      if (r.targetFree) score += time < 90 ? 220 : 90;
      if (r.targetEnemy) score += 60;
      if (!r.targetFree && !r.targetEnemy && r.enemy === 0) score -= 120; // 往自己後方的路
      if (score > bestScore) {
        bestScore = score;
        best = r;
      }
    }
    return best;
  }

  private chooseUnit(r: RouteReport): UnitType {
    if (r.enemyHard >= 200 && this.rng() < 0.75) return "at";
    if (r.enemySoft >= 280 && this.rng() < 0.5) return this.rng() < 0.5 ? "mg" : "tank";
    if (r.targetEnemy && this.rng() < 0.25) return this.rng() < 0.5 ? "tank" : "artillery";
    const roll = this.rng();
    if (roll < 0.38) return "rifle";
    if (roll < 0.56) return "mg";
    if (roll < 0.72) return "tank";
    if (roll < 0.86) return "at";
    return "artillery";
  }

  private trySpawn(battle: Battle, p: Player, reports: RouteReport[]) {
    const r = this.pickRoute(reports, battle.state.time);
    let type = this.savingFor ?? this.chooseUnit(r);
    const ready = battle.state.time >= (p.deployReady[UNIT_TYPES.indexOf(type)] ?? 0);
    if (!ready || p.fundsExact < UNITS[type].cost) {
      if (ready && this.rng() < 0.5) {
        this.savingFor = type;
        return;
      }
      type = "rifle";
    }
    if (battle.spawn(this.playerId, type, r.lane, r.node) === null && type === this.savingFor) this.savingFor = null;
  }

  private tryBuild(battle: Battle, p: Player, reports: RouteReport[]) {
    if (p.fundsExact < 320) return;
    const recentlyBombed = this.sawEnemyAir > 0 && battle.state.time - this.sawEnemyAir < 60;
    let hasAA = false;
    battle.state.structures.forEach((st) => {
      if (st.owner === p.id && st.kind === "aa") hasAA = true;
    });
    const sorted = [...reports].sort((a, b) => b.enemy + b.danger * 300 - (a.enemy + a.danger * 300));
    for (const r of sorted) {
      if (r.enemy === 0 && !recentlyBombed) continue;
      for (let slot = BUILD_SLOTS.length - 1; slot >= 0; slot--) {
        if (!battle.slotFits(r.lane, slot)) continue;
        if (battle.state.structures.has(`s${r.lane}_${r.node}_${slot}`)) continue;
        let kind: BuildKind = r.enemyHard > r.enemySoft ? "atnest" : "bunker";
        if (recentlyBombed && !hasAA) kind = "aa";
        if (p.fundsExact < STRUCTURES[kind].cost + 150) return;
        battle.build(this.playerId, r.lane, r.node, slot, kind);
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
    if (bestKind && p.fundsExact >= bestCost + 200) battle.upgrade(this.playerId, bestKind);
  }

  /** 找敵人最密集的地方叫轟炸，或把空降兵丟到無主堡壘／敵方砲兵旁邊 */
  private tryAir(battle: Battle, p: Player) {
    const s = battle.state;
    const kind: AirKind = this.rng() < 0.6 ? "bomber" : "transport";
    const idx = AIR_KINDS.indexOf(kind);
    if (s.time < (p.airReady[idx] ?? 0) || p.fundsExact < AIRCRAFT[kind].cost + 60) return;

    const enemies: Unit[] = [];
    s.units.forEach((u) => {
      if (u.owner !== p.id && u.landT <= s.time) enemies.push(u);
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
    // 空降：優先丟在無主堡壘旁邊搶佔，其次是敵方砲兵
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
