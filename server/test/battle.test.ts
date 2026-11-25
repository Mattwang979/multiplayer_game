// 規則測試：直接跑模擬，不經過網路。執行：npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { LANE_LENGTH, TICK_RATE, UNIT_TYPES, nodeLanes, type UnitType } from "@frontline/shared";
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

function setup(n: number, seed = 1) {
  const state = new BattleState();
  for (let i = 0; i < n; i++) {
    const p = new Player();
    p.id = `p${i}`;
    p.name = `P${i}`;
    p.faction = i;
    state.players.set(p.id, p);
  }
  const events: { type: string; payload: unknown }[] = [];
  const battle = new Battle(state, (type, payload) => events.push({ type, payload }), seeded(seed));
  battle.start();
  return { state, battle, events };
}

/** 讓某玩家不管冷卻和錢，直接在指定路線出兵 */
function force(battle: Battle, id: string, type: UnitType, lane: number, count = 1) {
  const p = battle.state.players.get(id)!;
  for (let i = 0; i < count; i++) {
    p.fundsExact = 100000;
    for (let k = 0; k < UNIT_TYPES.length; k++) p.deployReady[k] = 0;
    assert.equal(battle.spawn(id, type, lane), null);
  }
}

/** 兩邊在同一條線上對打，回傳哪邊有部隊活下來 */
function duel(a: [UnitType, number], b: [UnitType, number]) {
  const { battle, state } = setup(2);
  // 把指揮部血量調很高，只看部隊對打
  state.structures.forEach((st) => (st.hp = st.maxHp = 1e9));
  force(battle, "p0", a[0], 0, a[1]);
  force(battle, "p1", b[0], 0, b[1]);
  for (let t = 0; t < 120 / DT; t++) {
    battle.step(DT);
    let s0 = 0;
    let s1 = 0;
    state.units.forEach((u) => (u.side === 0 ? s0++ : s1++));
    if (s0 === 0 || s1 === 0) return s0 > 0 ? "a" : s1 > 0 ? "b" : "none";
  }
  return "timeout";
}

test("剋制關係：兩門反戰車砲打贏一輛戰車", () => {
  assert.equal(duel(["at", 2], ["tank", 1]), "a");
});

test("剋制關係：戰車打贏四個步兵班", () => {
  assert.equal(duel(["tank", 1], ["rifle", 4]), "a");
});

test("剋制關係：兩個步兵班打贏一門反戰車砲", () => {
  assert.equal(duel(["rifle", 2], ["at", 1]), "a");
});

test("剋制關係：機槍組打贏一個步兵班", () => {
  assert.equal(duel(["mg", 1], ["rifle", 1]), "a");
});

test("出兵只能走自己指揮部相連的路線", () => {
  const { battle } = setup(4);
  const p0 = battle.state.players.get("p0")!;
  const own = nodeLanes(battle.map, p0.node);
  const other = battle.map.lanes.findIndex((_, i) => !own.includes(i));
  assert.notEqual(battle.spawn("p0", "rifle", own[0]), "只能從自己的指揮部出兵到相連的路線");
  assert.equal(battle.spawn("p0", "rifle", other), "只能從自己的指揮部出兵到相連的路線");
});

test("指揮部被消滅後，部隊會穿過廢墟打下一家", () => {
  const { battle, state } = setup(3);
  // 三角形：路線 0 = 0→1, 路線 1 = 1→2
  battle.eliminate(1, "p0");
  assert.equal(state.players.get("p1")!.alive, false);
  force(battle, "p0", "rifle", 0);
  const u = [...state.units.values()][0];
  u.x = LANE_LENGTH - 1;
  battle.step(DT);
  battle.step(DT);
  assert.equal(u.lane, 1);
  assert.equal(u.dir, 1);
  assert.ok(u.x < 20);
});

test("轟炸機會飛過去炸傷敵人", () => {
  const { battle, state, events } = setup(3);
  force(battle, "p1", "rifle", 0, 3);
  state.units.forEach((u) => (u.x = 700));
  const p0 = state.players.get("p0")!;
  p0.fundsExact = 1000;
  p0.airReady[0] = 0;
  state.time = 40;
  assert.equal(battle.callAir("p0", "bomber", 0, 700), null);
  // 讓敵人原地不動，方便驗證
  for (let i = 0; i < 6 / DT; i++) {
    state.units.forEach((u) => (u.x = 700));
    battle.step(DT);
  }
  assert.ok(events.some((e) => e.type === "bomb"));
  let hurt = 0;
  state.units.forEach((u) => {
    if (u.hp < u.maxHp) hurt++;
  });
  const dead = 3 - state.units.size;
  assert.ok(hurt + dead >= 2, `至少兩個班被炸到（受傷 ${hurt}、陣亡 ${dead}）`);
});

test("運輸機會投下空降兵，落地後才行動", () => {
  const { battle, state, events } = setup(3);
  const p0 = state.players.get("p0")!;
  p0.fundsExact = 1000;
  p0.airReady[1] = 0;
  state.time = 40;
  // 丟到跟自己不相連的路線（1 號線：1→2）
  assert.equal(battle.callAir("p0", "transport", 1, 500), null);
  for (let i = 0; i < 8 / DT; i++) battle.step(DT);
  assert.ok(events.some((e) => e.type === "paradrop"));
  const paras = [...state.units.values()].filter((u) => u.type === "para");
  assert.equal(paras.length, 2);
  assert.ok(paras.every((u) => u.lane === 1));
});

test("防空砲會把飛機打下來", () => {
  const { battle, state, events } = setup(2);
  const p1 = state.players.get("p1")!;
  p1.fundsExact = 10000;
  // 灰軍在兩條線上各蓋兩座防空砲
  for (const lane of [0, 1]) for (const slot of [0, 1]) assert.equal(battle.build("p1", lane, slot, "aa"), null);
  const p0 = state.players.get("p0")!;
  p0.fundsExact = 1000;
  p0.airReady[0] = 0;
  state.time = 40;
  // 炸灰軍指揮部附近
  assert.equal(battle.callAir("p0", "bomber", 0, 900), null);
  for (let i = 0; i < 10 / DT; i++) battle.step(DT);
  assert.ok(events.some((e) => e.type === "airDown"), "轟炸機應該被擊落");
});

for (const n of [2, 3, 4]) {
  test(`${n} 個電腦混戰可以正常打完一局`, () => {
    const { battle, state } = setup(n, 42 + n);
    const rng = seeded(7 + n);
    const bots: BotBrain[] = [];
    state.players.forEach((p) => bots.push(new BotBrain(p.id, rng)));
    let steps = 0;
    while (state.phase === "playing" && steps < (700 / DT)) {
      for (const b of bots) b.update(battle, DT);
      battle.step(DT);
      steps++;
      if (steps % 200 === 0) {
        state.units.forEach((u) => assert.ok(Number.isFinite(u.x) && Number.isFinite(u.hp)));
        state.aircraft.forEach((a) => assert.ok(Number.isFinite(a.x) && Number.isFinite(a.y)));
      }
    }
    assert.equal(state.phase, "ended");
    assert.ok(state.winnerId !== "");
    const ranks = [...state.players.values()].map((p) => p.rank).sort();
    assert.ok(ranks.every((r) => r >= 1), `每個人都有名次：${ranks}`);
    let deployed = 0;
    let spent = 0;
    state.players.forEach((p) => {
      deployed += p.deployed;
      spent += p.spent;
    });
    console.log(`  ${n} 人：${state.time.toFixed(0)} 秒結束，${state.endReason}，總出兵 ${deployed}，總花費 ${spent}`);
    assert.ok(deployed > 50);
  });
}
