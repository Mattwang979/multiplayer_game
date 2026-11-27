// 跑一場並每隔一段時間印出雙方狀況：npx tsx scripts/trace.ts <map> <seed> <seat0> <seat1> ...
import { UNITS, type UnitType } from "@frontline/shared";
import { Battle } from "../src/game/Battle";
import { BotBrain } from "../src/game/Bot";
import { GeneralBrain } from "../src/game/General";
import { BattleState, Player } from "../src/game/schema";
const [map, seedS, ...seats] = process.argv.slice(2);
const seed = Number(seedS);
function seeded(x: number) { let s = x >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const state = new BattleState();
state.mapChoice = map;
seats.forEach((_, i) => { const p = new Player(); p.id = `p${i}`; p.name = `P${i}`; p.faction = i; state.players.set(p.id, p); });
const events: string[] = [];
const battle = new Battle(state, (type, m: any) => { if (["captured", "fortFallen", "eliminated"].includes(type)) events.push(`${state.time.toFixed(0)}s ${type} ${m.node ?? ""} by ${m.by ?? ""}`); }, seeded(seed));
battle.start(Number(process.env.DURATION ?? 600));
const rng = seeded(seed * 7 + 3);
const brains = seats.map((spec, i) => { const p = state.players.get(`p${i}`)!; p.isBot = p.wasBot = true; const cheat = spec.endsWith("+") || spec === "brutal"; p.botLevel = cheat ? "brutal" : "hard"; return spec.startsWith("general") ? new GeneralBrain(p.id, rng) : new BotBrain(p.id, rng, spec as any); });
let next = 0;
const watch = process.env.DEATHS;
const last = new Map<string, string>();
const deaths = new Map<string, number>();
while (state.phase === "playing" && state.time < 3600) {
  for (const b of brains) b.update(battle, 0.05);
  battle.step(0.05);
  if (watch) {
    const seen = new Set<string>();
    state.units.forEach((u) => {
      if (u.owner !== watch) return;
      seen.add(u.id);
      const L = battle.map.lanes[u.lane];
      const where = u.inNode >= 0 ? `in${u.inNode}` : `L${u.lane}(${L.a}-${L.b})@${Math.round(u.x)}/${Math.round(L.len)} ${u.mode}`;
      last.set(u.id, `${u.type} ${where}`);
    });
    for (const [id, w] of last) if (!seen.has(id)) { last.delete(id); const k = w.replace(/@\d+/, "@").replace(/ \w+$/, ""); deaths.set(k, (deaths.get(k) ?? 0) + 1); if (process.env.DEATHS_LOG) console.log(`    ✝ ${state.time.toFixed(0)}s ${w}`); }
  }
  if (state.time >= next) {
    next += Number(process.env.EVERY ?? 20);
    const line = [...state.players.values()].map((p) => {
      let field = 0, gar = 0; const mix = new Map<string, number>();
      state.units.forEach((u) => { if (u.owner !== p.id) return; const v = UNITS[u.type as UnitType].cost * u.hp / u.maxHp; if (u.inNode >= 0) gar += v; else field += v; mix.set(u.type, (mix.get(u.type) ?? 0) + 1); });
      const top = [...mix].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([t, n]) => `${t}${n}`).join(" ");
      return `${p.id} 堡${p.forts} $${p.funds} 收${p.income}-${p.upkeep} 人${p.pop} 野${Math.round(field)} 駐${Math.round(gar)} 升${p.firepower}${p.armor}${p.logistics} [${top}]`;
    }).join(" | ");
    console.log(`${state.time.toFixed(0).padStart(4)}s ${line}`);
    while (events.length) console.log("       " + events.shift());
  }
}
if (watch) console.log("deaths:", [...deaths].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, n]) => `${k} ×${n}`).join(" | "));
console.log(state.endReason, state.time.toFixed(0));
