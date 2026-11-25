// 對局模擬：伺服器每 tick 呼叫 step()，所有規則都在這裡。
// 這個類別不依賴網路，所以可以直接拿來寫測試或跑電腦對電腦。
import {
  AIRCRAFT,
  AIR_KINDS,
  AIR_UNLOCK_TIME,
  ARMOR_PER_LEVEL,
  BASE_INCOME,
  BOMB,
  BOUNTY_RATIO,
  BUILD_KINDS,
  BUILD_SLOTS,
  DAMAGE_TABLE,
  FACTIONS,
  FIREPOWER_PER_LEVEL,
  HQ_KILL_BOUNTY,
  LANE_LENGTH,
  LOGISTICS_COOLDOWN_PER_LEVEL,
  LOGISTICS_INCOME_PER_LEVEL,
  MATCH_SECONDS,
  MAX_UNITS_PER_PLAYER,
  MAX_UPGRADE_LEVEL,
  PARA_LAND_TIME,
  PARA_SQUADS,
  SPAWN_OFFSET,
  START_FUNDS,
  STRUCTURES,
  TERRITORY_INCOME,
  UNITS,
  UNIT_TYPES,
  UPGRADES,
  UPGRADE_KINDS,
  WINNER_DRAW,
  WORLD_H,
  WORLD_W,
  buildMap,
  lanePoint,
  nodeDir,
  nodeEnd,
  nodeLanes,
  type AirKind,
  type ArmorClass,
  type BuildKind,
  type MapLayout,
  type StructureKind,
  type UnitType,
  type UpgradeKind,
  type WeaponClass,
} from "@frontline/shared";
import { Aircraft, Player, Structure, Unit, type BattleState } from "./schema";

type Target = Unit | Structure;
type EventSink = (type: string, payload: unknown) => void;

interface PendingBomb {
  owner: string;
  side: number;
  lane: number;
  x: number;
  at: number;
}

const FRONT_SPEED = 80; // 前線每秒最多移動多少

export class Battle {
  map: MapLayout = buildMap(2);
  private nextId = 1;
  private bombs: PendingBomb[] = [];
  private lastHit = new Map<string, string>(); // 誰最後打中這個目標（算賞金）
  private hqAlerted = new Map<number, number>(); // 指揮部血量警報已經發到第幾級

  constructor(
    public state: BattleState,
    private emit: EventSink = () => {},
    private rng: () => number = Math.random,
  ) {}

  // ================================================================ 開局

  start(duration = MATCH_SECONDS) {
    const s = this.state;
    const players: Player[] = [];
    s.players.forEach((p) => players.push(p));
    players.sort((a, b) => a.faction - b.faction);
    const n = players.length;
    this.map = buildMap(n);

    s.units.clear();
    s.structures.clear();
    s.aircraft.clear();
    s.fronts.clear();
    for (let i = 0; i < this.map.lanes.length; i++) s.fronts.push(LANE_LENGTH / 2);
    this.bombs = [];
    this.lastHit.clear();
    this.hqAlerted.clear();
    this.nextId = 1;

    players.forEach((p, node) => {
      p.node = node;
      p.alive = true;
      p.rank = 0;
      p.fundsExact = START_FUNDS;
      p.funds = START_FUNDS;
      p.firepower = p.armor = p.logistics = 0;
      p.deployReady.clear();
      for (let i = 0; i < UNIT_TYPES.length; i++) p.deployReady.push(0);
      p.airReady.clear();
      for (let i = 0; i < AIR_KINDS.length; i++) p.airReady.push(AIR_UNLOCK_TIME);
      p.unitCount = 0;
      p.kills = p.deployed = p.spent = 0;

      const hq = new Structure();
      hq.id = `hq${node}`;
      hq.kind = "hq";
      hq.owner = p.id;
      hq.side = node;
      hq.lane = -1;
      hq.hp = hq.maxHp = STRUCTURES.hq.hp;
      s.structures.set(hq.id, hq);
    });

    s.nodeCount = this.map.n;
    s.time = 0;
    s.duration = duration;
    s.winnerId = "";
    s.endReason = "";
    s.phase = "playing";
  }

  // ================================================================ 玩家指令
  // 每個指令成功回傳 null，失敗回傳錯誤訊息（顯示給玩家看）

  spawn(playerId: string, type: UnitType, lane: number): string | null {
    const p = this.activePlayer(playerId);
    if (!p) return "現在不能下指令";
    const idx = UNIT_TYPES.indexOf(type);
    if (idx < 0) return "沒有這個兵種";
    const def = UNITS[type];
    if (!this.ownLane(p, lane)) return "只能從自己的指揮部出兵到相連的路線";
    if (p.unitCount >= MAX_UNITS_PER_PLAYER) return `部隊數量已達上限 ${MAX_UNITS_PER_PLAYER}`;
    if (this.state.time < (p.deployReady[idx] ?? 0)) return `${def.name}還在整備中`;
    if (p.fundsExact < def.cost) return "軍費不足";

    const geom = this.map.lanes[lane];
    const dir = nodeDir(geom, p.node);
    this.addUnit(p, type, lane, nodeEnd(geom, p.node) + dir * SPAWN_OFFSET, dir, 0);
    this.pay(p, def.cost);
    p.deployed += 1;
    p.deployReady[idx] = this.state.time + def.deployCooldown * this.cooldownMult(p);
    return null;
  }

  build(playerId: string, lane: number, slot: number, kind: BuildKind): string | null {
    const p = this.activePlayer(playerId);
    if (!p) return "現在不能下指令";
    if (!this.ownLane(p, lane)) return "只能蓋在自己指揮部相連的路線上";
    if (!Number.isInteger(slot) || slot < 0 || slot >= BUILD_SLOTS.length) return "工事格錯誤";
    if (!BUILD_KINDS.includes(kind)) return "沒有這種工事";
    const id = `s${p.node}_${lane}_${slot}`;
    if (this.state.structures.has(id)) return "這格已經有工事了";
    const def = STRUCTURES[kind];
    if (p.fundsExact < def.cost) return "軍費不足";

    const geom = this.map.lanes[lane];
    const st = new Structure();
    st.id = id;
    st.kind = kind;
    st.owner = p.id;
    st.side = p.node;
    st.lane = lane;
    st.slot = slot;
    st.x = nodeEnd(geom, p.node) + nodeDir(geom, p.node) * BUILD_SLOTS[slot];
    st.hp = st.maxHp = def.hp * this.armorMult(p);
    this.state.structures.set(id, st);
    this.pay(p, def.cost);
    return null;
  }

  upgrade(playerId: string, kind: UpgradeKind): string | null {
    const p = this.activePlayer(playerId);
    if (!p) return "現在不能下指令";
    if (!UPGRADE_KINDS.includes(kind)) return "沒有這種升級";
    const level = p[kind];
    if (level >= MAX_UPGRADE_LEVEL) return "已經升到最高級";
    const cost = UPGRADES[kind].costs[level];
    if (p.fundsExact < cost) return "軍費不足";

    const before = this.armorMult(p);
    p[kind] = level + 1;
    this.pay(p, cost);
    // 裝甲升級立刻套用到場上已經有的部隊和工事
    if (kind === "armor") {
      const ratio = this.armorMult(p) / before;
      const scale = (t: Target) => {
        if (t.owner !== p.id || (t instanceof Structure && t.kind === "hq")) return;
        t.maxHp *= ratio;
        t.hp *= ratio;
      };
      this.state.units.forEach(scale);
      this.state.structures.forEach(scale);
    }
    return null;
  }

  callAir(playerId: string, kind: AirKind, lane: number, x: number): string | null {
    const p = this.activePlayer(playerId);
    if (!p) return "現在不能下指令";
    const idx = AIR_KINDS.indexOf(kind);
    if (idx < 0) return "沒有這種飛機";
    if (!Number.isInteger(lane) || lane < 0 || lane >= this.map.lanes.length) return "路線錯誤";
    if (typeof x !== "number" || !Number.isFinite(x)) return "位置錯誤";
    const def = AIRCRAFT[kind];
    if (this.state.time < (p.airReady[idx] ?? 0)) {
      return this.state.time < AIR_UNLOCK_TIME ? `空軍 ${AIR_UNLOCK_TIME} 秒後才能出動` : `${def.name}還在整備中`;
    }
    if (p.fundsExact < def.cost) return "軍費不足";

    const tx = Math.max(60, Math.min(LANE_LENGTH - 60, x));
    const home = this.map.nodes[p.node];
    const target = lanePoint(this.map.lanes[lane], tx);
    const a = new Aircraft();
    a.id = `a${this.nextId++}`;
    a.kind = kind;
    a.owner = p.id;
    a.side = p.node;
    a.x = home.x;
    a.y = home.y;
    a.wx = target.x;
    a.wy = target.y;
    a.angle = Math.atan2(target.y - home.y, target.x - home.x);
    a.hp = a.maxHp = def.hp * this.armorMult(p);
    a.lane = lane;
    a.tx = tx;
    this.state.aircraft.set(a.id, a);

    this.pay(p, def.cost);
    p.airReady[idx] = this.state.time + def.cooldown * this.cooldownMult(p);
    this.emit("airIncoming", { side: p.node, kind, lane, x: tx });
    return null;
  }

  // ================================================================ 每 tick 的模擬

  step(dt: number) {
    const s = this.state;
    if (s.phase !== "playing") return;
    s.time += dt;

    this.updateIncome(dt);
    this.resolveBombs();

    const units: Unit[] = [];
    s.units.forEach((u) => units.push(u));
    const structures: Structure[] = [];
    s.structures.forEach((st) => structures.push(st));
    const planes: Aircraft[] = [];
    s.aircraft.forEach((a) => planes.push(a));

    for (const a of planes) this.updateAircraft(a, dt);
    for (const u of units) this.updateUnit(u, units, structures, dt);
    for (const st of structures) this.updateStructure(st, units, planes, dt);

    this.removeDead();
    if (s.phase !== "playing") return;

    this.updateFronts(dt);
    if (s.time >= s.duration) this.endByTime();
  }

  // ================================================================ 經濟與領土

  /** 某個指揮部在兩條相連路線上平均佔有多少比例（0~1） */
  territory(node: number): number {
    const lanes = nodeLanes(this.map, node);
    if (lanes.length === 0 || this.state.fronts.length === 0) return 0.5;
    let sum = 0;
    for (const li of lanes) {
      const f = (this.state.fronts[li] ?? LANE_LENGTH / 2) / LANE_LENGTH;
      sum += this.map.lanes[li].a === node ? f : 1 - f;
    }
    return sum / lanes.length;
  }

  private updateIncome(dt: number) {
    this.state.players.forEach((p) => {
      if (!p.alive || p.node < 0) {
        if (p.income !== 0) p.income = 0;
        return;
      }
      const income = BASE_INCOME + TERRITORY_INCOME * this.territory(p.node) + p.logistics * LOGISTICS_INCOME_PER_LEVEL;
      p.fundsExact += income * dt;
      p.funds = Math.floor(p.fundsExact);
      const shown = Math.round(income * 10) / 10;
      if (p.income !== shown) p.income = shown;
    });
  }

  // ================================================================ 地面戰鬥

  private updateUnit(u: Unit, units: Unit[], structures: Structure[], dt: number) {
    if (u.hp <= 0) return;
    if (u.landT > this.state.time) return; // 空降兵還在降落傘上
    const def = UNITS[u.type as UnitType];
    u.cooldownLeft = Math.max(0, u.cooldownLeft - dt);
    const target = this.findTargetForUnit(u, units, structures, def.range);

    if (target) {
      if (!u.attacking) u.attacking = true;
      if (u.cooldownLeft <= 0) {
        u.cooldownLeft = def.cooldown;
        const dmg = def.damage * this.firepowerMult(u.owner);
        const tx = this.targetX(target, u.lane);
        if (def.splash) this.splash(u.owner, u.side, u.lane, tx, def.splash, dmg, def.weapon, units, structures);
        else this.hit(u.owner, target, dmg, def.weapon);
        u.tx = tx;
        u.shots = (u.shots + 1) % 256;
      }
      return;
    }

    if (u.attacking) u.attacking = false;
    let nx = u.x + u.dir * def.speed * dt;
    if (nx > LANE_LENGTH || nx < 0) {
      const geom = this.map.lanes[u.lane];
      const endNode = u.dir > 0 ? geom.b : geom.a;
      const next = this.isAlive(endNode) ? -1 : nodeLanes(this.map, endNode).find((li) => li !== u.lane) ?? -1;
      if (next >= 0) {
        // 前方指揮部已經被消滅：穿過廢墟，繼續往下一家推進
        const ng = this.map.lanes[next];
        u.lane = next;
        u.dir = nodeDir(ng, endNode);
        nx = nodeEnd(ng, endNode);
      } else {
        nx = Math.max(0, Math.min(LANE_LENGTH, nx));
      }
    }
    u.x = nx;
  }

  /** 目標在這條路線上的位置（指揮部在路線的端點） */
  private targetX(t: Target, lane: number): number {
    if (t instanceof Structure && t.kind === "hq") return nodeEnd(this.map.lanes[lane], t.side);
    return t.x;
  }

  private findTargetForUnit(u: Unit, units: Unit[], structures: Structure[], range: number): Target | null {
    let best: Target | null = null;
    let bestDist = range;
    const now = this.state.time;
    for (const e of units) {
      if (e.side === u.side || e.lane !== u.lane || e.hp <= 0 || e.landT > now) continue;
      const d = Math.abs(e.x - u.x);
      if (d <= bestDist) {
        bestDist = d;
        best = e;
      }
    }
    const geom = this.map.lanes[u.lane];
    for (const st of structures) {
      if (st.side === u.side || st.hp <= 0) continue;
      let d: number;
      if (st.kind === "hq") {
        if (st.side !== geom.a && st.side !== geom.b) continue;
        d = Math.abs(nodeEnd(geom, st.side) - u.x);
      } else {
        if (st.lane !== u.lane) continue;
        d = Math.abs(st.x - u.x);
      }
      if (d <= bestDist) {
        bestDist = d;
        best = st;
      }
    }
    return best;
  }

  private updateStructure(st: Structure, units: Unit[], planes: Aircraft[], dt: number) {
    if (st.hp <= 0) return;
    const def = STRUCTURES[st.kind as StructureKind];
    const mult = this.firepowerMult(st.owner);

    // 對地
    if (def.damage > 0) {
      st.cooldownLeft = Math.max(0, st.cooldownLeft - dt);
      if (st.cooldownLeft <= 0) {
        const lanes = st.kind === "hq" ? nodeLanes(this.map, st.side) : [st.lane];
        let best: Unit | null = null;
        let bestDist = def.range;
        const now = this.state.time;
        for (const e of units) {
          if (e.side === st.side || e.hp <= 0 || e.landT > now || !lanes.includes(e.lane)) continue;
          const sx = st.kind === "hq" ? nodeEnd(this.map.lanes[e.lane], st.side) : st.x;
          const d = Math.abs(e.x - sx);
          if (d <= bestDist) {
            bestDist = d;
            best = e;
          }
        }
        if (best) {
          st.cooldownLeft = def.cooldown;
          this.hit(st.owner, best, def.damage * mult, def.weapon);
          st.tx = best.x;
          st.tl = best.lane;
          st.shots = (st.shots + 1) % 256;
        }
      }
    }

    // 對空
    if (def.airDamage > 0) {
      st.airCooldownLeft = Math.max(0, st.airCooldownLeft - dt);
      if (st.airCooldownLeft <= 0) {
        const pos = this.structurePos(st);
        let best: Aircraft | null = null;
        let bestDist = def.airRange;
        for (const a of planes) {
          if (a.side === st.side || a.hp <= 0) continue;
          const d = Math.hypot(a.x - pos.x, a.y - pos.y);
          if (d <= bestDist) {
            bestDist = d;
            best = a;
          }
        }
        if (best) {
          st.airCooldownLeft = def.airCooldown;
          best.hp -= def.airDamage * mult;
          this.lastHit.set(best.id, st.owner);
          st.ax = best.x;
          st.ay = best.y;
          st.airShots = (st.airShots + 1) % 256;
        }
      }
    }
  }

  structurePos(st: Structure): { x: number; y: number } {
    if (st.kind === "hq") return this.map.nodes[st.side];
    return lanePoint(this.map.lanes[st.lane], st.x);
  }

  private armorOf(t: Target): ArmorClass {
    if (t instanceof Unit) return UNITS[t.type as UnitType].armor;
    return "building";
  }

  private hit(attacker: string, target: Target, damage: number, weapon: WeaponClass) {
    target.hp -= damage * DAMAGE_TABLE[weapon][this.armorOf(target)];
    this.lastHit.set(target.id, attacker);
  }

  /** 範圍傷害：打到這條路線上 cx 附近所有「不是自己人」的東西 */
  private splash(
    attacker: string, side: number, lane: number, cx: number, radius: number,
    damage: number, weapon: WeaponClass, units: Unit[], structures: Structure[],
  ) {
    const now = this.state.time;
    for (const e of units) {
      if (e.side === side || e.lane !== lane || e.hp <= 0 || e.landT > now) continue;
      if (Math.abs(e.x - cx) <= radius) this.hit(attacker, e, damage, weapon);
    }
    const geom = this.map.lanes[lane];
    for (const st of structures) {
      if (st.side === side || st.hp <= 0) continue;
      let sx: number;
      if (st.kind === "hq") {
        if (st.side !== geom.a && st.side !== geom.b) continue;
        sx = nodeEnd(geom, st.side);
      } else {
        if (st.lane !== lane) continue;
        sx = st.x;
      }
      if (Math.abs(sx - cx) <= radius) this.hit(attacker, st, damage, weapon);
    }
  }

  // ================================================================ 空軍

  private updateAircraft(a: Aircraft, dt: number) {
    if (a.hp <= 0) return;
    const def = AIRCRAFT[a.kind as AirKind];
    const step = def.speed * dt;
    if (!a.dropped) {
      const dx = a.wx - a.x;
      const dy = a.wy - a.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= step) {
        a.x = a.wx;
        a.y = a.wy;
        a.dropped = true;
        this.dropPayload(a);
        return;
      }
      a.x += (dx / dist) * step;
      a.y += (dy / dist) * step;
      return;
    }
    // 投彈後沿原方向飛出地圖
    a.x += Math.cos(a.angle) * step;
    a.y += Math.sin(a.angle) * step;
    const m = 160;
    if (a.x < -m || a.y < -m || a.x > WORLD_W + m || a.y > WORLD_H + m) {
      this.state.aircraft.delete(a.id);
      this.lastHit.delete(a.id);
    }
  }

  private dropPayload(a: Aircraft) {
    const now = this.state.time;
    if (a.kind === "bomber") {
      for (let i = 0; i < BOMB.count; i++) {
        const offset = (i - (BOMB.count - 1) / 2) * BOMB.spacing;
        this.bombs.push({ owner: a.owner, side: a.side, lane: a.lane, x: a.tx + offset, at: now + 0.25 + i * BOMB.interval });
      }
      return;
    }
    // 運輸機：投下空降兵
    const p = this.state.players.get(a.owner);
    if (!p || !p.alive) return;
    const dir = this.paraDirection(a.side, a.lane, a.tx);
    for (let i = 0; i < PARA_SQUADS; i++) {
      if (p.unitCount >= MAX_UNITS_PER_PLAYER) break;
      const x = Math.max(0, Math.min(LANE_LENGTH, a.tx + (i - (PARA_SQUADS - 1) / 2) * 30));
      this.addUnit(p, "para", a.lane, x, dir, now + PARA_LAND_TIME + i * 0.2);
    }
    this.emit("paradrop", { lane: a.lane, x: a.tx, side: a.side });
  }

  /** 空降兵落地後往哪邊打：往最近的、活著的敵方指揮部 */
  private paraDirection(side: number, lane: number, x: number): 1 | -1 {
    const geom = this.map.lanes[lane];
    const enemyA = geom.a !== side && this.isAlive(geom.a);
    const enemyB = geom.b !== side && this.isAlive(geom.b);
    if (enemyA && enemyB) return x < LANE_LENGTH / 2 ? -1 : 1;
    if (enemyA) return -1;
    if (enemyB) return 1;
    if (geom.a === side) return 1;
    if (geom.b === side) return -1;
    return x < LANE_LENGTH / 2 ? -1 : 1;
  }

  private resolveBombs() {
    const now = this.state.time;
    if (this.bombs.length === 0) return;
    const due = this.bombs.filter((b) => b.at <= now);
    if (due.length === 0) return;
    this.bombs = this.bombs.filter((b) => b.at > now);
    const units: Unit[] = [];
    this.state.units.forEach((u) => units.push(u));
    const structures: Structure[] = [];
    this.state.structures.forEach((st) => structures.push(st));
    for (const b of due) {
      const dmg = BOMB.damage * this.firepowerMult(b.owner);
      this.splash(b.owner, b.side, b.lane, b.x, BOMB.radius, dmg, BOMB.weapon, units, structures);
      this.emit("bomb", { lane: b.lane, x: b.x });
    }
  }

  // ================================================================ 陣亡、出局

  private removeDead() {
    const s = this.state;
    const deadUnits: Unit[] = [];
    s.units.forEach((u) => {
      if (u.hp <= 0) deadUnits.push(u);
    });
    for (const u of deadUnits) {
      this.reward(u.id, UNITS[u.type as UnitType].cost * BOUNTY_RATIO);
      const owner = s.players.get(u.owner);
      if (owner) owner.unitCount = Math.max(0, owner.unitCount - 1);
      s.units.delete(u.id);
      this.lastHit.delete(u.id);
    }

    const deadPlanes: Aircraft[] = [];
    s.aircraft.forEach((a) => {
      if (a.hp <= 0) deadPlanes.push(a);
    });
    for (const a of deadPlanes) {
      this.reward(a.id, AIRCRAFT[a.kind as AirKind].cost * BOUNTY_RATIO);
      this.emit("airDown", { x: a.x, y: a.y, angle: a.angle, kind: a.kind });
      s.aircraft.delete(a.id);
      this.lastHit.delete(a.id);
    }

    const deadStructures: Structure[] = [];
    s.structures.forEach((st) => {
      if (st.hp <= 0) deadStructures.push(st);
      else if (st.kind === "hq") this.checkHqAlert(st);
    });
    for (const st of deadStructures) {
      if (st.kind === "hq") {
        this.eliminate(st.side, this.lastHit.get(st.id) ?? "");
        if (s.phase !== "playing") return;
        continue;
      }
      this.reward(st.id, STRUCTURES[st.kind as BuildKind].cost * BOUNTY_RATIO);
      s.structures.delete(st.id);
      this.lastHit.delete(st.id);
    }
  }

  private checkHqAlert(hq: Structure) {
    const ratio = hq.hp / hq.maxHp;
    const level = ratio <= 0.25 ? 2 : ratio <= 0.5 ? 1 : 0;
    const prev = this.hqAlerted.get(hq.side) ?? 0;
    if (level > prev) {
      this.hqAlerted.set(hq.side, level);
      this.emit("hqAlert", { side: hq.side, level });
    }
  }

  private reward(targetId: string, amount: number) {
    const killer = this.lastHit.get(targetId);
    const p = killer ? this.state.players.get(killer) : undefined;
    if (!p || !p.alive) return;
    p.fundsExact += amount;
    p.kills += 1;
  }

  /** 某個指揮部被打爆：這個玩家出局，部隊和工事全部消失 */
  eliminate(node: number, killerId: string) {
    const s = this.state;
    const victim = this.playerAt(node);
    s.structures.delete(`hq${node}`);
    if (!victim || !victim.alive) return;
    victim.alive = false;
    victim.rank = this.aliveCount() + 1;

    const remove = <T extends { id: string; owner: string }>(map: { forEach: (cb: (v: T) => void) => void; delete: (k: string) => unknown }) => {
      const ids: string[] = [];
      map.forEach((v) => {
        if (v.owner === victim.id) ids.push(v.id);
      });
      for (const id of ids) map.delete(id);
    };
    remove<Unit>(s.units);
    remove<Structure>(s.structures);
    remove<Aircraft>(s.aircraft);
    victim.unitCount = 0;
    this.bombs = this.bombs.filter((b) => b.owner !== victim.id);

    const killer = s.players.get(killerId);
    if (killer && killer.alive) {
      killer.fundsExact += HQ_KILL_BOUNTY;
      killer.kills += 1;
    }
    this.emit("eliminated", {
      id: victim.id,
      name: victim.name,
      faction: victim.faction,
      by: killer && killer.alive ? killer.name : "",
    });

    const alive = this.alivePlayers();
    if (alive.length <= 1) {
      const w = alive[0];
      if (w) this.finish(w.id, `${FACTIONS[w.faction].name}殲滅了所有對手`);
      else this.finish(WINNER_DRAW, "同歸於盡");
    }
  }

  // ================================================================ 前線與勝負

  private updateFronts(dt: number) {
    const s = this.state;
    const laneCount = this.map.lanes.length;
    const leadFwd: number[] = new Array(laneCount).fill(-1); // 往 b 端走的部隊最前面的位置
    const leadBack: number[] = new Array(laneCount).fill(-1); // 往 a 端走的
    const now = s.time;
    s.units.forEach((u) => {
      if (u.landT > now) return;
      if (u.dir > 0) leadFwd[u.lane] = Math.max(leadFwd[u.lane], u.x);
      else leadBack[u.lane] = leadBack[u.lane] < 0 ? u.x : Math.min(leadBack[u.lane], u.x);
    });
    for (let lane = 0; lane < laneCount; lane++) {
      const a = leadFwd[lane];
      const b = leadBack[lane];
      const cur = s.fronts[lane];
      let target = cur;
      if (a >= 0 && b >= 0) target = (a + b) / 2;
      else if (a >= 0) target = Math.max(cur, a); // 只有一方在這條線：前線只會往前推
      else if (b >= 0) target = Math.min(cur, b);
      const maxMove = FRONT_SPEED * dt;
      const next = cur + Math.max(-maxMove, Math.min(maxMove, target - cur));
      if (Math.abs(next - cur) > 0.01) s.fronts[lane] = next;
    }
  }

  private endByTime() {
    const alive = this.alivePlayers();
    const score = (p: Player) => {
      const hq = this.state.structures.get(`hq${p.node}`);
      return { hp: hq ? hq.hp / hq.maxHp : 0, terr: this.territory(p.node) };
    };
    alive.sort((a, b) => {
      const sa = score(a);
      const sb = score(b);
      if (Math.abs(sa.hp - sb.hp) > 0.01) return sb.hp - sa.hp;
      return sb.terr - sa.terr;
    });
    alive.forEach((p, i) => (p.rank = i + 1));
    if (alive.length >= 2) {
      const s0 = score(alive[0]);
      const s1 = score(alive[1]);
      if (Math.abs(s0.hp - s1.hp) <= 0.01 && Math.abs(s0.terr - s1.terr) <= 0.01) {
        this.finish(WINNER_DRAW, "時間到：勢均力敵");
        return;
      }
      const reason = Math.abs(s0.hp - s1.hp) > 0.01 ? "時間到：指揮部剩餘血量最多" : "時間到：前線推進最遠";
      this.finish(alive[0].id, reason);
      return;
    }
    this.finish(alive[0]?.id ?? WINNER_DRAW, "時間到");
  }

  finish(winnerId: string, reason: string) {
    const s = this.state;
    const w = s.players.get(winnerId);
    if (w) w.rank = 1;
    s.winnerId = winnerId;
    s.endReason = reason;
    s.phase = "ended";
    this.bombs = [];
    this.emit("ended", { winnerId, reason });
  }

  // ================================================================ 小工具

  private addUnit(p: Player, type: UnitType, lane: number, x: number, dir: 1 | -1, landT: number) {
    const def = UNITS[type];
    const u = new Unit();
    u.id = `u${this.nextId++}`;
    u.type = type;
    u.owner = p.id;
    u.side = p.node;
    u.lane = lane;
    u.x = x;
    u.dir = dir;
    u.oy = Math.round((this.rng() - 0.5) * 22);
    u.hp = u.maxHp = def.hp * this.armorMult(p);
    u.cooldownLeft = this.rng() * 0.3;
    u.landT = landT;
    this.state.units.set(u.id, u);
    p.unitCount += 1;
    return u;
  }

  private pay(p: Player, cost: number) {
    p.fundsExact -= cost;
    p.funds = Math.floor(p.fundsExact);
    p.spent += cost;
  }

  private activePlayer(id: string): Player | null {
    if (this.state.phase !== "playing") return null;
    const p = this.state.players.get(id);
    if (!p || !p.alive || p.node < 0) return null;
    return p;
  }

  private ownLane(p: Player, lane: number) {
    if (!Number.isInteger(lane) || lane < 0 || lane >= this.map.lanes.length) return false;
    const g = this.map.lanes[lane];
    return g.a === p.node || g.b === p.node;
  }

  playerAt(node: number): Player | undefined {
    let found: Player | undefined;
    this.state.players.forEach((p) => {
      if (p.node === node) found = p;
    });
    return found;
  }

  isAlive(node: number) {
    const p = this.playerAt(node);
    return !!p && p.alive;
  }

  alivePlayers(): Player[] {
    const out: Player[] = [];
    this.state.players.forEach((p) => {
      if (p.alive && p.node >= 0) out.push(p);
    });
    return out;
  }

  private aliveCount() {
    return this.alivePlayers().length;
  }

  private firepowerMult(playerId: string) {
    const p = this.state.players.get(playerId);
    return 1 + (p ? p.firepower * FIREPOWER_PER_LEVEL : 0);
  }

  private armorMult(p: Player) {
    return 1 + p.armor * ARMOR_PER_LEVEL;
  }

  private cooldownMult(p: Player) {
    return 1 - p.logistics * LOGISTICS_COOLDOWN_PER_LEVEL;
  }
}
