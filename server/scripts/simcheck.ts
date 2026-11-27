// 比較將軍的戰鬥模擬和引擎實測的等價對打（duels.ts 的結果）
import { UNITS, UNIT_TYPES, type UnitType } from "@frontline/shared";
import { GeneralBrain } from "../src/game/General";
const real = JSON.parse(process.argv[2]);
const g = new GeneralBrain("p0") as any;
const TYPES = UNIT_TYPES.filter((t) => t !== "medic");
const budget = Number(process.env.BUDGET ?? 660);
const stack = (type: UnitType, join = 0) => {
  const d = UNITS[type]; const n = Math.max(1, Math.round(budget / d.cost));
  return { type, armor: { soft: 0, light: 1, hard: 2, building: 3 }[d.armor], hp: n * d.hp, max: n * d.hp, unitHp: d.hp, dps: g.constructor.DPS?.[type] ?? null, range: d.range, heal: 0, splash: !!d.splash, worth: d.cost / d.hp, join, speed: d.speed };
};
let err = 0, n = 0, signs = 0;
const rows: string[] = [];
for (const a of TYPES) {
  const cells: string[] = [];
  for (const b of TYPES) {
    const A = [g.debugStack(a, budget)], B = [g.debugStack(b, budget)];
    const r = g.simulate(A, B, 150);
    const v = r.aLeft - r.bLeft;
    const rv = real[a][b];
    err += Math.abs(v - rv); n++;
    if (Math.sign(v) === Math.sign(rv) || Math.abs(rv) < 0.15) signs++;
    cells.push(`${v.toFixed(2)}`.padStart(6));
  }
  rows.push(a.slice(0, 5).padEnd(6) + cells.join(""));
}
console.log("      " + TYPES.map((t) => t.slice(0, 5).padStart(6)).join(""));
console.log(rows.join("\n"));
console.log(`平均誤差 ${(err / n).toFixed(3)}，勝負方向一致 ${signs}/${n}`);
