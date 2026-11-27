// 依難度建立電腦的腦袋：簡單、普通用原本的電腦（Bot.ts），困難、地獄用會估算勝率的將軍（General.ts）。
import type { BotLevel } from "@frontline/shared";
import type { Battle } from "./Battle";
import { BotBrain } from "./Bot";
import { GeneralBrain } from "./General";

export interface Brain {
  update(battle: Battle, dt: number): void;
}

export function makeBrain(playerId: string, level: BotLevel, rng: () => number = Math.random): Brain {
  if (level === "brutal") return new GeneralBrain(playerId, rng);
  if (level === "hard") return new GeneralBrain(playerId, rng, { sharp: false });
  return new BotBrain(playerId, rng, level);
}
