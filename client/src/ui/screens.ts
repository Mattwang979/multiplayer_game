// 首頁與大廳（作戰室）
import { FACTIONS, MAX_PLAYERS, MIN_PLAYERS, type Faction } from "@frontline/shared";
import { play } from "../game/sound";
import { session } from "../session";
import type { PlayerState } from "../types";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function emblemSvg(f: Faction, size = 56) {
  const mark = f.mark;
  let shape = "";
  if (f.emblem === "cross") shape = `<path d="M-4 -11 h8 v7 h7 v8 h-7 v7 h-8 v-7 h-7 v-8 h7 z" fill="${mark}"/>`;
  else if (f.emblem === "triangle") shape = `<polygon points="0,-11 11,8 -11,8" fill="${mark}"/>`;
  else if (f.emblem === "star") shape = `<polygon points="0,-12 3,-4 11,-4 5,1 7,9 0,4 -7,9 -5,1 -11,-4 -3,-4" fill="${mark}"/>`;
  else shape = `<circle r="8" fill="none" stroke="${mark}" stroke-width="4"/>`;
  return `<svg class="emblem" viewBox="-20 -20 40 40" width="${size}" height="${size}" aria-hidden="true"><circle r="18" fill="${f.css}" stroke="#1d1d17" stroke-width="2.5"/>${shape}</svg>`;
}

export function showScreen(id: "home" | "lobby" | "game") {
  for (const s of ["home", "lobby", "game"]) $(`screen-${s}`).classList.toggle("hidden", s !== id);
}

export function homeError(text: string) {
  $("home-error").textContent = text;
}

/** 依照房間狀態重畫大廳 */
export function renderLobby() {
  const s = session.state;
  const room = session.room;
  if (!s || !room) return;
  const me = session.me();
  const isHost = s.hostId === session.myId;
  $("lobby-code").textContent = room.roomId;

  const byFaction = new Map<number, PlayerState>();
  s.players.forEach((p) => byFaction.set(p.faction, p));
  const slots = FACTIONS.map((f, i) => {
    const p = byFaction.get(i);
    if (!p) {
      const actions = [
        isHost ? `<button class="btn small" data-act="bot" data-f="${i}">加入電腦</button>` : "",
        me ? `<button class="btn small" data-act="color" data-f="${i}">換成這隊</button>` : "",
      ].join("");
      return `<div class="slot empty" style="--fc:${f.css}">
        ${emblemSvg(f, 44)}
        <p class="fname" style="color:${f.light}">${f.name}</p>
        <p style="margin:0">空位</p>
        <div class="slot-actions" style="margin-top:6px;justify-content:center">${actions}</div>
      </div>`;
    }
    const tags = [
      p.id === s.hostId ? '<span class="tag gold">房主</span>' : "",
      p.id === session.myId ? '<span class="tag gold">你</span>' : "",
      p.isBot ? '<span class="tag">電腦</span>' : "",
      !p.connected ? '<span class="tag">重新連線中</span>' : "",
    ].join("");
    const canKick = isHost && p.id !== session.myId;
    return `<div class="slot" style="--fc:${f.css}">
      ${emblemSvg(f)}
      <p class="fname" style="color:${f.light}">${f.name}</p>
      <p class="pname">${esc(p.name)}</p>
      <div class="tags">${tags}</div>
      <div class="slot-actions">${canKick ? `<button class="btn small" data-act="kick" data-id="${p.id}">${p.isBot ? "移除電腦" : "請離開"}</button>` : ""}</div>
    </div>`;
  }).join("");
  const box = $("lobby-slots");
  if (box.dataset.html !== slots) {
    box.dataset.html = slots;
    box.innerHTML = slots;
  }

  const count = s.players.size;
  const start = $<HTMLButtonElement>("btn-start");
  start.classList.toggle("hidden", !isHost);
  start.disabled = count < MIN_PLAYERS;
  const hint = isHost
    ? count < MIN_PLAYERS
      ? "至少要兩方才能開戰。把代碼傳給朋友，或按「加入電腦」補空位。"
      : `目前 ${count} 方，最多 ${MAX_PLAYERS} 方。3 方以上的混戰最好玩：旁邊兩家打得越凶，你越有機會撿便宜。`
    : "等房主開戰。可以先換一個喜歡的陣營顏色。";
  $("lobby-hint").innerHTML = `${hint}<br><span style="color:#cfc5a8">操作：Q / W 選路線、1–5 出兵、B 轟炸、P 空降、Z / X / C 升級、點路邊的 ＋ 蓋工事。</span>`;
}

export function bindLobbyActions() {
  $("lobby-slots").addEventListener("click", (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("button[data-act]");
    if (!el) return;
    play("click");
    if (el.dataset.act === "bot") session.send("addBot", { faction: Number(el.dataset.f) });
    if (el.dataset.act === "color") session.send("setFaction", { faction: Number(el.dataset.f) });
    if (el.dataset.act === "kick") session.send("removePlayer", { id: el.dataset.id });
  });
  $("btn-start").addEventListener("click", () => {
    play("click");
    session.send("start");
  });
  $("btn-copy").addEventListener("click", async () => {
    const code = session.room?.roomId ?? "";
    const link = `${location.origin}${location.pathname}?room=${code}`;
    try {
      await navigator.clipboard.writeText(link);
      $("btn-copy").textContent = "已複製！";
    } catch {
      $("btn-copy").textContent = link;
    }
    setTimeout(() => ($("btn-copy").textContent = "複製邀請連結"), 2000);
  });
}
