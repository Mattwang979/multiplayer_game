// 電腦對電腦錦標賽：拿來比較不同的電腦腦袋誰比較強。
//
//   npx tsx scripts/tourney.ts --a general --b brutal [--maps all|classic|big|<id,id>] [--rounds 1] [--players 2] [--seed 1] [--jobs 2]
//
// 腦袋名稱：easy / normal / hard / brutal（原本的電腦）、general（新的將軍），
// 後面加 "+" 代表收入 +30%（地獄的加成）；brutal 本來就有加成。
// 每張地圖每一輪都會換邊打兩場，避免地形偏向某一邊。
// 多人（--players 3/4）時 a 只有一個，其他位置全部是 b。
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { BOT_LEVELS, MAPS, type BotLevel } from "@frontline/shared";
import { Battle } from "../src/game/Battle";
import { BotBrain } from "../src/game/Bot";
import { GeneralBrain } from "../src/game/General";
import { BattleState, Player } from "../src/game/schema";

const DT = 0.05;

interface Brain {
  update(battle: Battle, dt: number): void;
}

interface Game {
  map: string;
  seed: number;
  seats: string[]; // 每個位置用哪個腦袋
  duration: number;
}

interface Result {
  game: Game;
  winner: number; // 贏的位置，-1 = 平手
  reason: string;
  time: number;
  forts: number[];
  ranks: number[];
}

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function makeBrain(spec: string, id: string, rng: () => number): { brain: Brain; level: BotLevel } {
  const cheat = spec.endsWith("+");
  const name = spec.replace(/\+$/, "");
  if (name === "general") return { brain: new GeneralBrain(id, rng), level: cheat ? "brutal" : "hard" };
  if (name === "general-") return { brain: new GeneralBrain(id, rng, { sharp: false }), level: cheat ? "brutal" : "hard" };
  if (!(BOT_LEVELS as string[]).includes(name)) throw new Error(`沒有這個腦袋：${spec}`);
  const level = name as BotLevel;
  // 原本的 brutal 本來就有加成；其他的加 "+" 也給加成
  return { brain: new BotBrain(id, rng, level), level: cheat ? "brutal" : level };
}

export function play(game: Game): Result {
  const state = new BattleState();
  state.mapChoice = game.map;
  game.seats.forEach((_, i) => {
    const p = new Player();
    p.id = `p${i}`;
    p.name = `P${i}`;
    p.faction = i;
    state.players.set(p.id, p);
  });
  const battle = new Battle(state, () => {}, seeded(game.seed));
  battle.start(game.duration);
  const rng = seeded(game.seed * 7 + 3);
  const brains: Brain[] = [];
  game.seats.forEach((spec, i) => {
    const p = state.players.get(`p${i}`)!;
    const { brain, level } = makeBrain(spec, p.id, rng);
    p.isBot = p.wasBot = true;
    p.botLevel = level;
    brains.push(brain);
  });
  const maxSteps = (game.duration > 0 ? game.duration + 5 : 3600) / DT;
  let steps = 0;
  while (state.phase === "playing" && steps < maxSteps) {
    for (const b of brains) b.update(battle, DT);
    battle.step(DT);
    steps++;
  }
  const winner = state.winnerId && state.winnerId !== "draw" ? Number(state.winnerId.slice(1)) : -1;
  return {
    game,
    winner,
    reason: state.endReason || "（沒打完）",
    time: Math.round(state.time),
    forts: game.seats.map((_, i) => state.players.get(`p${i}`)!.forts),
    ranks: game.seats.map((_, i) => state.players.get(`p${i}`)!.rank),
  };
}

// ---------------------------------------------------------------- 子行程：收到一場就打一場
if (process.env.TOURNEY_WORKER) {
  process.on("message", (g: Game) => {
    const r = play(g);
    process.send!(r);
  });
} else {
  const args = new Map<string, string>();
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 2) args.set(argv[i].replace(/^--/, ""), argv[i + 1]);
  const a = args.get("a") ?? "general";
  const b = args.get("b") ?? "brutal";
  const n = Number(args.get("players") ?? 2);
  const rounds = Number(args.get("rounds") ?? 1);
  const seed0 = Number(args.get("seed") ?? 1);
  const jobs = Number(args.get("jobs") ?? 2);
  const duration = Number(args.get("duration") ?? 600);
  const mapArg = args.get("maps") ?? "all";
  const maps = MAPS.filter((m) => m.minPlayers <= n && m.slots >= n).filter((m) => {
    if (mapArg === "all") return true;
    if (mapArg === "classic") return !m.w;
    if (mapArg === "big") return !!m.w;
    return mapArg.split(",").includes(m.id);
  });
  const games: Game[] = [];
  for (let r = 0; r < rounds; r++) {
    for (const m of maps) {
      // 換邊：a 輪流坐每個位置
      for (let seat = 0; seat < (n === 2 ? 2 : n); seat++) {
        const seats = Array.from({ length: n }, (_, i) => (i === seat ? a : b));
        games.push({ map: m.id, seed: seed0 + r * 1000 + games.length, seats, duration });
      }
    }
  }
  const results: Result[] = [];
  const started = Date.now();
  let next = 0;
  await new Promise<void>((done) => {
    let live = 0;
    const self = fileURLToPath(import.meta.url);
    for (let w = 0; w < Math.min(jobs, games.length); w++) {
      const child = fork(self, [], { env: { ...process.env, TOURNEY_WORKER: "1" }, execArgv: ["--import", "tsx"] });
      live++;
      const feed = () => {
        if (next >= games.length) {
          child.kill();
          if (--live === 0) done();
          return;
        }
        child.send(games[next++]);
      };
      child.on("message", (r: Result) => {
        results.push(r);
        const seat = r.game.seats.indexOf(a);
        const mark = r.winner === seat ? "勝" : r.winner < 0 ? "和" : "敗";
        console.log(`${mark} ${r.game.map.padEnd(10)} seed ${String(r.game.seed).padEnd(5)} 位置${seat} ${String(r.time).padStart(4)}s 堡壘 ${r.forts.join("/")}  ${r.reason}`);
        feed();
      });
      feed();
    }
  });
  let win = 0;
  let draw = 0;
  let rankSum = 0;
  const byMap = new Map<string, [number, number]>();
  for (const r of results) {
    const seat = r.game.seats.indexOf(a);
    const w = r.winner === seat;
    if (w) win++;
    if (r.winner < 0) draw++;
    rankSum += r.ranks[seat] || n;
    const m = byMap.get(r.game.map) ?? [0, 0];
    m[0] += w ? 1 : 0;
    m[1] += 1;
    byMap.set(r.game.map, m);
  }
  const lost = [...byMap].filter(([, [w, t]]) => w < t).map(([id, [w, t]]) => `${id} ${w}/${t}`);
  console.log(`\n${a} 對 ${b}（${n} 人）：${results.length} 場，${a} 贏 ${win}、平 ${draw}，勝率 ${((win / results.length) * 100).toFixed(0)}%，平均名次 ${(rankSum / results.length).toFixed(2)}，${((Date.now() - started) / 1000).toFixed(0)} 秒`);
  if (lost.length) console.log(`沒全勝的地圖：${lost.join("、")}`);
}
