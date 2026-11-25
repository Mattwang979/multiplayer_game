// 電腦玩家：每隔一段時間看一下戰況，用跟真人一樣的指令出兵、蓋工事、升級、叫空軍。
// 也用來代管斷線的玩家。
import {
  AIRCRAFT,
  AIR_KINDS,
  BOMB,
  BUILD_SLOTS,
  LANE_LENGTH,
  MAX_UPGRADE_LEVEL,
  STRUCTURES,
  UNITS,
  UNIT_TYPES,
  UPGRADES,
  UPGRADE_KINDS,
  nodeEnd,
  nodeLanes,
  type AirKind,
  type BuildKind,
  type UnitType,
} from "@frontline/shared";
import type { Battle } from "./Battle";
import type { Player, Unit } from "./schema";

interface LaneReport {
  lane: number;
  mine: number; // 我方部隊價值
  enemy: number; // 敵方部隊價值
  enemySoft: number;
  enemyHard: number;
  danger: number; // 敵人離我方指揮部多近（0~1）
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
      if (a.side !== p.node) this.sawEnemyAir = s.time;
    });

    const reports = this.scout(battle, p);
    if (this.rng() < 0.5) this.tryAir(battle, p);
    if (s.time > 40 && this.rng() < 0.25) this.tryUpgrade(battle, p);
    if (this.rng() < 0.3) this.tryBuild(battle, p, reports);
    this.trySpawn(battle, p, reports);
  }

  private scout(battle: Battle, p: Player): LaneReport[] {
    const lanes = nodeLanes(battle.map, p.node);
    const reports = lanes.map((lane) => ({ lane, mine: 0, enemy: 0, enemySoft: 0, enemyHard: 0, danger: 0 }));
    battle.state.units.forEach((u) => {
      const r = reports.find((x) => x.lane === u.lane);
      if (!r) return;
      const def = UNITS[u.type as UnitType];
      const value = def.cost * (u.hp / u.maxHp);
      if (u.side === p.node) {
        r.mine += value;
        return;
      }
      r.enemy += value;
      if (def.armor === "hard") r.enemyHard += value;
      else r.enemySoft += value;
      const home = nodeEnd(battle.map.lanes[u.lane], p.node);
      r.danger = Math.max(r.danger, 1 - Math.abs(u.x - home) / LANE_LENGTH);
    });
    return reports;
  }

  private pickLane(reports: LaneReport[]): LaneReport {
    // 25% 機率隨便選一條，避免只顧一條線
    if (this.rng() < 0.25) return reports[Math.floor(this.rng() * reports.length)];
    let best = reports[0];
    let bestScore = -Infinity;
    for (const r of reports) {
      const score = r.enemy - r.mine + r.danger * 250 + this.rng() * 40;
      if (score > bestScore) {
        bestScore = score;
        best = r;
      }
    }
    return best;
  }

  private chooseUnit(r: LaneReport): UnitType {
    if (r.enemyHard >= 200 && this.rng() < 0.75) return "at";
    if (r.enemySoft >= 280 && this.rng() < 0.5) return this.rng() < 0.5 ? "mg" : "tank";
    const roll = this.rng();
    if (roll < 0.38) return "rifle";
    if (roll < 0.56) return "mg";
    if (roll < 0.72) return "tank";
    if (roll < 0.86) return "at";
    return "artillery";
  }

  private trySpawn(battle: Battle, p: Player, reports: LaneReport[]) {
    if (reports.length === 0) return;
    const lane = this.pickLane(reports);
    let type = this.savingFor ?? this.chooseUnit(lane);
    const ready = battle.state.time >= (p.deployReady[UNIT_TYPES.indexOf(type)] ?? 0);

    if (!ready || p.fundsExact < UNITS[type].cost) {
      // 錢不夠時：一半機會存錢，一半機會先出便宜的步兵
      if (ready && this.rng() < 0.5) {
        this.savingFor = type;
        return;
      }
      type = "rifle";
    }
    if (battle.spawn(this.playerId, type, lane.lane) === null && type === this.savingFor) this.savingFor = null;
  }

  private tryBuild(battle: Battle, p: Player, reports: LaneReport[]) {
    if (p.fundsExact < 320) return;
    // 看過敵方飛機，而且還沒有防空砲：優先蓋一座
    const recentlyBombed = battle.state.time - this.sawEnemyAir < 60 && this.sawEnemyAir > 0;
    let hasAA = false;
    battle.state.structures.forEach((st) => {
      if (st.owner === p.id && st.kind === "aa") hasAA = true;
    });
    const sorted = [...reports].sort((a, b) => b.enemy + b.danger * 300 - (a.enemy + a.danger * 300));
    for (const r of sorted) {
      for (let slot = BUILD_SLOTS.length - 1; slot >= 0; slot--) {
        if (battle.state.structures.has(`s${p.node}_${r.lane}_${slot}`)) continue;
        let kind: BuildKind = r.enemyHard > r.enemySoft ? "atnest" : "bunker";
        if (recentlyBombed && !hasAA) kind = "aa";
        if (p.fundsExact < STRUCTURES[kind].cost + 150) return;
        battle.build(this.playerId, r.lane, slot, kind);
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

  /** 找敵人最密集的地方叫轟炸，或把空降兵丟到敵方砲兵／工事附近 */
  private tryAir(battle: Battle, p: Player) {
    const s = battle.state;
    const kind: AirKind = this.rng() < 0.6 ? "bomber" : "transport";
    const idx = AIR_KINDS.indexOf(kind);
    if (s.time < (p.airReady[idx] ?? 0) || p.fundsExact < AIRCRAFT[kind].cost + 60) return;

    const enemies: Unit[] = [];
    s.units.forEach((u) => {
      if (u.side !== p.node && u.landT <= s.time) enemies.push(u);
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
    // 空降：挑敵方的砲兵或工事，丟在它旁邊
    const targets: { lane: number; x: number }[] = [];
    for (const e of enemies) if (e.type === "artillery") targets.push({ lane: e.lane, x: e.x });
    s.structures.forEach((st) => {
      if (st.side !== p.node && st.kind !== "hq" && st.lane >= 0) targets.push({ lane: st.lane, x: st.x });
    });
    if (targets.length === 0) return;
    const t = targets[Math.floor(this.rng() * targets.length)];
    battle.callAir(this.playerId, "transport", t.lane, t.x);
  }
}
