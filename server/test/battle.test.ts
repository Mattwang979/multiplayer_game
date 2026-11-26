// 規則測試：直接跑模擬，不經過網路。執行：npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BUILD_START_HP,
  CAPTURE_GRACE,
  CONVERT_TIME,
  DEPOT_INCOME,
  EVENTS,
  SUPPLY_AMOUNT,
  FORT_BREAK_BOUNTY,
  LEADER_FORT_BOUNTY_MULT,
  MAPS,
  RELEASE_INTERVAL,
  TICK_RATE,
  UNIT_TYPES,
  nodeDir,
  nodeEnd,
  type UnitType,
} from "@frontline/shared";
import { Battle } from "../src/game/Battle";
import { BotBrain } from "../src/game/Bot";
import { BattleState, Player, type Unit } from "../src/game/schema";

const DT = 1 / TICK_RATE;

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// 山口突破：0 = 綠方大本營、1 = 灰方大本營，2/3 綠方堡壘、4/5 灰方堡壘，6 北山口、7 谷地要塞、8 南山口（無主）
function setup(n: number, map = "pass", seed = 1) {
  const state = new BattleState();
  state.mapChoice = map;
  for (let i = 0; i < n; i++) {
    const p = new Player();
    p.id = `p${i}`;
    p.name = `P${i}`;
    p.faction = i;
    state.players.set(p.id, p);
  }
  const events: { type: string; payload: any }[] = [];
  const battle = new Battle(state, (type, payload) => events.push({ type, payload }), seeded(seed));
  battle.start();
  return { state, battle, events };
}

function laneBetween(battle: Battle, a: number, b: number) {
  return battle.map.lanes.findIndex((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a));
}

function run(battle: Battle, seconds: number, until?: () => boolean) {
  for (let t = 0; t < seconds / DT; t++) {
    battle.step(DT);
    if (until?.()) return true;
  }
  return false;
}

const units = (battle: Battle, pred: (u: Unit) => boolean = () => true) => [...battle.state.units.values()].filter(pred);
const counts = (type: UnitType, n: number) => UNIT_TYPES.map((t) => (t === type ? n : 0));

/** 不管錢，直接在據點買兵 */
function give(battle: Battle, id: string, type: UnitType, node: number, count = 1) {
  battle.state.players.get(id)!.fundsExact = 100000;
  for (let left = count; left > 0; left -= 10) assert.equal(battle.buy(id, node, type, Math.min(10, left)), null);
}

/** 直接把兵放到路上（測試對打用） */
function place(battle: Battle, id: string, type: UnitType, lane: number, x: number, dir: 1 | -1, destNode: number, count = 1) {
  const p = battle.state.players.get(id)!;
  const made: Unit[] = [];
  for (let i = 0; i < count; i++) {
    give(battle, id, type, p.hq, 1);
    const u = units(battle, (u) => u.owner === id && u.inNode === p.hq).pop()!;
    u.inNode = -1;
    u.lane = lane;
    u.x = x - dir * i * 6;
    u.dir = dir;
    u.mode = "move";
    u.destNode = destNode;
    u.enter = false;
    u.route.clear();
    made.push(u);
  }
  return made;
}

/** 谷地道路上兩邊對衝（先把兩端都變成無主，只看部隊對打） */
function duel(a: [UnitType, number], b: [UnitType, number]) {
  const { battle, state } = setup(2, "pass");
  const lane = laneBetween(battle, 0, 7);
  const geom = battle.map.lanes[lane];
  state.units.forEach((u) => state.units.delete(u.id));
  const from0 = nodeEnd(geom, 0);
  const d0 = nodeDir(geom, 0);
  place(battle, "p0", a[0], lane, from0 + d0 * 160, d0, 7, a[1]);
  place(battle, "p1", b[0], lane, from0 + d0 * (geom.len - 120), d0 === 1 ? -1 : 1, 0, b[1]);
  state.nodes[0].owner = "";
  state.nodes[0].hp = 0;
  let result = "timeout";
  run(battle, 150, () => {
    let s0 = 0;
    let s1 = 0;
    state.units.forEach((u) => (u.owner === "p0" ? s0++ : s1++));
    if (s0 === 0 || s1 === 0) {
      result = s0 > 0 ? "a" : s1 > 0 ? "b" : "none";
      return true;
    }
    return false;
  });
  return result;
}

test("剋制關係：兩門反戰車砲打贏一輛戰車", () => assert.equal(duel(["at", 2], ["tank", 1]), "a"));
test("剋制關係：戰車打贏四個步兵班", () => assert.equal(duel(["tank", 1], ["rifle", 4]), "a"));
test("剋制關係：兩個步兵班打贏一門反戰車砲", () => assert.equal(duel(["rifle", 2], ["at", 1]), "a"));
test("剋制關係：機槍組打贏一個步兵班", () => assert.equal(duel(["mg", 1], ["rifle", 1]), "a"));
test("砲兵被削弱：三個步兵班打贏一門砲兵", () => assert.equal(duel(["rifle", 3], ["artillery", 1]), "a"));
test("剋砲兵：一輛戰車打贏兩門砲兵", () => assert.equal(duel(["tank", 1], ["artillery", 2]), "a"));
test("剋砲兵：機槍組打贏一門砲兵", () => assert.equal(duel(["mg", 1], ["artillery", 1]), "a"));
test("新兵種：狙擊手打贏機槍組", () => assert.equal(duel(["sniper", 1], ["mg", 1]), "a"));
test("新兵種：狙擊手打不過裝甲車", () => assert.equal(duel(["car", 1], ["sniper", 2]), "a"));
test("新兵種：火焰兵打贏兩個步兵班", () => assert.equal(duel(["flame", 1], ["rifle", 2]), "a"));
test("新兵種：裝甲車打贏兩個步兵班", () => assert.equal(duel(["car", 1], ["rifle", 2]), "a"));
test("新兵種：反戰車砲打贏裝甲車", () => assert.equal(duel(["at", 1], ["car", 1]), "a"));
test("新兵種：戰車打贏裝甲車", () => assert.equal(duel(["tank", 1], ["car", 1]), "a"));

test("開局：每人一座大本營加兩座堡壘，大本營裡有 3 個步兵班", () => {
  const { battle, state } = setup(2, "pass");
  const owned = (id: string) => [...state.nodes.values()].filter((n) => n.owner === id && n.hp > 0).length;
  assert.equal(owned("p0"), 3);
  assert.equal(owned("p1"), 3);
  assert.equal([...state.nodes.values()].filter((n) => !n.owner).length, 3);
  assert.equal(battle.garrisonUnits("p0", 0).length, 3);
});

test("買兵：只能在自己的據點買，據點住滿就不能再買", () => {
  const { battle, state } = setup(2, "pass");
  state.players.get("p0")!.fundsExact = 100000;
  assert.equal(battle.buy("p0", 4, "rifle", 1), "只能在自己的據點買兵");
  // 小堡壘最多 12 人口：4 輛戰車 = 12
  assert.equal(battle.buy("p0", 2, "tank", 4), null);
  assert.equal(battle.buy("p0", 2, "rifle", 1), "這座據點住滿了，先把兵派出去");
  state.players.get("p0")!.fundsExact = 10;
  assert.equal(battle.buy("p0", 0, "rifle", 1), "軍費不足");
});

test("派兵：選兵種和數量，一次派出時每支部隊間隔出門", () => {
  const { battle, state } = setup(2, "pass");
  give(battle, "p0", "tank", 0, 2);
  assert.equal(battle.dispatch("p0", 0, counts("rifle", 2), [], { node: 7 }, true), null);
  const leaving = units(battle, (u) => u.owner === "p0" && u.departAt > 0);
  assert.equal(leaving.length, 2, "只派出選的 2 個步兵班");
  assert.ok(Math.abs(leaving[1].departAt - leaving[0].departAt - RELEASE_INTERVAL) < 1e-6);
  run(battle, 0.2);
  assert.equal(units(battle, (u) => u.owner === "p0" && u.inNode < 0).length, 1, "第二支還沒出門");
  run(battle, 1);
  assert.equal(units(battle, (u) => u.owner === "p0" && u.inNode < 0).length, 2);
  assert.equal(battle.garrisonUnits("p0", 0).length, 3, "戰車和剩下的步兵還在大本營");
  // 全部是 0 = 全部派出
  assert.equal(battle.dispatch("p0", 0, [], [], { node: 7 }, true), null);
  assert.equal(battle.garrisonUnits("p0", 0).length, 0);
});

test("派兵到無主堡壘：打下來後進駐", () => {
  const { battle, state, events } = setup(2, "pass");
  // 從大本營經過西北堡（2 號）去北山口（6 號）
  assert.equal(battle.dispatch("p0", 0, [], [2], { node: 6 }, true), null);
  const ok = run(battle, 90, () => battle.garrisonUnits("p0", 6).length === 3);
  assert.ok(events.some((e) => e.type === "captured" && e.payload.node === 6), "北山口應該被佔領");
  assert.ok(ok, "佔領後應該進駐");
  assert.equal(state.nodes[6].owner, "p0");
});

test("派兵到路上：走到那個位置駐守", () => {
  const { battle } = setup(2, "pass");
  const lane = laneBetween(battle, 0, 7);
  const x = nodeEnd(battle.map.lanes[lane], 0) + nodeDir(battle.map.lanes[lane], 0) * 200;
  assert.equal(battle.dispatch("p0", 0, [], [], { lane, x }, true), null);
  run(battle, 20);
  const out = units(battle, (u) => u.owner === "p0");
  assert.ok(out.every((u) => u.inNode < 0 && u.mode === "hold" && u.lane === lane && Math.abs(u.x - x) < 1));
});

test("調度與撤退：改目的地、撤回後方據點並進駐", () => {
  const { battle, state } = setup(2, "pass");
  const lane = laneBetween(battle, 0, 7);
  const geom = battle.map.lanes[lane];
  const x = nodeEnd(geom, 0) + nodeDir(geom, 0) * 300;
  battle.dispatch("p0", 0, [], [], { lane, x }, true);
  run(battle, 15);
  const ids = units(battle, (u) => u.owner === "p0").map((u) => u.id);
  // 改去谷地要塞
  assert.equal(battle.order("p0", ids, [], { node: 7 }, false), null);
  assert.ok(units(battle, (u) => u.owner === "p0").every((u) => u.destNode === 7 && u.mode === "move"));
  run(battle, 3);
  // 撤退：回到最近的自己據點
  state.units.forEach((u) => (u.hp = u.maxHp * 0.4));
  assert.equal(battle.retreat("p0", ids), null);
  assert.ok(units(battle, (u) => u.owner === "p0").every((u) => u.mode === "retreat"));
  run(battle, 30, () => battle.garrisonUnits("p0", 0).length === 3);
  assert.equal(battle.garrisonUnits("p0", 0).length, 3, "應該回到大本營");
  // 駐紮會回血
  run(battle, 15);
  assert.ok(units(battle, (u) => u.owner === "p0").every((u) => u.hp > u.maxHp * 0.95));
});

test("撤退中的部隊不會開火", () => {
  const { battle, state } = setup(2, "pass");
  const lane = laneBetween(battle, 0, 7);
  const geom = battle.map.lanes[lane];
  const a = place(battle, "p0", "rifle", lane, nodeEnd(geom, 0) + nodeDir(geom, 0) * 400, nodeDir(geom, 0), 7, 1)[0];
  place(battle, "p1", "rifle", lane, nodeEnd(geom, 0) + nodeDir(geom, 0) * 470, nodeDir(geom, 0) === 1 ? -1 : 1, 0, 1);
  battle.retreat("p0", [a.id]);
  const shots = a.shots;
  run(battle, 2);
  assert.equal(a.shots, shots);
  assert.equal(state.units.get(a.id)?.mode ?? "retreat", "retreat");
});

test("養兵費：據點裡囤越多兵，扣越多錢", () => {
  const { battle, state } = setup(2, "pass");
  const p0 = state.players.get("p0")!;
  const p1 = state.players.get("p1")!;
  give(battle, "p0", "rifle", 0, 20);
  p0.fundsExact = 1000;
  p1.fundsExact = 1000;
  run(battle, 10);
  assert.ok(p0.upkeep > 3, `養兵費應該很高（${p0.upkeep}）`);
  assert.ok(p0.fundsExact < p1.fundsExact - 30);
  // 派出去的兵也要養，但比囤在據點裡便宜很多
  const hoarded = p0.upkeep;
  battle.dispatch("p0", 0, [], [], { node: 7 }, true);
  run(battle, 15);
  assert.ok(p0.upkeep > 0.5 && p0.upkeep < hoarded / 2, `野外養兵費 ${p0.upkeep} vs 囤兵 ${hoarded}`);
});

test("剛佔下的堡壘 15 秒內不產錢", () => {
  const { battle, state } = setup(2, "pass");
  const p0 = state.players.get("p0")!;
  run(battle, 1);
  const before = p0.income;
  state.nodes[6].hp = 0;
  place(battle, "p0", "rifle", laneBetween(battle, 2, 6), nodeEnd(battle.map.lanes[laneBetween(battle, 2, 6)], 6), 1, 6, 1);
  run(battle, 5, () => state.nodes[6].owner === "p0");
  run(battle, 1);
  assert.equal(p0.income, before, "整頓期間收入不變");
  run(battle, CAPTURE_GRACE);
  assert.ok(p0.income > before);
});

test("工兵：近身爆破堡壘很快，也會修理自己的據點", () => {
  const demo = (type: UnitType) => {
    const { battle, state } = setup(2, "pass");
    const lane = laneBetween(battle, 7, 1);
    const geom = battle.map.lanes[lane];
    state.units.forEach((u) => state.units.delete(u.id));
    // 只測拆房子：讓大本營打不到人（血量不變、但先把它的冷卻拉長）
    const hq = state.nodes[1];
    place(battle, "p0", type, lane, nodeEnd(geom, 1) - nodeDir(geom, 1) * -30, nodeDir(geom, 1) === 1 ? -1 : 1, 1, 2);
    const start = hq.hp;
    for (let i = 0; i < 4 / DT; i++) {
      hq.cooldownLeft = 99;
      battle.step(DT);
    }
    return start - hq.hp;
  };
  const eng = demo("engineer");
  const rifle = demo("rifle");
  assert.ok(eng > rifle * 5, `工兵 ${eng.toFixed(0)} vs 步兵 ${rifle.toFixed(0)}`);

  const { battle, state } = setup(2, "pass");
  state.nodes[2].hp = 500;
  give(battle, "p0", "engineer", 2, 1);
  run(battle, 10);
  assert.ok(state.nodes[2].hp > 500, "駐紮在堡壘裡的工兵會修理堡壘");
});

test("醫療兵：幫附近的步兵回血", () => {
  const { battle, state } = setup(2, "pass");
  const lane = laneBetween(battle, 0, 7);
  const geom = battle.map.lanes[lane];
  const x = nodeEnd(geom, 0) + nodeDir(geom, 0) * 250;
  const [r] = place(battle, "p0", "rifle", lane, x, nodeDir(geom, 0), 7, 1);
  const [m] = place(battle, "p0", "medic", lane, x - nodeDir(geom, 0) * 20, nodeDir(geom, 0), 7, 1);
  r.mode = m.mode = "hold";
  r.hp = 30;
  run(battle, 5);
  assert.ok(r.hp > 55, `步兵血量 ${r.hp.toFixed(0)}`);
});

test("堡壘被攻破時，裡面的駐軍會衝出來", () => {
  const { battle, state, events } = setup(2, "pass");
  give(battle, "p1", "rifle", 4, 3);
  state.nodes[4].hp = 0;
  battle.state.nodes[4].owner = "p1";
  run(battle, DT);
  assert.ok(events.some((e) => e.type === "fortFallen" && e.payload.node === 4));
  const out = units(battle, (u) => u.owner === "p1" && u.type === "rifle" && u.destNode === 4);
  assert.equal(out.length, 3);
  assert.ok(out.every((u) => u.inNode < 0));
});

test("領先者懸賞：堡壘最多的人被懸賞，攻破他的堡壘賞金加倍", () => {
  const { battle, state, events } = setup(3, "oasis");
  // 把一座無主堡壘給 p0 → p0 堡壘最多
  const free = [...state.nodes.values()].findIndex((n) => !n.owner);
  give(battle, "p0", "rifle", state.players.get("p0")!.hq, 1);
  state.nodes[free].owner = "p0";
  state.nodes[free].faction = 0;
  state.nodes[free].hp = state.nodes[free].maxHp;
  // 讓 p1 打爆它
  state.nodes[free].hp = 1;
  run(battle, DT);
  assert.equal(state.leaderId, "p0");
  assert.ok(events.some((e) => e.type === "leader" && e.payload.id === "p0"));
  const p1 = state.players.get("p1")!;
  const before = p1.fundsExact;
  (battle as any).lastHit.set(`n${free}`, "p1");
  state.nodes[free].hp = 0;
  run(battle, DT);
  assert.ok(p1.fundsExact - before >= FORT_BREAK_BOUNTY * LEADER_FORT_BOUNTY_MULT - 1);
  assert.equal(state.leaderId, "", "大家一樣多就沒有懸賞");
});

test("戰車＋工兵可以攻破敵人的堡壘並佔領", () => {
  const { battle, state, events } = setup(2, "pass");
  state.nodes[6].owner = "p0";
  state.nodes[6].faction = 0;
  state.nodes[6].hp = state.nodes[6].maxHp;
  give(battle, "p0", "tank", 6, 2);
  give(battle, "p0", "engineer", 6, 3);
  assert.equal(battle.dispatch("p0", 6, [], [], { node: 4 }, true), null);
  const ok = run(battle, 90, () => state.nodes[4].owner === "p0");
  assert.ok(events.some((e) => e.type === "fortFallen" && e.payload.node === 4), "東北堡應該被攻破");
  assert.ok(ok, "東北堡應該被佔領");
});

test("大本營被打爆：出局，他的堡壘全部變成無主", () => {
  const { battle, state } = setup(3, "oasis");
  const p1 = state.players.get("p1")!;
  state.nodes[p1.hq].hp = 0;
  battle.step(DT);
  assert.equal(p1.alive, false);
  assert.equal([...state.nodes.values()].filter((n) => n.owner === "p1").length, 0);
  assert.equal(state.nodes[p1.hq].kind, "bigfort");
  assert.equal(units(battle, (u) => u.owner === "p1").length, 0);
});

test("轟炸機會飛過去炸傷敵人", () => {
  const { battle, state, events } = setup(2, "pass");
  const lane = laneBetween(battle, 7, 1);
  state.units.forEach((u) => state.units.delete(u.id));
  const targets = place(battle, "p1", "rifle", lane, 300, 1, 1, 3);
  const p0 = state.players.get("p0")!;
  p0.fundsExact = 1000;
  p0.airReady[0] = 0;
  state.time = 40;
  assert.equal(battle.callAir("p0", "bomber", lane, 300), null);
  for (let i = 0; i < 6 / DT; i++) {
    targets.forEach((u) => (u.x = 300));
    battle.step(DT);
  }
  assert.ok(events.some((e) => e.type === "bomb"));
  const hurt = targets.filter((u) => u.hp < u.maxHp || !state.units.has(u.id)).length;
  assert.ok(hurt >= 2);
});

test("運輸機會投下空降兵", () => {
  const { battle, state, events } = setup(2, "pass");
  const p0 = state.players.get("p0")!;
  p0.fundsExact = 1000;
  p0.airReady[1] = 0;
  state.time = 40;
  const lane = laneBetween(battle, 8, 5);
  assert.equal(battle.callAir("p0", "transport", lane, 100), null);
  run(battle, 8);
  assert.ok(events.some((e) => e.type === "paradrop"));
  assert.equal(units(battle, (u) => u.type === "para").length, 2);
});

test("防空砲會把飛機打下來", () => {
  const { battle, state, events } = setup(2, "pass");
  const p1 = state.players.get("p1")!;
  p1.fundsExact = 10000;
  for (const [a, b] of [[4, 1], [5, 1], [7, 1]]) {
    const lane = laneBetween(battle, a, b);
    for (const slot of [0, 1]) if (battle.slotFits(lane, slot)) assert.equal(battle.build("p1", lane, 1, slot, "aa"), null);
  }
  state.structures.forEach((st) => (st.progress = 0.999)); // 直接當作快蓋好
  const p0 = state.players.get("p0")!;
  p0.fundsExact = 1000;
  p0.airReady[0] = 0;
  state.time = 40;
  const lane = laneBetween(battle, 7, 1);
  assert.equal(battle.callAir("p0", "bomber", lane, battle.map.lanes[lane].len - 60), null);
  run(battle, 10);
  assert.ok(events.some((e) => e.type === "airDown"), "轟炸機應該被擊落");
});

for (const def of MAPS) {
  for (let n = def.minPlayers; n <= def.slots; n++) {
    test(`${def.name}：${n} 個電腦混戰可以正常打完一局`, () => {
      const { battle, state, events } = setup(n, def.id, 40 + n);
      const rng = seeded(7 + n);
      const bots: BotBrain[] = [];
      state.players.forEach((p) => bots.push(new BotBrain(p.id, rng)));
      let steps = 0;
      let maxPop = 0;
      while (state.phase === "playing" && steps < 700 / DT) {
        for (const b of bots) b.update(battle, DT);
        battle.step(DT);
        steps++;
        if (steps % 200 === 0) {
          state.units.forEach((u) => assert.ok(Number.isFinite(u.x) && Number.isFinite(u.hp)));
          state.players.forEach((p) => (maxPop = Math.max(maxPop, p.pop)));
        }
      }
      assert.equal(state.phase, "ended");
      assert.ok(state.winnerId !== "");
      const caps = events.filter((e) => e.type === "captured").length;
      const falls = events.filter((e) => e.type === "fortFallen").length;
      let deployed = 0;
      state.players.forEach((p) => (deployed += p.deployed));
      console.log(`  ${def.name} ${n} 人：${state.time.toFixed(0)} 秒，${state.endReason}，買兵 ${deployed}，最高人口 ${maxPop}，佔領 ${caps} 次，攻破 ${falls} 次`);
      assert.ok(caps >= 2, "應該有據點被佔領");
      // 結算圖：每 5 秒一筆，最後一筆是結束時間，出局的人有紀錄
      const h = battle.history;
      assert.equal(h.players.length, n);
      assert.ok(h.samples.length >= Math.floor(state.time / 5));
      assert.ok(Math.abs(h.samples[h.samples.length - 1].t - state.time) < 0.2);
      assert.ok(events.some((e) => e.type === "history"));
      let outs = 0;
      state.players.forEach((p) => (outs += p.alive ? 0 : 1));
      assert.equal(h.out.length, outs);
    });
  }
}

test("工事要施工：剛蓋時血少、不能開火，工兵在旁邊蓋得比較快", () => {
  const timeToBuild = (engineers: number) => {
    const { battle, state } = setup(2, "pass");
    const lane = laneBetween(battle, 0, 7);
    state.players.get("p0")!.fundsExact = 10000;
    assert.equal(battle.build("p0", lane, 0, 0, "bunker"), null);
    const st = [...state.structures.values()][0];
    assert.ok(Math.abs(st.hp / st.maxHp - BUILD_START_HP) < 1e-6);
    assert.equal(st.progress, 0);
    if (engineers) {
      const geom = battle.map.lanes[lane];
      const at = st.x;
      const made = place(battle, "p0", "engineer", lane, at, nodeDir(geom, 0), 7, engineers);
      made.forEach((u) => (u.mode = "hold"));
    }
    let t = 0;
    while (st.progress < 1 && t < 60) {
      battle.step(DT);
      t += DT;
    }
    assert.ok(Math.abs(st.hp - st.maxHp) < 1);
    return t;
  };
  const alone = timeToBuild(0);
  const helped = timeToBuild(2);
  assert.ok(alone > 11 && alone < 13, `自己蓋 ${alone.toFixed(1)} 秒`);
  assert.ok(helped < alone / 2.5, `兩個工兵幫忙 ${helped.toFixed(1)} 秒`);
});

test("施工中的碉堡不會開火", () => {
  const { battle, state } = setup(2, "pass");
  const lane = laneBetween(battle, 0, 7);
  state.players.get("p0")!.fundsExact = 10000;
  battle.build("p0", lane, 0, 0, "bunker");
  const st = [...state.structures.values()][0];
  const geom = battle.map.lanes[lane];
  const [enemy] = place(battle, "p1", "rifle", lane, st.x + nodeDir(geom, 0) * 60, nodeDir(geom, 0) === 1 ? -1 : 1, 0, 1);
  enemy.mode = "hold";
  run(battle, 3);
  assert.equal(st.shots, 0);
});

test("防空砲車會打下轟炸機", () => {
  const { battle, state, events } = setup(2, "pass");
  const lane = laneBetween(battle, 7, 1);
  const geom = battle.map.lanes[lane];
  const flak = place(battle, "p1", "flak", lane, geom.len - 80, -1, 1, 3);
  flak.forEach((u) => (u.mode = "hold"));
  const p0 = state.players.get("p0")!;
  p0.fundsExact = 1000;
  p0.airReady[0] = 0;
  state.time = 40;
  assert.equal(battle.callAir("p0", "bomber", lane, geom.len - 80), null);
  run(battle, 10);
  assert.ok(events.some((e) => e.type === "airDown"), "轟炸機應該被防空砲車擊落");
});

test("堡壘改建：要 10 秒，補給站多產錢、兵營多住兵又打折、被攻破就變回標準", () => {
  const { battle, state, events } = setup(2, "pass");
  const p0 = state.players.get("p0")!;
  p0.fundsExact = 10000;
  assert.equal(battle.convert("p0", 0, "depot"), "大本營不能改建");
  assert.equal(battle.convert("p0", 4, "depot"), "只能改建自己的堡壘");
  run(battle, 1);
  const before = p0.income;
  assert.equal(battle.convert("p0", 2, "depot"), null);
  run(battle, CONVERT_TIME - 1);
  assert.equal(p0.income, before, "改建完成前沒有效果");
  run(battle, 2);
  assert.ok(events.some((e) => e.type === "converted" && e.payload.node === 2));
  assert.ok(Math.abs(p0.income - before - DEPOT_INCOME) < 0.11);
  assert.ok(state.nodes[2].maxHp < 1500);

  assert.equal(battle.convert("p0", 3, "barracks"), null);
  run(battle, CONVERT_TIME + 0.5);
  assert.equal(battle.garrisonCapAt(3), 20);
  assert.equal(battle.unitPrice("tank", 3), Math.round(220 * 0.85));
  // 被攻破 → 變回標準
  state.nodes[3].hp = 0;
  run(battle, DT);
  assert.equal(state.nodes[3].spec, "");
  assert.equal(battle.garrisonCapAt(3), 12);
});

test("堡壘改建：砲台打得比標準堡壘痛", () => {
  const dmg = (spec: "" | "battery") => {
    const { battle, state } = setup(2, "pass");
    state.players.get("p0")!.fundsExact = 10000;
    if (spec) battle.convert("p0", 2, spec);
    run(battle, CONVERT_TIME + 0.5);
    state.units.forEach((u) => state.units.delete(u.id));
    const lane = laneBetween(battle, 2, 6);
    const geom = battle.map.lanes[lane];
    const [tank] = place(battle, "p1", "tank", lane, nodeEnd(geom, 2) + nodeDir(geom, 2) * 150, nodeDir(geom, 2) === 1 ? -1 : 1, 2, 1);
    tank.mode = "hold";
    tank.hp = tank.maxHp = 100000;
    run(battle, 5);
    return 100000 - tank.hp;
  };
  const plain = dmg("");
  const battery = dmg("battery");
  assert.ok(battery > plain * 1.5, `砲台 ${battery.toFixed(0)} vs 標準 ${plain.toFixed(0)}`);
});

test("隨機事件：補給箱被部隊撿到給錢", () => {
  const { battle, state, events } = setup(2, "pass");
  battle.startEvent("supply");
  assert.equal(state.event, "supply");
  assert.equal(state.crates.size, 2);
  const c = [...state.crates.values()][0];
  run(battle, 3);
  const p0 = state.players.get("p0")!;
  const before = p0.fundsExact;
  const [u] = place(battle, "p0", "rifle", c.lane, c.x, 1, 7, 1);
  u.mode = "hold";
  run(battle, DT * 2);
  assert.ok(events.some((e) => e.type === "crateTaken" && e.payload.by === "p0"));
  assert.ok(p0.fundsExact - before >= SUPPLY_AMOUNT - 1 - 60);
  assert.equal(state.crates.size, 1);
});

test("隨機事件：暴風雨不能叫飛機、結束後恢復", () => {
  const { battle, state } = setup(2, "pass");
  const p0 = state.players.get("p0")!;
  p0.fundsExact = 1000;
  p0.airReady[0] = 0;
  state.time = 40;
  battle.startEvent("storm");
  assert.equal(battle.callAir("p0", "bomber", 0, 100), "暴風雨中飛機無法起飛");
  run(battle, EVENTS.storm.duration + 1);
  assert.equal(state.event, "");
  assert.equal(battle.callAir("p0", "bomber", 0, 100), null);
});

test("隨機事件：砲擊彈幕會炸到部隊", () => {
  const { battle, state, events } = setup(2, "pass");
  const lane = laneBetween(battle, 0, 7);
  const guys = place(battle, "p0", "rifle", lane, 300, 1, 7, 4);
  guys.forEach((u) => (u.mode = "hold"));
  battle.startEvent("barrage");
  run(battle, EVENTS.barrage.duration);
  assert.ok(events.filter((e) => e.type === "barrageMark").length >= 8);
  assert.ok(guys.some((u) => u.hp < u.maxHp || !state.units.has(u.id)), "彈幕應該打到人");
});

test("隨機事件：援軍給堡壘最少的人", () => {
  const { battle, state } = setup(2, "pass");
  state.nodes[6].owner = "p1";
  state.nodes[6].faction = 1;
  state.nodes[6].hp = 1000;
  run(battle, DT);
  const before = battle.garrisonUnits("p0", 0).length;
  const beforeP1 = battle.garrisonUnits("p1", 1).length;
  battle.startEvent("reinforce");
  assert.equal(battle.garrisonUnits("p0", 0).length, before + 3);
  assert.equal(battle.garrisonUnits("p1", 1).length, beforeP1);
});

test("隨機事件：燃料短缺時戰車變慢、戰功懸賞時賞金加倍", () => {
  const speed = (event: "" | "fuel") => {
    const { battle } = setup(2, "pass");
    const lane = laneBetween(battle, 0, 7);
    const geom = battle.map.lanes[lane];
    const [t] = place(battle, "p0", "tank", lane, nodeEnd(geom, 0) + nodeDir(geom, 0) * 100, nodeDir(geom, 0), 7, 1);
    if (event) battle.startEvent(event);
    const x0 = t.x;
    run(battle, 3);
    return Math.abs(t.x - x0);
  };
  assert.ok(speed("fuel") < speed("") * 0.6);

  const { battle, state } = setup(2, "pass");
  battle.startEvent("bounty");
  const p1 = state.players.get("p1")!;
  const [victim] = place(battle, "p0", "tank", laneBetween(battle, 0, 7), 300, 1, 7, 1);
  (battle as any).lastHit.set(victim.id, "p1");
  victim.hp = 0;
  const before = p1.fundsExact;
  run(battle, DT);
  assert.ok(p1.fundsExact - before > 220 * 0.2 * 2 - 1);
});
