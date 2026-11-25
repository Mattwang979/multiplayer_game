// 連線：建立／加入房間、重新整理後自動回到原本的房間。
import { Client, type Room } from "@colyseus/sdk";
import { ROOM_NAME } from "@frontline/shared";
import type { GameState } from "./types";

// 開發模式（npm run dev）前端在 5173、伺服器在 2567；上線時同一個網址
const endpoint = import.meta.env.DEV ? `${location.protocol}//${location.hostname}:2567` : location.origin;
export const client = new Client(endpoint);

export type GameRoom = Room<unknown, GameState>;

const TOKEN_KEY = "frontline-reconnect";

export async function createRoom(name: string): Promise<GameRoom> {
  return (await client.create(ROOM_NAME, { name })) as GameRoom;
}

export async function joinRoom(code: string, name: string): Promise<GameRoom> {
  return (await client.joinById(code.trim().toUpperCase(), { name })) as GameRoom;
}

export async function tryReconnect(): Promise<GameRoom | null> {
  const token = sessionStorage.getItem(TOKEN_KEY);
  if (!token) return null;
  try {
    return (await client.reconnect(token)) as GameRoom;
  } catch {
    sessionStorage.removeItem(TOKEN_KEY);
    return null;
  }
}

export function rememberRoom(room: GameRoom) {
  sessionStorage.setItem(TOKEN_KEY, room.reconnectionToken);
}

export function forgetRoom() {
  sessionStorage.removeItem(TOKEN_KEY);
}

export function errorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/not found|找不到|invalid|locked/i.test(msg)) return "找不到這個房間，或這局已經開打了";
  if (/full|已滿/i.test(msg)) return "房間已滿";
  if (/fetch|network|ECONN|Failed/i.test(msg)) return "連不到伺服器，請確認伺服器有在跑";
  return msg;
}
