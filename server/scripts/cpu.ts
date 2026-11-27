// 量電腦思考花多少時間：npx tsx scripts/cpu.ts <map> <人數>
import { Battle } from "../src/game/Battle";
import { GeneralBrain } from "../src/game/General";
import { BattleState, Player } from "../src/game/schema";
const [map, nS] = process.argv.slice(2);
function seeded(x: number) { let s = x >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const state = new BattleState();
state.mapChoice = map;
for (let i = 0; i < Number(nS); i++) { const p = new Player(); p.id = `p${i}`; p.name = `P${i}`; p.faction = i; state.players.set(p.id, p); }
const battle = new Battle(state, () => {}, seeded(5));
battle.start(600);
const brains = [...state.players.values()].map((p) => { p.isBot = p.wasBot = true; p.botLevel = "brutal"; return new GeneralBrain(p.id, seeded(9)); });
let think = 0, sim = 0, worst = 0, ticks = 0;
while (state.phase === "playing") {
  const t0 = performance.now();
  for (const b of brains) b.update(battle, 0.05);
  const t1 = performance.now();
  battle.step(0.05);
  const t2 = performance.now();
  think += t1 - t0; sim += t2 - t1; worst = Math.max(worst, t1 - t0); ticks++;
}
console.log(`${map} ${nS} 人 ${state.time.toFixed(0)}s：電腦平均每 tick ${(think / ticks).toFixed(2)}ms（最久 ${worst.toFixed(1)}ms），引擎 ${(sim / ticks).toFixed(2)}ms；${state.endReason}`);
