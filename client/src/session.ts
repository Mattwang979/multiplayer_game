// 前端共用的狀態：目前的房間、選到的路線、空軍瞄準模式，以及一個簡單的事件匯流排。
import type { AirKind } from "@frontline/shared";
import type { GameRoom } from "./net";
import type { GameState, PlayerState } from "./types";

type Handler = (payload: any) => void;

class Bus {
  private map = new Map<string, Set<Handler>>();
  on(type: string, cb: Handler) {
    if (!this.map.has(type)) this.map.set(type, new Set());
    this.map.get(type)!.add(cb);
    return () => this.map.get(type)?.delete(cb);
  }
  emit(type: string, payload?: unknown) {
    this.map.get(type)?.forEach((cb) => cb(payload));
  }
}

export const bus = new Bus();

export const session = {
  room: null as GameRoom | null,
  selectedLane: -1,
  airMode: null as AirKind | null,

  get state(): GameState | null {
    // 剛連上時 state 還是空殼，等第一次同步完（有 players）才算數
    const st = this.room?.state as GameState | undefined;
    return st && st.players && st.phase ? st : null;
  },
  get myId(): string {
    return this.room?.sessionId ?? "";
  },
  me(): PlayerState | undefined {
    return this.state?.players.get(this.myId);
  },
  playerAtNode(node: number): PlayerState | undefined {
    let found: PlayerState | undefined;
    this.state?.players.forEach((p) => {
      if (p.node === node) found = p;
    });
    return found;
  },
  send(type: string, payload?: unknown) {
    this.room?.send(type, payload ?? {});
  },
};
