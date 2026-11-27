// 等價對打：每一種兵花一樣的錢，在路上對衝，看誰剩下多少（直接用遊戲引擎算）。
//   npx tsx scripts/duels.ts [預算]
import { UNITS, UNIT_TYPES, nodeDir, nodeEnd, type UnitType } from "@frontline/shared";
import { Battle } from "../src/game/Battle";
import { BattleState, Player, type Unit } from "../src/game/schema";
const budget = Number(process.argv[2] ?? 660);
function seeded(x: number) { let s = x >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const TYPES = UNIT_TYPES.filter((t) => t !== "medic");
function fight(a: UnitType, b: UnitType, seed: number): number {
  const state = new BattleState();
  state.mapChoice = "pass";
  for (let i = 0; i < 2; i++) { const p = new Player(); p.id = `p${i}`; p.name = `P${i}`; p.faction = i; state.players.set(p.id, p); }
  const battle = new Battle(state, () => {}, seeded(seed));
  battle.start(0);
  state.units.forEach((u) => state.units.delete(u.id));
  const lane = battle.map.lanes.findIndex((l) => (l.a === 0 && l.b === 7) || (l.a === 7 && l.b === 0));
  const geom = battle.map.lanes[lane];
  const from0 = nodeEnd(geom, 0);
  const d0 = nodeDir(geom, 0);
  const put = (id: string, type: UnitType, x: number, dir: 1 | -1, dest: number) => {
    const p = state.players.get(id)!;
    const n = Math.max(1, Math.round(budget / UNITS[type].cost));
    for (let i = 0; i < n; i++) {
      p.fundsExact = 1e6;
      battle.buy(id, p.hq, type, 1);
      let u: Unit | undefined;
      state.units.forEach((v) => { if (v.owner === id && v.inNode === p.hq) u = v; });
      u!.inNode = -1; u!.lane = lane; u!.x = x - dir * i * 7; u!.dir = dir; u!.mode = "move"; u!.destNode = dest; u!.enter = false; u!.route.clear();
    }
    return n * UNITS[type].cost;
  };
  const va = put("p0", a, from0 + d0 * 150, d0, 7);
  const vb = put("p1", b, from0 + d0 * (geom.len - 110), d0 === 1 ? -1 : 1, 0);
  state.nodes[0].owner = ""; state.nodes[0].hp = 0; state.nodes[7].owner = ""; state.nodes[7].hp = 0;
  for (let t = 0; t < 150 / 0.05; t++) {
    battle.step(0.05);
    let s0 = 0, s1 = 0;
    state.units.forEach((u) => (u.owner === "p0" ? s0++ : s1++));
    if (s0 === 0 || s1 === 0) break;
  }
  let ra = 0, rb = 0;
  state.units.forEach((u) => { const v = UNITS[u.type as UnitType].cost * u.hp / u.maxHp; if (u.owner === "p0") ra += v; else rb += v; });
  return ra / va - rb / vb; // +1 = A 全勝且無損，-1 = B 全勝
}
const M: Record<string, Record<string, number>> = {};
for (const a of TYPES) {
  M[a] = {};
  for (const b of TYPES) M[a][b] = Math.round(((fight(a, b, 1) - fight(b, a, 2)) / 2) * 100) / 100;
}
console.log("      " + TYPES.map((t) => t.slice(0, 5).padStart(6)).join(""));
for (const a of TYPES) console.log(a.slice(0, 5).padEnd(6) + TYPES.map((b) => String(M[a][b].toFixed(2)).padStart(6)).join(""));
console.log(JSON.stringify(M));
