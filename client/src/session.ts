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

export interface Route {
  node: number; // 從哪個據點出兵
  lane: number; // 走哪條路
}

export const session = {
  room: null as GameRoom | null,
  route: null as Route | null,
  airMode: null as AirKind | null,

  get state(): GameState | null {
    // 剛連上時 state 還是空殼，等第一次同步完（有 players）才算數
    const st = this.room?.state as GameState | undefined;
    return st && st.players && st.phase && st.nodes ? st : null;
  },
  get myId(): string {
    return this.room?.sessionId ?? "";
  },
  me(): PlayerState | undefined {
    return this.state?.players.get(this.myId);
  },
  /** 這個據點目前屬於誰（無主或被攻破回傳 undefined） */
  ownerOf(node: number): PlayerState | undefined {
    const n = this.state?.nodes[node];
    if (!n || !n.owner || n.hp <= 0) return undefined;
    return this.state?.players.get(n.owner);
  },
  ownsNode(node: number): boolean {
    const n = this.state?.nodes[node];
    return !!n && n.owner === this.myId && n.hp > 0;
  },
  send(type: string, payload?: unknown) {
    this.room?.send(type, payload ?? {});
  },
};
