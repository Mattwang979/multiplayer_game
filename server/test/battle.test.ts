// 規則測試：直接跑模擬，不經過網路。執行：npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { MAPS, TICK_RATE, UNIT_TYPES, type UnitType } from "@frontline/shared";
import { Battle } from "../src/game/Battle";
import { BotBrain } from "../src/game/Bot";
import { BattleState, Player } from "../src/game/schema";

const DT = 1 / TICK_RATE;

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

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

/** 不管冷卻和錢，直接出兵 */
function force(battle: Battle, id: string, type: UnitType, lane: number, node: number, count = 1) {
  const p = battle.state.players.get(id)!;
  for (let i = 0; i < count; i++) {
    p.fundsExact = 100000;
    for (let k = 0; k < UNIT_TYPES.length; k++) p.deployReady[k] = 0;
    assert.equal(battle.spawn(id, type, lane, node), null);
  }
}

/** 山口地圖的中央谷地道路上，兩邊從路的兩端對衝（只看部隊對打） */
function duel(a: [UnitType, number], b: [UnitType, number]) {
  const { battle, state } = setup(2, "pass");
  const lane = laneBetween(battle, 0, 7);
  const len = battle.map.lanes[lane].len;
  force(battle, "p0", a[0], lane, 0, a[1]);
  force(battle, "p1", b[0], laneBetween(battle, 7, 1), 1, b[1]);
  state.units.forEach((u) => {
    if (u.owner === "p0") {
      u.x = 160;
    } else {
      u.lane = lane;
      u.dir = -1;
      u.x = len - 120;
    }
  });
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

test("開局：每人一座大本營加兩座堡壘，其他是無主", () => {
  const { state } = setup(2, "pass");
  const owned = (id: string) => [...state.nodes.values()].filter((n) => n.owner === id && n.hp > 0).length;
  assert.equal(owned("p0"), 3);
  assert.equal(owned("p1"), 3);
  assert.equal([...state.nodes.values()].filter((n) => !n.owner).length, 3);
});

test("只能從自己的據點出兵", () => {
  const { battle } = setup(2, "pass");
  assert.equal(battle.spawn("p0", "rifle", laneBetween(battle, 4, 1), 1), "只能從自己的據點出兵");
  assert.equal(battle.spawn("p0", "rifle", laneBetween(battle, 0, 2), 0), null);
});

test("部隊走到自己的據點會繼續往無主堡壘推進，並佔領它", () => {
  const { battle, state, events } = setup(2, "pass");
  force(battle, "p0", "rifle", laneBetween(battle, 0, 2), 0, 2);
  const ok = run(battle, 60, () => state.nodes[6].owner === "p0");
  assert.ok(ok, "北山口應該被佔領");
  assert.ok(events.some((e) => e.type === "captured" && e.payload.node === 6));
  assert.equal(state.nodes[6].hp, state.nodes[6].maxHp * 0.5);
});

test("敵人的堡壘打到 0 血後可以佔領", () => {
  const { battle, state, events } = setup(2, "pass");
  // 讓綠方先拿下北山口，再從那裡打灰方的東北堡（4 號）
  state.nodes[6].owner = "p0";
  state.nodes[6].faction = 0;
  state.nodes[6].hp = state.nodes[6].maxHp;
  state.nodes[4].hp = 60;
  force(battle, "p0", "tank", laneBetween(battle, 6, 4), 6, 2);
  const ok = run(battle, 60, () => state.nodes[4].owner === "p0");
  assert.ok(events.some((e) => e.type === "fortFallen" && e.payload.node === 4), "東北堡應該被攻破");
  assert.ok(ok, "東北堡應該被綠方佔領");
});

test("大本營被打爆：出局，他的堡壘全部變成無主", () => {
  const { battle, state } = setup(3, "oasis");
  const p1 = state.players.get("p1")!;
  state.nodes[p1.hq].hp = 0;
  battle.step(DT);
  assert.equal(p1.alive, false);
  assert.equal([...state.nodes.values()].filter((n) => n.owner === "p1").length, 0);
  assert.equal(state.nodes[p1.hq].kind, "bigfort");
});

test("轟炸機會飛過去炸傷敵人", () => {
  const { battle, state, events } = setup(2, "pass");
  const lane = laneBetween(battle, 7, 1);
  force(battle, "p1", "rifle", lane, 1, 3);
  const p0 = state.players.get("p0")!;
  p0.fundsExact = 1000;
  p0.airReady[0] = 0;
  state.time = 40;
  assert.equal(battle.callAir("p0", "bomber", lane, 300), null);
  for (let i = 0; i < 6 / DT; i++) {
    state.units.forEach((u) => (u.x = 300));
    battle.step(DT);
  }
  assert.ok(events.some((e) => e.type === "bomb"));
  let hurt = 0;
  state.units.forEach((u) => {
    if (u.hp < u.maxHp) hurt++;
  });
  assert.ok(hurt + (3 - state.units.size) >= 2);
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
  assert.equal([...state.units.values()].filter((u) => u.type === "para").length, 2);
});

test("防空砲會把飛機打下來", () => {
  const { battle, state, events } = setup(2, "pass");
  const p1 = state.players.get("p1")!;
  p1.fundsExact = 10000;
  for (const [a, b] of [[4, 1], [5, 1], [7, 1]]) {
    const lane = laneBetween(battle, a, b);
    for (const slot of [0, 1]) if (battle.slotFits(lane, slot)) assert.equal(battle.build("p1", lane, 1, slot, "aa"), null);
  }
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
      while (state.phase === "playing" && steps < 700 / DT) {
        for (const b of bots) b.update(battle, DT);
        battle.step(DT);
        steps++;
        if (steps % 200 === 0) state.units.forEach((u) => assert.ok(Number.isFinite(u.x) && Number.isFinite(u.hp)));
      }
      assert.equal(state.phase, "ended");
      assert.ok(state.winnerId !== "");
      const caps = events.filter((e) => e.type === "captured").length;
      const falls = events.filter((e) => e.type === "fortFallen").length;
      let deployed = 0;
      state.players.forEach((p) => (deployed += p.deployed));
      console.log(`  ${def.name} ${n} 人：${state.time.toFixed(0)} 秒，${state.endReason}，出兵 ${deployed}，佔領 ${caps} 次，攻破 ${falls} 次`);
      assert.ok(caps >= 2, "應該有據點被佔領");
    });
  }
}
