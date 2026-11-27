// 前端共用的狀態：目前的房間、選到的據點與部隊、空軍瞄準模式，以及一個簡單的事件匯流排。
import { UNIT_TYPES, type AirKind } from "@frontline/shared";
import type { GameRoom } from "./net";
import type { GameState, PlayerState, UnitState } from "./types";

type UnitStateLike = UnitState;

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
  airMode: null as AirKind | null,
  /** 選到的自己據點（買兵、派兵從這裡） */
  selectedNode: -1,
  /** 要派出的各兵種數量（順序同 UNIT_TYPES）；全部是 0 = 全部派出 */
  picks: UNIT_TYPES.map(() => 0),
  /** 到了目的地據點（或佔下來後）要不要進駐 */
  enter: true,
  /** 從據點派出的特種部隊要獵殺的兵種（"" = 不指定） */
  hunt: "",
  /** 選到的野外部隊（調度、撤退用） */
  selectedUnits: [] as string[],

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
  /** 我在某個據點裡、可以派出的駐軍（不含正在排隊出門的） */
  garrison(node: number): UnitStateLike[] {
    const out: UnitStateLike[] = [];
    this.state?.units.forEach((u) => {
      if (u.owner === this.myId && u.inNode === node && u.mode === "hold" && u.hp > 0) out.push(u);
    });
    return out;
  },
  clearPicks() {
    this.picks = UNIT_TYPES.map(() => 0);
  },
  send(type: string, payload?: unknown) {
    this.room?.send(type, payload ?? {});
  },
};
