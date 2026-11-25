// 對局模擬：伺服器每 tick 呼叫 step()，所有規則都在這裡。
// 這個類別不依賴網路，所以可以直接拿來寫測試或跑電腦對電腦。
//
// 地圖是「據點 + 道路」：每個玩家有一座大本營和幾座堡壘，另外有無主堡壘。
// 兵在據點裡買、駐紮（會回血、但要付養兵費），玩家選好兵種和數量後派到目的地，
// 一次派很多兵會依序間隔出門；派出去的部隊可以再調度、撤退、進駐別的據點。
// 堡壘被打到 0 血就變成無主，部隊在旁邊站滿 CAPTURE_TIME 秒就佔下來。
import {
  AIRCRAFT,
  AIR_KINDS,
  AIR_UNLOCK_TIME,
  ARMOR_PER_LEVEL,
  BASE_INCOME,
  BIG_FORT_INCOME,
  BOMB,
  BOUNTY_RATIO,
  BUILD_KINDS,
  BUILD_SLOTS,
  CAPTURE_GRACE,
  CAPTURE_HP,
  CAPTURE_RADIUS,
  CAPTURE_TIME,
  DAMAGE_TABLE,
  FACTIONS,
  FIREPOWER_PER_LEVEL,
  FORT_BREAK_BOUNTY,
  FORT_INCOME,
  GARRISON_CAP,
  GARRISON_FIRE_BONUS,
  GARRISON_FIRE_MAX,
  GARRISON_HEAL,
  HQ_KILL_BOUNTY,
  LEADER_FORT_BOUNTY_MULT,
  LEADER_KILL_BOUNTY_MULT,
  LOGISTICS_COOLDOWN_PER_LEVEL,
  LOGISTICS_INCOME_PER_LEVEL,
  MATCH_SECONDS,
  MAX_ORDER_UNITS,
  MAX_UPGRADE_LEVEL,
  PARA_LAND_TIME,
  PARA_SQUADS,
  POP_CAP,
  RELEASE_INTERVAL,
  RELEASE_ORDER,
  RETREAT_SPEED,
  SPAWN_OFFSET,
  START_FUNDS,
  STRUCTURES,
  UNITS,
  UNIT_TYPES,
  UPGRADES,
  UPGRADE_KINDS,
  WINNER_DRAW,
  WORLD_H,
  WORLD_W,
  buildMap,
  getMapDef,
  lanePoint,
  mapsFor,
  nearestNode,
  nodeDir,
  nodeEnd,
  planRoute,
  roadDistance,
  slotFits,
  upkeepFor,
  type AirKind,
  type ArmorClass,
  type BuildKind,
  type Dest,
  type MapLayout,
  type RoutePlan,
  type RouteStart,
  type StructureKind,
  type UnitType,
  type UpgradeKind,
  type WeaponClass,
} from "@frontline/shared";
import { Aircraft, MapNode, Player, Structure, Unit, type BattleState } from "./schema";

type EventSink = (type: string, payload: unknown) => void;

interface PendingBomb {
  owner: string;
  lane: number;
  x: number;
  at: number;
}

/** 攻擊目標：部隊、工事或據點 */
type Target =
  | { kind: "unit"; obj: Unit; lane: number; x: number }
  | { kind: "struct"; obj: Structure; lane: number; x: number }
  | { kind: "node"; obj: MapNode; index: number; lane: number; x: number };

const FRONT_SPEED = 80;
const START_GARRISON: [UnitType, number][] = [["rifle", 3]]; // 開局大本營裡的兵

/** 每 tick 先統計一次：每個據點裡的駐軍人口、每個玩家的總人口與駐軍人口 */
interface Tally {
  garrison: number[];
  pop: Map<string, number>;
  garrisonPop: Map<string, number>;
}

export class Battle {
  map: MapLayout = buildMap("fortress");
  private nextId = 1;
  private bombs: PendingBomb[] = [];
  private lastHit = new Map<string, string>(); // 目標 id → 最後打中它的玩家（算賞金）
  private hqAlerted = new Map<string, number>();
  private nextRelease = new Map<number, number>(); // 據點 → 下一支部隊可以出門的時間
  private tally: Tally = { garrison: [], pop: new Map(), garrisonPop: new Map() };

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

    // 地圖：大廳選的那張（人數要符合），不然隨機挑一張
    const options = mapsFor(n);
    let def = getMapDef(s.mapChoice);
    if (!def || !options.includes(def)) def = options[Math.floor(this.rng() * options.length)] ?? options[0];
    this.map = buildMap(def.id);
    s.mapId = def.id;
    const slots = def.slotOrder[n] ?? def.slotOrder[Math.max(...Object.keys(def.slotOrder).map(Number))];
    const slotPlayer = new Map<number, Player>();
    players.forEach((p, i) => slotPlayer.set(slots[i], p));

    s.units.clear();
    s.structures.clear();
    s.aircraft.clear();
    s.nodes.clear();
    s.fronts.clear();
    this.bombs = [];
    this.lastHit.clear();
    this.hqAlerted.clear();
    this.nextRelease.clear();
    this.nextId = 1;
    s.leaderId = "";

    this.map.nodes.forEach((nd) => {
      const owner = nd.slot >= 0 ? slotPlayer.get(nd.slot) : undefined;
      const node = new MapNode();
      // 沒人用的大本營變成無主的大型堡壘
      node.kind = nd.kind === "hq" ? (owner ? "hq" : "bigfort") : nd.big ? "bigfort" : "fort";
      node.maxHp = STRUCTURES[node.kind as StructureKind].hp;
      node.owner = owner?.id ?? "";
      node.faction = owner ? owner.faction : -1;
      node.hp = owner ? node.maxHp : 0;
      s.nodes.push(node);
      if (owner && nd.kind === "hq") owner.hq = nd.index;
    });
    for (const lane of this.map.lanes) s.fronts.push(lane.len / 2);

    for (const p of players) {
      p.alive = true;
      p.rank = 0;
      p.fundsExact = START_FUNDS;
      p.funds = START_FUNDS;
      p.firepower = p.armor = p.logistics = 0;
      p.airReady.clear();
      for (let i = 0; i < AIR_KINDS.length; i++) p.airReady.push(AIR_UNLOCK_TIME);
      p.pop = 0;
      p.upkeep = 0;
      p.income = 0;
      p.kills = p.deployed = p.spent = p.captures = 0;
      for (const [type, n] of START_GARRISON) for (let i = 0; i < n; i++) this.addUnit(p, type, { node: p.hq });
    }
    this.countForts();
    this.updateTally();

    s.time = 0;
    s.duration = duration;
    s.winnerId = "";
    s.endReason = "";
    s.phase = "playing";
  }

  // ================================================================ 玩家指令
  // 成功回傳 null，失敗回傳給玩家看的錯誤訊息

  /** 在自己的據點買兵，買了先駐紮在裡面 */
  buy(playerId: string, node: number, type: UnitType, count = 1): string | null {
    const p = this.activePlayer(playerId);
    if (!p) return "現在不能下指令";
    if (!UNIT_TYPES.includes(type)) return "沒有這個兵種";
    if (!this.owns(playerId, node)) return "只能在自己的據點買兵";
    const def = UNITS[type];
    const want = Math.max(1, Math.min(10, Math.floor(Number(count) || 1)));
    this.updateTally();
    const n = this.state.nodes[node];
    const room = Math.floor((this.garrisonCap(n.kind) - (this.tally.garrison[node] ?? 0)) / def.pop);
    const popRoom = Math.floor((POP_CAP - (this.tally.pop.get(p.id) ?? 0)) / def.pop);
    const afford = Math.floor(p.fundsExact / def.cost);
    const k = Math.min(want, room, popRoom, afford);
    if (k <= 0) {
      if (room <= 0) return "這座據點住滿了，先把兵派出去";
      if (popRoom <= 0) return `兵力已達上限 ${POP_CAP}`;
      return "軍費不足";
    }
    for (let i = 0; i < k; i++) this.addUnit(p, type, { node });
    this.pay(p, def.cost * k);
    p.deployed += k;
    this.updateTally();
    return null;
  }

  /**
   * 從據點派兵：counts 依 UNIT_TYPES 順序，全部是 0 代表全部派出。
   * 部隊依 RELEASE_ORDER 排隊、每隔 RELEASE_INTERVAL 秒出門一支。
   */
  dispatch(playerId: string, node: number, counts: number[], via: number[], dest: Dest, enter: boolean): string | null {
    const p = this.activePlayer(playerId);
    if (!p) return "現在不能下指令";
    if (!this.owns(playerId, node)) return "只能從自己的據點派兵";
    const inside: Unit[] = [];
    this.state.units.forEach((u) => {
      if (u.owner === playerId && u.inNode === node && u.departAt === 0 && u.hp > 0) inside.push(u);
    });
    if (inside.length === 0) return "這座據點裡沒有兵，先買兵";
    const want = UNIT_TYPES.map((_, i) => Math.max(0, Math.floor(Number(counts?.[i]) || 0)));
    const all = want.every((c) => c === 0);
    // 同兵種先派血多的
    inside.sort((a, b) => b.hp / b.maxHp - a.hp / a.maxHp);
    const picked: Unit[] = [];
    for (const u of inside) {
      const i = UNIT_TYPES.indexOf(u.type as UnitType);
      if (all || (i >= 0 && want[i] > 0)) {
        picked.push(u);
        if (!all) want[i] -= 1;
      }
      if (picked.length >= MAX_ORDER_UNITS) break;
    }
    if (picked.length === 0) return "選的兵種在這座據點裡沒有";
    const plan = planRoute(this.map, { node }, this.cleanVia(via), dest);
    if (!plan) return "走不到那裡";
    if (plan.lanes.length === 0) return "目的地就是這座據點";
    const group = `g${this.nextId++}`;
    picked.sort((a, b) => RELEASE_ORDER.indexOf(a.type as UnitType) - RELEASE_ORDER.indexOf(b.type as UnitType));
    // departAt = 0 代表「沒有要出門」，所以至少從 0.05 秒後開始排
    let at = Math.max(this.state.time + 0.05, this.nextRelease.get(node) ?? 0);
    for (const u of picked) {
      this.setOrder(u, plan, dest, !!enter, group, "move");
      u.departAt = at;
      at += RELEASE_INTERVAL;
    }
    this.nextRelease.set(node, at);
    return null;
  }

  /** 調度野外（或正在排隊出門）的部隊：改目的地 */
  order(playerId: string, unitIds: string[], via: number[], dest: Dest, enter: boolean): string | null {
    const p = this.activePlayer(playerId);
    if (!p) return "現在不能下指令";
    const units = this.ownUnits(playerId, unitIds);
    if (units.length === 0) return "沒有選到部隊";
    const cleanVia = this.cleanVia(via);
    const group = `g${this.nextId++}`;
    let ok = 0;
    for (const u of units) {
      const plan = planRoute(this.map, this.startOf(u), cleanVia, dest);
      if (!plan) continue;
      if (u.inNode >= 0 && plan.lanes.length === 0) continue;
      this.setOrder(u, plan, dest, !!enter, group, "move");
      ok += 1;
    }
    return ok > 0 ? null : "走不到那裡";
  }

  /** 撤退：回到最近的自己據點並進駐（撤退途中不會開火，跑得比較快） */
  retreat(playerId: string, unitIds: string[]): string | null {
    const p = this.activePlayer(playerId);
    if (!p) return "現在不能下指令";
    const units = this.ownUnits(playerId, unitIds).filter((u) => u.inNode < 0);
    if (units.length === 0) return "沒有選到野外的部隊";
    const group = `g${this.nextId++}`;
    let ok = 0;
    for (const u of units) {
      const start = this.startOf(u);
      const home = nearestNode(this.map, start, (n) => this.owns(playerId, n));
      if (home < 0) continue;
      const dest = { node: home };
      const plan = planRoute(this.map, start, [], dest);
      if (!plan) continue;
      this.setOrder(u, plan, dest, true, group, "retreat");
      ok += 1;
    }
    return ok > 0 ? null : "沒有可以撤退的據點";
  }

  private ownUnits(playerId: string, ids: string[]): Unit[] {
    const out: Unit[] = [];
    if (!Array.isArray(ids)) return out;
    for (const id of ids.slice(0, MAX_ORDER_UNITS)) {
      const u = typeof id === "string" ? this.state.units.get(id) : undefined;
      if (!u || u.owner !== playerId || u.hp <= 0 || u.landT > this.state.time) continue;
      if (u.inNode >= 0 && u.departAt === 0) continue; // 駐軍要從據點派
      out.push(u);
    }
    return out;
  }

  private cleanVia(via: unknown): number[] {
    if (!Array.isArray(via)) return [];
    return via.slice(0, 12).filter((v): v is number => Number.isInteger(v) && v >= 0 && v < this.map.nodes.length);
  }

  private startOf(u: Unit): RouteStart {
    return u.inNode >= 0 ? { node: u.inNode } : { lane: u.lane, x: u.x };
  }

  private setOrder(u: Unit, plan: RoutePlan, dest: Dest, enter: boolean, group: string, mode: "move" | "retreat") {
    u.route.clear();
    for (const li of plan.lanes) u.route.push(li);
    if (u.inNode < 0 && plan.dir !== 0) u.dir = plan.dir;
    if ("node" in dest) {
      u.destNode = dest.node;
      u.destLane = -1;
      u.destX = 0;
    } else {
      u.destNode = -1;
      u.destLane = dest.lane;
      u.destX = Math.max(0, Math.min(this.map.lanes[dest.lane].len, dest.x));
    }
    u.enter = enter;
    u.group = group;
    u.mode = mode;
    u.attacking = false;
  }

  build(playerId: string, lane: number, node: number, slot: number, kind: BuildKind): string | null {
    const p = this.activePlayer(playerId);
    if (!p) return "現在不能下指令";
    if (!this.validLane(lane)) return "路線錯誤";
    const geom = this.map.lanes[lane];
    if (geom.a !== node && geom.b !== node) return "這條路沒有連到那個據點";
    if (!this.owns(playerId, node)) return "只能蓋在自己的據點旁邊";
    if (!Number.isInteger(slot) || !this.slotFits(lane, slot)) return "這裡沒有工事格";
    if (!BUILD_KINDS.includes(kind)) return "沒有這種工事";
    const id = `s${lane}_${node}_${slot}`;
    if (this.state.structures.has(id)) return "這格已經有工事了";
    const def = STRUCTURES[kind];
    if (p.fundsExact < def.cost) return "軍費不足";

    const st = new Structure();
    st.id = id;
    st.kind = kind;
    st.owner = p.id;
    st.faction = p.faction;
    st.lane = lane;
    st.node = node;
    st.slot = slot;
    st.x = nodeEnd(geom, node) + nodeDir(geom, node) * BUILD_SLOTS[slot];
    st.hp = st.maxHp = def.hp * this.armorMult(p);
    this.state.structures.set(id, st);
    this.pay(p, def.cost);
    return null;
  }

  /** 這條路的這一格放得下工事嗎（太短的路只有第一格） */
  slotFits(lane: number, slot: number) {
    return slotFits(this.map.lanes[lane].len, slot);
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
    if (kind === "armor") {
      const ratio = this.armorMult(p) / before;
      const scale = (t: Unit | Structure) => {
        if (t.owner !== p.id) return;
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
    if (!this.validLane(lane)) return "路線錯誤";
    if (typeof x !== "number" || !Number.isFinite(x)) return "位置錯誤";
    const def = AIRCRAFT[kind];
    if (this.state.time < (p.airReady[idx] ?? 0)) {
      return this.state.time < AIR_UNLOCK_TIME ? `空軍 ${AIR_UNLOCK_TIME} 秒後才能出動` : `${def.name}還在整備中`;
    }
    if (p.fundsExact < def.cost) return "軍費不足";

    const geom = this.map.lanes[lane];
    const tx = Math.max(20, Math.min(geom.len - 20, x));
    const home = this.map.nodes[p.hq];
    const target = lanePoint(geom, tx);
    const a = new Aircraft();
    a.id = `a${this.nextId++}`;
    a.kind = kind;
    a.owner = p.id;
    a.faction = p.faction;
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
    this.emit("airIncoming", { owner: p.id, faction: p.faction, kind, lane, x: tx });
    return null;
  }

  // ================================================================ 每 tick

  step(dt: number) {
    const s = this.state;
    if (s.phase !== "playing") return;
    s.time += dt;

    this.updateTally();
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
    for (let i = 0; i < s.nodes.length; i++) this.updateNode(i, units, planes, dt);

    this.removeDead();
    if (s.phase !== "playing") return;
    this.countForts();

    this.updateFronts(dt);
    if (s.time >= s.duration) this.endByTime();
  }

  // ================================================================ 經濟

  private updateIncome(dt: number) {
    const now = this.state.time;
    const bonus = new Map<string, number>();
    this.state.nodes.forEach((n) => {
      if (!n.owner || n.hp <= 0 || n.kind === "hq" || now < n.incomeAt) return;
      bonus.set(n.owner, (bonus.get(n.owner) ?? 0) + (n.kind === "bigfort" ? BIG_FORT_INCOME : FORT_INCOME));
    });
    this.state.players.forEach((p) => {
      if (!p.alive) {
        if (p.income !== 0) p.income = 0;
        if (p.upkeep !== 0) p.upkeep = 0;
        return;
      }
      const income = BASE_INCOME + (bonus.get(p.id) ?? 0) + p.logistics * LOGISTICS_INCOME_PER_LEVEL;
      const upkeep = upkeepFor(this.tally.garrisonPop.get(p.id) ?? 0);
      p.fundsExact = Math.max(0, p.fundsExact + (income - upkeep) * dt);
      p.funds = Math.floor(p.fundsExact);
      const shown = Math.round(income * 10) / 10;
      if (p.income !== shown) p.income = shown;
      const up = Math.round(upkeep * 10) / 10;
      if (p.upkeep !== up) p.upkeep = up;
    });
  }

  private updateTally() {
    const t: Tally = { garrison: new Array(this.state.nodes.length).fill(0), pop: new Map(), garrisonPop: new Map() };
    this.state.units.forEach((u) => {
      if (u.hp <= 0) return;
      const pop = UNITS[u.type as UnitType].pop;
      t.pop.set(u.owner, (t.pop.get(u.owner) ?? 0) + pop);
      if (u.inNode >= 0) {
        t.garrison[u.inNode] += pop;
        t.garrisonPop.set(u.owner, (t.garrisonPop.get(u.owner) ?? 0) + pop);
      }
    });
    this.tally = t;
    this.state.players.forEach((p) => {
      const v = Math.min(255, t.pop.get(p.id) ?? 0);
      if (p.pop !== v) p.pop = v;
    });
  }

  garrisonCap(kind: string) {
    return GARRISON_CAP[kind] ?? GARRISON_CAP.fort;
  }

  /** 某個據點裡的駐軍人口 */
  garrisonAt(node: number) {
    return this.tally.garrison[node] ?? 0;
  }

  private countForts() {
    const counts = new Map<string, number>();
    this.state.nodes.forEach((n) => {
      if (n.owner && n.hp > 0) counts.set(n.owner, (counts.get(n.owner) ?? 0) + 1);
    });
    this.state.players.forEach((p) => {
      const c = counts.get(p.id) ?? 0;
      if (p.forts !== c) p.forts = c;
    });
    // 領先者懸賞：堡壘數唯一最多的人
    const alive = this.alivePlayers().sort((a, b) => b.forts - a.forts);
    const leader = alive.length >= 2 && alive[0].forts > alive[1].forts ? alive[0] : undefined;
    const id = leader?.id ?? "";
    if (this.state.leaderId !== id) {
      this.state.leaderId = id;
      this.emit("leader", { id, faction: leader?.faction ?? -1 });
    }
  }

  // ================================================================ 部隊

  private updateUnit(u: Unit, units: Unit[], structures: Structure[], dt: number) {
    if (u.hp <= 0) return;
    const def = UNITS[u.type as UnitType];
    const now = this.state.time;

    // 駐軍：回血；工兵順便修據點；輪到就出門
    if (u.inNode >= 0) {
      if (u.hp < u.maxHp) u.hp = Math.min(u.maxHp, u.hp + u.maxHp * GARRISON_HEAL * dt);
      const n = this.state.nodes[u.inNode];
      if (def.repair && n && n.owner === u.owner && n.hp > 0 && n.hp < n.maxHp) n.hp = Math.min(n.maxHp, n.hp + def.repair * 0.6 * dt);
      if (u.departAt > 0 && now >= u.departAt) this.depart(u);
      return;
    }
    if (u.landT > now) return;
    u.cooldownLeft = Math.max(0, u.cooldownLeft - dt);

    if (u.mode !== "retreat") {
      if (def.heal) {
        this.medicAct(u, def, units, dt);
        // 醫療兵不衝進火線：前方有敵人就停下來
        if (this.findTarget(u, units, structures, def.range + 40)) {
          if (!u.attacking) u.attacking = true;
          return;
        }
      } else if (def.repair) {
        if (this.engineerAct(u, def, units, structures, dt)) return;
      } else {
        const target = this.findTarget(u, units, structures, def.range);
        if (target) {
          this.fireAt(u, def, target, units, structures);
          return;
        }
      }
    }

    if (u.attacking) u.attacking = false;
    if (u.mode === "hold") {
      this.tryEnterDest(u);
      return;
    }
    this.move(u, def.speed * (u.mode === "retreat" ? RETREAT_SPEED : 1) * dt);
  }

  private fireAt(u: Unit, def: (typeof UNITS)[UnitType], target: Target, units: Unit[], structures: Structure[]) {
    if (!u.attacking) u.attacking = true;
    if (u.cooldownLeft > 0) return;
    u.cooldownLeft = def.cooldown;
    const dmg = def.damage * this.firepowerMult(u.owner);
    if (def.splash) this.splash(u.owner, target.lane, target.x, def.splash, dmg, def.weapon, units, structures);
    else this.hitTarget(u.owner, target, dmg, def.weapon);
    u.tl = target.lane;
    u.tx = target.x;
    u.shots = (u.shots + 1) % 256;
  }

  /** 醫療兵：幫範圍內血最少的幾個步兵類友軍回血 */
  private medicAct(u: Unit, def: (typeof UNITS)[UnitType], units: Unit[], dt: number) {
    const now = this.state.time;
    const hurt: { e: Unit; r: number }[] = [];
    for (const e of units) {
      if (e.owner !== u.owner || e.hp <= 0 || e.inNode >= 0 || e.landT > now || e.hp >= e.maxHp) continue;
      if (UNITS[e.type as UnitType].armor !== "soft") continue;
      if (roadDistance(this.map, u.lane, u.x, e.lane, e.x) > def.range) continue;
      hurt.push({ e, r: e.hp / e.maxHp });
    }
    if (hurt.length === 0) return;
    hurt.sort((a, b) => a.r - b.r);
    const amount = (def.heal ?? 0) * this.firepowerMult(u.owner) * dt;
    for (const { e } of hurt.slice(0, def.healTargets ?? 1)) e.hp = Math.min(e.maxHp, e.hp + amount);
    // 每隔一段時間通知畫面放治療特效
    if (u.cooldownLeft <= 0) {
      u.cooldownLeft = 0.8;
      u.tl = hurt[0].e.lane;
      u.tx = hurt[0].e.x;
      u.shots = (u.shots + 1) % 256;
    }
  }

  /** 工兵：先爆破旁邊的敵方建築，其次修理己方據點、工事、戰車，最後才打步兵。回傳 true = 這格不移動 */
  private engineerAct(u: Unit, def: (typeof UNITS)[UnitType], units: Unit[], structures: Structure[], dt: number): boolean {
    const demo = this.findTarget(u, units, structures, def.range, true);
    if (demo) {
      this.fireAt(u, def, demo, units, structures);
      return true;
    }
    const fix = this.repairTarget(u, units, structures, def.range + 20);
    if (fix) {
      if (u.attacking) u.attacking = false;
      fix.obj.hp = Math.min(fix.obj.maxHp, fix.obj.hp + (def.repair ?? 0) * dt);
      if (u.cooldownLeft <= 0) {
        u.cooldownLeft = 0.7;
        u.tl = fix.lane;
        u.tx = fix.x;
        u.shots = (u.shots + 1) % 256;
      }
      return true;
    }
    const target = this.findTarget(u, units, structures, def.range);
    if (target) {
      this.fireAt(u, def, target, units, structures);
      return true;
    }
    return false;
  }

  private repairTarget(u: Unit, units: Unit[], structures: Structure[], range: number): { obj: { hp: number; maxHp: number }; lane: number; x: number } | null {
    const geom = this.map.lanes[u.lane];
    for (const ni of [geom.a, geom.b]) {
      const n = this.state.nodes[ni];
      if (n.owner !== u.owner || n.hp <= 0 || n.hp >= n.maxHp) continue;
      const x = nodeEnd(geom, ni);
      if (Math.abs(u.x - x) <= range) return { obj: n, lane: u.lane, x };
    }
    for (const st of structures) {
      if (st.owner !== u.owner || st.hp <= 0 || st.hp >= st.maxHp) continue;
      if (roadDistance(this.map, u.lane, u.x, st.lane, st.x) <= range) return { obj: st, lane: st.lane, x: st.x };
    }
    for (const e of units) {
      if (e.owner !== u.owner || e.type !== "tank" || e.inNode >= 0 || e.hp <= 0 || e.hp >= e.maxHp) continue;
      if (roadDistance(this.map, u.lane, u.x, e.lane, e.x) <= range) return { obj: e, lane: e.lane, x: e.x };
    }
    return null;
  }

  /** 沿著規劃好的路走；到了路上的目的地就駐守 */
  private move(u: Unit, step: number) {
    const geom = this.map.lanes[u.lane];
    if (u.route.length === 0 && u.destNode < 0 && u.destLane === u.lane) {
      const d = u.destX - u.x;
      if (Math.abs(d) <= step) {
        u.x = u.destX;
        u.mode = "hold";
        return;
      }
      u.dir = d > 0 ? 1 : -1;
      u.x += u.dir * step;
      return;
    }
    const nx = u.x + u.dir * step;
    if ((u.dir > 0 && nx >= geom.len) || (u.dir < 0 && nx <= 0)) this.arrive(u, u.dir > 0 ? geom.b : geom.a);
    else u.x = nx;
  }

  /** 走到路的盡頭（一個據點） */
  private arrive(u: Unit, node: number) {
    const geom = this.map.lanes[u.lane];
    u.x = nodeEnd(geom, node);
    const n = this.state.nodes[node];
    if (u.route.length > 0) {
      // 敵方據點擋路：先打下來才能過（findTarget 會讓部隊停下來打）
      if (n.owner && n.owner !== u.owner && n.hp > 0) return;
      const next = u.route.shift()!;
      const ng = this.map.lanes[next];
      if (!ng || (ng.a !== node && ng.b !== node)) {
        u.route.clear();
        u.mode = "hold";
        return;
      }
      u.lane = next;
      u.dir = nodeDir(ng, node);
      u.x = nodeEnd(ng, node);
      return;
    }
    u.mode = "hold";
    if (u.destNode < 0) {
      u.destNode = node; // 目的地本來在路上但走過頭了：就守在這個據點
      u.enter = false;
    }
    this.tryEnterDest(u);
  }

  /** 部隊已經守在目的地據點旁邊：據點是自己的、而且要進駐，就進去 */
  private tryEnterDest(u: Unit) {
    if (u.destNode < 0 || !(u.enter || u.mode === "retreat")) return;
    if (!this.owns(u.owner, u.destNode)) return;
    const geom = this.map.lanes[u.lane];
    if (geom.a !== u.destNode && geom.b !== u.destNode) return;
    if (Math.abs(u.x - nodeEnd(geom, u.destNode)) > CAPTURE_RADIUS) return;
    const n = this.state.nodes[u.destNode];
    const pop = UNITS[u.type as UnitType].pop;
    if ((this.tally.garrison[u.destNode] ?? 0) + pop > this.garrisonCap(n.kind)) return; // 住滿了就在外面守
    this.tally.garrison[u.destNode] += pop;
    this.tally.garrisonPop.set(u.owner, (this.tally.garrisonPop.get(u.owner) ?? 0) + pop);
    u.inNode = u.destNode;
    u.mode = "hold";
    u.attacking = false;
    u.route.clear();
    u.departAt = 0;
    u.group = "";
  }

  /** 排隊出門的駐軍輪到了：走上第一條路 */
  private depart(u: Unit) {
    const node = u.inNode;
    u.departAt = 0;
    if (u.route.length === 0) return;
    const next = u.route.shift()!;
    const geom = this.map.lanes[next];
    if (!geom || (geom.a !== node && geom.b !== node)) {
      u.route.clear();
      return;
    }
    u.inNode = -1;
    u.lane = next;
    u.dir = nodeDir(geom, node);
    u.x = nodeEnd(geom, node) + u.dir * Math.min(SPAWN_OFFSET, geom.len / 2);
    u.oy = Math.round((this.rng() - 0.5) * 20);
    if (u.mode === "hold") u.mode = "move";
  }

  /** 據點被攻破：裡面的兵全部衝出來守在門口 */
  private eject(node: number) {
    const lanes = this.map.adj[node];
    if (lanes.length === 0) return;
    let k = 0;
    this.state.units.forEach((u) => {
      if (u.inNode !== node || u.hp <= 0) return;
      if (u.departAt > 0 && u.route.length > 0) {
        this.depart(u);
        return;
      }
      const li = lanes[k % lanes.length];
      const geom = this.map.lanes[li];
      u.inNode = -1;
      u.departAt = 0;
      u.lane = li;
      u.dir = nodeDir(geom, node);
      u.x = nodeEnd(geom, node) + u.dir * (12 + Math.floor(k / lanes.length) * 8);
      u.route.clear();
      u.mode = "hold";
      u.destNode = node;
      u.destLane = -1;
      u.enter = true;
      u.group = `e${node}_${this.nextId}`;
      k += 1;
    });
    this.nextId += 1;
    this.nextRelease.delete(node);
  }

  private findTarget(u: Unit, units: Unit[], structures: Structure[], range: number, buildingsOnly = false): Target | null {
    let best: Target | null = null;
    let bestD = range;
    const now = this.state.time;
    for (const e of buildingsOnly ? [] : units) {
      if (e.owner === u.owner || e.hp <= 0 || e.landT > now || e.inNode >= 0) continue;
      const d = roadDistance(this.map, u.lane, u.x, e.lane, e.x);
      if (d <= bestD) {
        bestD = d;
        best = { kind: "unit", obj: e, lane: e.lane, x: e.x };
      }
    }
    for (const st of structures) {
      if (st.owner === u.owner || st.hp <= 0) continue;
      const d = roadDistance(this.map, u.lane, u.x, st.lane, st.x);
      if (d <= bestD) {
        bestD = d;
        best = { kind: "struct", obj: st, lane: st.lane, x: st.x };
      }
    }
    const geom = this.map.lanes[u.lane];
    for (const ni of [geom.a, geom.b]) {
      const n = this.state.nodes[ni];
      if (!n.owner || n.owner === u.owner || n.hp <= 0) continue;
      const x = nodeEnd(geom, ni);
      const d = Math.abs(u.x - x);
      if (d <= bestD) {
        bestD = d;
        best = { kind: "node", obj: n, index: ni, lane: u.lane, x };
      }
    }
    return best;
  }

  private armorOf(t: Target): ArmorClass {
    if (t.kind === "unit") return UNITS[t.obj.type as UnitType].armor;
    return "building";
  }

  private hitTarget(attacker: string, t: Target, damage: number, weapon: WeaponClass) {
    t.obj.hp -= damage * DAMAGE_TABLE[weapon][this.armorOf(t)];
    this.lastHit.set(t.kind === "node" ? `n${t.index}` : t.obj.id, attacker);
  }

  /** 範圍傷害：沿路距離 radius 以內所有「不是攻擊者的」東西 */
  private splash(attacker: string, lane: number, x: number, radius: number, damage: number, weapon: WeaponClass, units: Unit[], structures: Structure[]) {
    const now = this.state.time;
    for (const e of units) {
      if (e.owner === attacker || e.hp <= 0 || e.landT > now || e.inNode >= 0) continue;
      if (roadDistance(this.map, lane, x, e.lane, e.x) <= radius) this.hitTarget(attacker, { kind: "unit", obj: e, lane: e.lane, x: e.x }, damage, weapon);
    }
    for (const st of structures) {
      if (st.owner === attacker || st.hp <= 0) continue;
      if (roadDistance(this.map, lane, x, st.lane, st.x) <= radius) this.hitTarget(attacker, { kind: "struct", obj: st, lane: st.lane, x: st.x }, damage, weapon);
    }
    const geom = this.map.lanes[lane];
    for (const ni of [geom.a, geom.b]) {
      const n = this.state.nodes[ni];
      if (!n.owner || n.owner === attacker || n.hp <= 0) continue;
      const nx = nodeEnd(geom, ni);
      if (Math.abs(x - nx) <= radius + 20) this.hitTarget(attacker, { kind: "node", obj: n, index: ni, lane, x: nx }, damage, weapon);
    }
  }

  // ================================================================ 工事與據點

  private updateStructure(st: Structure, units: Unit[], planes: Aircraft[], dt: number) {
    if (st.hp <= 0) return;
    const def = STRUCTURES[st.kind as StructureKind];
    const mult = this.firepowerMult(st.owner);
    if (def.damage > 0) {
      st.cooldownLeft = Math.max(0, st.cooldownLeft - dt);
      if (st.cooldownLeft <= 0) {
        const t = this.nearestEnemyUnit(st.owner, units, (e) => roadDistance(this.map, st.lane, st.x, e.lane, e.x), def.range);
        if (t) {
          st.cooldownLeft = def.cooldown;
          this.hitTarget(st.owner, { kind: "unit", obj: t, lane: t.lane, x: t.x }, def.damage * mult, def.weapon);
          st.tl = t.lane;
          st.tx = t.x;
          st.shots = (st.shots + 1) % 256;
        }
      }
    }
    if (def.airDamage > 0) {
      st.airCooldownLeft = Math.max(0, st.airCooldownLeft - dt);
      if (st.airCooldownLeft <= 0) {
        const pos = lanePoint(this.map.lanes[st.lane], st.x);
        const a = this.nearestEnemyPlane(st.owner, planes, pos.x, pos.y, def.airRange);
        if (a) {
          st.airCooldownLeft = def.airCooldown;
          a.hp -= def.airDamage * mult;
          this.lastHit.set(a.id, st.owner);
          st.ax = a.x;
          st.ay = a.y;
          st.airShots = (st.airShots + 1) % 256;
        }
      }
    }
  }

  private updateNode(index: number, units: Unit[], planes: Aircraft[], dt: number) {
    const n = this.state.nodes[index];
    const lanes = this.map.adj[index];
    const distTo = (e: Unit) => (lanes.includes(e.lane) ? Math.abs(e.x - nodeEnd(this.map.lanes[e.lane], index)) : Infinity);

    if (n.owner && n.hp > 0) {
      const def = STRUCTURES[n.kind as StructureKind];
      const mult = this.firepowerMult(n.owner) * (1 + Math.min(GARRISON_FIRE_MAX, (this.tally.garrison[index] ?? 0) * GARRISON_FIRE_BONUS));
      n.cooldownLeft = Math.max(0, n.cooldownLeft - dt);
      if (n.cooldownLeft <= 0) {
        const t = this.nearestEnemyUnit(n.owner, units, distTo, def.range);
        if (t) {
          n.cooldownLeft = def.cooldown;
          this.hitTarget(n.owner, { kind: "unit", obj: t, lane: t.lane, x: t.x }, def.damage * mult, def.weapon);
          n.tl = t.lane;
          n.tx = t.x;
          n.shots = (n.shots + 1) % 256;
        }
      }
      n.airCooldownLeft = Math.max(0, n.airCooldownLeft - dt);
      if (n.airCooldownLeft <= 0) {
        const pos = this.map.nodes[index];
        const a = this.nearestEnemyPlane(n.owner, planes, pos.x, pos.y, def.airRange);
        if (a) {
          n.airCooldownLeft = def.airCooldown;
          a.hp -= def.airDamage * mult;
          this.lastHit.set(a.id, n.owner);
          n.ax = a.x;
          n.ay = a.y;
          n.airShots = (n.airShots + 1) % 256;
        }
      }
      return;
    }

    // 無主據點：只有一方的部隊在旁邊時，佔領進度往上加
    const present = new Set<string>();
    const now = this.state.time;
    for (const e of units) {
      if (e.hp <= 0 || e.landT > now || e.inNode >= 0) continue;
      if (distTo(e) <= CAPTURE_RADIUS) present.add(e.owner);
    }
    if (present.size === 1) {
      const pid = [...present][0];
      if (n.capturer !== pid) {
        n.capturer = pid;
        n.capFaction = this.state.players.get(pid)?.faction ?? -1;
        n.progress = 0;
      }
      n.progress = Math.min(1, n.progress + dt / CAPTURE_TIME);
      if (n.progress >= 1) this.capture(index, pid);
    } else if (present.size === 0 && n.progress > 0) {
      n.progress = Math.max(0, n.progress - dt / (CAPTURE_TIME * 2));
      if (n.progress === 0) {
        n.capturer = "";
        n.capFaction = -1;
      }
    }
  }

  private capture(index: number, pid: string) {
    const n = this.state.nodes[index];
    const p = this.state.players.get(pid);
    if (!p || !p.alive) return;
    n.owner = pid;
    n.faction = p.faction;
    n.hp = n.maxHp * CAPTURE_HP;
    n.capturer = "";
    n.capFaction = -1;
    n.progress = 0;
    n.cooldownLeft = 0.5;
    n.incomeAt = this.state.time + CAPTURE_GRACE;
    p.captures += 1;
    this.countForts();
    this.emit("captured", { node: index, by: pid, faction: p.faction });
  }

  private nearestEnemyUnit(owner: string, units: Unit[], dist: (u: Unit) => number, range: number): Unit | null {
    let best: Unit | null = null;
    let bestD = range;
    const now = this.state.time;
    for (const e of units) {
      if (e.owner === owner || e.hp <= 0 || e.landT > now || e.inNode >= 0) continue;
      const d = dist(e);
      if (d <= bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  private nearestEnemyPlane(owner: string, planes: Aircraft[], x: number, y: number, range: number): Aircraft | null {
    let best: Aircraft | null = null;
    let bestD = range;
    for (const a of planes) {
      if (a.owner === owner || a.hp <= 0) continue;
      const d = Math.hypot(a.x - x, a.y - y);
      if (d <= bestD) {
        bestD = d;
        best = a;
      }
    }
    return best;
  }

  // ================================================================ 空軍

  private updateAircraft(a: Aircraft, dt: number) {
    if (a.hp <= 0) return;
    const step = AIRCRAFT[a.kind as AirKind].speed * dt;
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
        this.bombs.push({ owner: a.owner, lane: a.lane, x: a.tx + offset, at: now + 0.25 + i * BOMB.interval });
      }
      return;
    }
    const p = this.state.players.get(a.owner);
    if (!p || !p.alive) return;
    const dir = this.paraDirection(a.owner, a.lane, a.tx);
    const len = this.map.lanes[a.lane].len;
    const geom = this.map.lanes[a.lane];
    const target = dir > 0 ? geom.b : geom.a;
    const group = `p${this.nextId++}`;
    for (let i = 0; i < PARA_SQUADS; i++) {
      if ((this.tally.pop.get(p.id) ?? 0) + UNITS.para.pop > POP_CAP) break;
      const x = Math.max(0, Math.min(len, a.tx + (i - (PARA_SQUADS - 1) / 2) * 22));
      const u = this.addUnit(p, "para", { lane: a.lane, x }, now + PARA_LAND_TIME + i * 0.2);
      u.dir = dir;
      u.destNode = target;
      u.enter = true;
      u.group = group;
      this.tally.pop.set(p.id, (this.tally.pop.get(p.id) ?? 0) + UNITS.para.pop);
    }
    this.emit("paradrop", { lane: a.lane, x: a.tx, faction: p.faction });
  }

  /** 空降兵落地後往比較近的「不是自己的」據點打 */
  private paraDirection(owner: string, lane: number, x: number): 1 | -1 {
    const geom = this.map.lanes[lane];
    const a = !this.owns(owner, geom.a);
    const b = !this.owns(owner, geom.b);
    if (a && b) return x < geom.len / 2 ? -1 : 1;
    if (a) return -1;
    if (b) return 1;
    return x < geom.len / 2 ? -1 : 1;
  }

  private resolveBombs() {
    if (this.bombs.length === 0) return;
    const now = this.state.time;
    const due = this.bombs.filter((b) => b.at <= now);
    if (due.length === 0) return;
    this.bombs = this.bombs.filter((b) => b.at > now);
    const units: Unit[] = [];
    this.state.units.forEach((u) => units.push(u));
    const structures: Structure[] = [];
    this.state.structures.forEach((st) => structures.push(st));
    for (const b of due) {
      const len = this.map.lanes[b.lane].len;
      const x = Math.max(0, Math.min(len, b.x));
      this.splash(b.owner, b.lane, x, BOMB.radius, BOMB.damage * this.firepowerMult(b.owner), BOMB.weapon, units, structures);
      this.emit("bomb", { lane: b.lane, x });
    }
  }

  // ================================================================ 陣亡、攻破、出局

  private removeDead() {
    const s = this.state;
    const deadUnits: Unit[] = [];
    s.units.forEach((u) => {
      if (u.hp <= 0) deadUnits.push(u);
    });
    for (const u of deadUnits) {
      const mult = u.owner === s.leaderId ? LEADER_KILL_BOUNTY_MULT : 1;
      this.reward(u.id, UNITS[u.type as UnitType].cost * BOUNTY_RATIO * mult);
      s.units.delete(u.id);
      this.lastHit.delete(u.id);
    }

    const deadPlanes: Aircraft[] = [];
    s.aircraft.forEach((a) => {
      if (a.hp <= 0) deadPlanes.push(a);
    });
    for (const a of deadPlanes) {
      this.reward(a.id, AIRCRAFT[a.kind as AirKind].cost * BOUNTY_RATIO);
      this.emit("airDown", { x: a.x, y: a.y, angle: a.angle, kind: a.kind, faction: a.faction });
      s.aircraft.delete(a.id);
      this.lastHit.delete(a.id);
    }

    const deadStructs: Structure[] = [];
    s.structures.forEach((st) => {
      if (st.hp <= 0) deadStructs.push(st);
    });
    for (const st of deadStructs) {
      this.reward(st.id, STRUCTURES[st.kind as StructureKind].cost * BOUNTY_RATIO);
      s.structures.delete(st.id);
      this.lastHit.delete(st.id);
    }

    let changed = false;
    for (let i = 0; i < s.nodes.length; i++) {
      const n = s.nodes[i];
      if (!n.owner) continue;
      if (n.hp > 0) {
        if (n.kind === "hq") this.checkHqAlert(n);
        continue;
      }
      changed = true;
      const prevOwner = n.owner;
      const killer = this.lastHit.get(`n${i}`) ?? "";
      this.lastHit.delete(`n${i}`);
      const owner = s.players.get(prevOwner);
      if (n.kind === "hq" && owner && owner.hq === i) {
        this.eliminate(prevOwner, killer);
        if (s.phase !== "playing") return;
        continue;
      }
      this.eject(i);
      this.neutralize(n);
      const k = s.players.get(killer);
      if (k && k.alive) {
        k.fundsExact += FORT_BREAK_BOUNTY * (prevOwner === s.leaderId ? LEADER_FORT_BOUNTY_MULT : 1);
        k.kills += 1;
      }
      this.emit("fortFallen", { node: i, owner: prevOwner, faction: owner?.faction ?? -1, by: killer });
    }
    if (changed) this.countForts();
  }

  private neutralize(n: MapNode) {
    n.owner = "";
    n.faction = -1;
    n.hp = 0;
    n.capturer = "";
    n.capFaction = -1;
    n.progress = 0;
    if (n.kind === "hq") {
      n.kind = "bigfort";
      n.maxHp = STRUCTURES.bigfort.hp;
    }
  }

  private checkHqAlert(n: MapNode) {
    const ratio = n.hp / n.maxHp;
    const level = ratio <= 0.25 ? 2 : ratio <= 0.5 ? 1 : 0;
    const prev = this.hqAlerted.get(n.owner) ?? 0;
    if (level > prev) {
      this.hqAlerted.set(n.owner, level);
      this.emit("hqAlert", { owner: n.owner, level });
    }
  }

  private reward(targetId: string, amount: number) {
    const killer = this.lastHit.get(targetId);
    const p = killer ? this.state.players.get(killer) : undefined;
    if (!p || !p.alive) return;
    p.fundsExact += amount;
    p.kills += 1;
  }

  /** 大本營被打爆：出局，部隊和工事消失，所有據點變成無主 */
  eliminate(playerId: string, killerId: string) {
    const s = this.state;
    const victim = s.players.get(playerId);
    if (!victim || !victim.alive) return;
    victim.alive = false;
    victim.rank = this.alivePlayers().length + 1;
    s.nodes.forEach((n) => {
      if (n.owner === playerId) this.neutralize(n);
    });
    const removeOwned = (map: { forEach: (cb: (v: { id: string; owner: string }) => void) => void; delete: (k: string) => unknown }) => {
      const ids: string[] = [];
      map.forEach((v) => {
        if (v.owner === playerId) ids.push(v.id);
      });
      for (const id of ids) map.delete(id);
    };
    removeOwned(s.units);
    removeOwned(s.structures);
    removeOwned(s.aircraft);
    victim.pop = 0;
    victim.upkeep = 0;
    this.bombs = this.bombs.filter((b) => b.owner !== playerId);
    this.countForts();

    const killer = s.players.get(killerId);
    if (killer && killer.alive) {
      killer.fundsExact += HQ_KILL_BOUNTY;
      killer.kills += 1;
    }
    this.emit("eliminated", { id: victim.id, name: victim.name, faction: victim.faction, node: victim.hq, by: killer && killer.alive ? killer.name : "" });

    const alive = this.alivePlayers();
    if (alive.length <= 1) {
      const w = alive[0];
      if (w) this.finish(w.id, `${FACTIONS[w.faction].name}殲滅了所有對手`);
      else this.finish(WINNER_DRAW, "同歸於盡");
    }
  }

  // ================================================================ 前線與勝負

  /** 每條路上兩端據點主人的部隊推到哪裡（畫領土用） */
  private updateFronts(dt: number) {
    const s = this.state;
    const n = this.map.lanes.length;
    const fwd: number[] = new Array(n).fill(-1);
    const back: number[] = new Array(n).fill(-1);
    const ownerA = this.map.lanes.map((l) => (this.owns(s.nodes[l.a].owner, l.a) ? s.nodes[l.a].owner : ""));
    const ownerB = this.map.lanes.map((l) => (this.owns(s.nodes[l.b].owner, l.b) ? s.nodes[l.b].owner : ""));
    const now = s.time;
    s.units.forEach((u) => {
      if (u.landT > now || u.inNode >= 0 || u.hp <= 0) return;
      if (ownerA[u.lane] && u.owner === ownerA[u.lane]) fwd[u.lane] = Math.max(fwd[u.lane], u.x);
      if (ownerB[u.lane] && u.owner === ownerB[u.lane]) back[u.lane] = back[u.lane] < 0 ? u.x : Math.min(back[u.lane], u.x);
    });
    for (let i = 0; i < n; i++) {
      const len = this.map.lanes[i].len;
      const cur = s.fronts[i];
      let target = cur;
      if (ownerA[i] && ownerA[i] === ownerB[i]) target = len / 2;
      else if (fwd[i] >= 0 && back[i] >= 0) target = (fwd[i] + back[i]) / 2;
      else if (fwd[i] >= 0) target = Math.max(cur, fwd[i]);
      else if (back[i] >= 0) target = Math.min(cur, back[i]);
      else if (ownerA[i] && !ownerB[i]) target = Math.max(cur, Math.min(len, 170));
      else if (ownerB[i] && !ownerA[i]) target = Math.min(cur, Math.max(0, len - 170));
      const maxMove = FRONT_SPEED * dt;
      const next = cur + Math.max(-maxMove, Math.min(maxMove, target - cur));
      if (Math.abs(next - cur) > 0.01) s.fronts[i] = next;
    }
  }

  private endByTime() {
    const alive = this.alivePlayers();
    const score = (p: Player) => {
      const hq = this.state.nodes[p.hq];
      return { forts: p.forts, hp: hq && hq.owner === p.id ? hq.hp / hq.maxHp : 0 };
    };
    alive.sort((a, b) => {
      const sa = score(a);
      const sb = score(b);
      if (sa.forts !== sb.forts) return sb.forts - sa.forts;
      return sb.hp - sa.hp;
    });
    alive.forEach((p, i) => (p.rank = i + 1));
    if (alive.length >= 2) {
      const s0 = score(alive[0]);
      const s1 = score(alive[1]);
      if (s0.forts === s1.forts && Math.abs(s0.hp - s1.hp) <= 0.01) {
        this.finish(WINNER_DRAW, "時間到：勢均力敵");
        return;
      }
      this.finish(alive[0].id, s0.forts !== s1.forts ? "時間到：佔領的據點最多" : "時間到：大本營剩餘血量最多");
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

  private addUnit(p: Player, type: UnitType, at: RouteStart, landT = 0) {
    const def = UNITS[type];
    const u = new Unit();
    u.id = `u${this.nextId++}`;
    u.type = type;
    u.owner = p.id;
    u.faction = p.faction;
    if ("node" in at) {
      u.inNode = at.node;
      const lane = this.map.adj[at.node][0] ?? 0;
      u.lane = lane;
      u.x = nodeEnd(this.map.lanes[lane], at.node);
      u.mode = "hold";
    } else {
      u.lane = at.lane;
      u.x = at.x;
      u.mode = "move";
    }
    u.dir = 1;
    u.oy = Math.round((this.rng() - 0.5) * 20);
    u.hp = u.maxHp = def.hp * this.armorMult(p);
    u.cooldownLeft = this.rng() * 0.3;
    u.landT = landT;
    this.state.units.set(u.id, u);
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
    if (!p || !p.alive || p.hq < 0) return null;
    return p;
  }

  private validLane(lane: number) {
    return Number.isInteger(lane) && lane >= 0 && lane < this.map.lanes.length;
  }

  owns(playerId: string, node: number) {
    const n = this.state.nodes[node];
    return !!n && n.owner === playerId && n.hp > 0;
  }

  ownedNodes(playerId: string): number[] {
    const out: number[] = [];
    this.state.nodes.forEach((n, i) => {
      if (n.owner === playerId && n.hp > 0) out.push(i);
    });
    return out;
  }

  alivePlayers(): Player[] {
    const out: Player[] = [];
    this.state.players.forEach((p) => {
      if (p.alive && p.hq >= 0) out.push(p);
    });
    return out;
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

  /** 某玩家在某個據點裡的駐軍（不含正在排隊出門的） */
  garrisonUnits(playerId: string, node: number): Unit[] {
    const out: Unit[] = [];
    this.state.units.forEach((u) => {
      if (u.owner === playerId && u.inNode === node && u.departAt === 0 && u.hp > 0) out.push(u);
    });
    return out;
  }
}
