// 首頁與大廳（作戰室）
import {
  BOT_LEVELS,
  BOT_LEVEL_DEFS,
  FACTIONS,
  MAPS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  buildMap,
  isBotLevel,
  type BotLevel,
  type Faction,
  type MapDef,
} from "@frontline/shared";
import { isMobile } from "../device";
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

// ---------- 電腦難度 ----------
const LEVEL_KEY = "frontline.botLevel";

/** 上次選的電腦難度（練習和「加入電腦」都用這個） */
export function savedBotLevel(): BotLevel {
  try {
    const v = localStorage.getItem(LEVEL_KEY);
    if (isBotLevel(v)) return v;
  } catch {
    // 無痕模式等情況讀不到就用預設
  }
  return "normal";
}

function saveBotLevel(level: BotLevel) {
  try {
    localStorage.setItem(LEVEL_KEY, level);
  } catch {
    // 存不了就算了
  }
}

/** 四格分段按鈕；extra 會加在每個按鈕上（例如 data-id） */
function levelSeg(current: string, extra: string, label: string) {
  const buttons = BOT_LEVELS.map((lv) => {
    const on = lv === current;
    return `<button type="button" data-level="${lv}" aria-pressed="${on}" title="${BOT_LEVEL_DEFS[lv].short}"${extra}>${BOT_LEVEL_DEFS[lv].name}</button>`;
  }).join("");
  return `<div class="lvl-seg" role="group" aria-label="${label}">${buttons}</div>`;
}

/** 首頁「單人練習」下面的難度選擇 */
export function bindPracticeLevel() {
  const box = $("practice-level");
  const desc = $("practice-level-desc");
  const draw = () => {
    const lv = savedBotLevel();
    box.innerHTML = BOT_LEVELS.map(
      (l) => `<button type="button" data-level="${l}" aria-pressed="${l === lv}">${BOT_LEVEL_DEFS[l].name}</button>`,
    ).join("");
    desc.textContent = BOT_LEVEL_DEFS[lv].short;
  };
  draw();
  box.addEventListener("click", (e) => {
    const el = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-level]");
    if (!el || !isBotLevel(el.dataset.level)) return;
    play("click");
    saveBotLevel(el.dataset.level);
    draw();
  });
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

  const count = s.players.size;
  const choice = s.mapChoice || "random";
  const chosen = MAPS.find((m) => m.id === choice);
  const cap = chosen ? chosen.slots : MAX_PLAYERS; // 這張地圖最多幾方
  const byFaction = new Map<number, PlayerState>();
  s.players.forEach((p) => byFaction.set(p.faction, p));
  const slots = FACTIONS.map((f, i) => {
    const p = byFaction.get(i);
    const style = `style="--fc:${f.css};--fl:${f.light}"`;
    if (!p) {
      // 地圖已經坐滿：空位上鎖，寫清楚這張圖最多幾人
      if (count >= cap) {
        return `<div class="slot empty locked" ${style}>
          <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="5" y="11" width="14" height="10" rx="1"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
          <p class="fname">${f.name}</p>
          <p class="slot-note">${chosen ? `${chosen.name}<br>最多 ${cap} 人` : `最多 ${cap} 人`}</p>
        </div>`;
      }
      const actions = [
        isHost ? `<button class="slot-btn primary" data-act="bot" data-f="${i}">加入電腦</button>` : "",
        me ? `<button class="slot-btn" data-act="color" data-f="${i}">換成這隊</button>` : "",
      ].join("");
      return `<div class="slot empty" ${style}>
        ${emblemSvg(f, 40)}
        <p class="fname">${f.name}</p>
        <p class="slot-note">空位，等朋友加入</p>
        <div class="slot-actions">${actions}</div>
      </div>`;
    }
    const tags = [
      p.id === s.hostId ? '<span class="tag gold">房主</span>' : "",
      p.id === session.myId ? '<span class="tag gold">你</span>' : "",
      p.isBot ? `<span class="tag">電腦${isBotLevel(p.botLevel) && !isHost ? `・${BOT_LEVEL_DEFS[p.botLevel].name}` : ""}</span>` : "",
      !p.connected ? '<span class="tag warn">重新連線中</span>' : "",
    ].join("");
    const canKick = isHost && p.id !== session.myId;
    return `<div class="slot${p.id === session.myId ? " me" : ""}" ${style}>
      ${emblemSvg(f, 40)}
      <p class="fname">${f.name}</p>
      <p class="pname">${esc(p.name)}</p>
      <div class="tags">${tags}</div>
      ${
        p.isBot && isHost && isBotLevel(p.botLevel)
          ? levelSeg(p.botLevel, ` data-act="lvl" data-id="${p.id}"`, `${esc(p.name)} 的難度`) +
            `<p class="lvl-desc">${BOT_LEVEL_DEFS[p.botLevel].short}</p>`
          : ""
      }
      <div class="slot-actions">${canKick ? `<button class="slot-btn" data-act="kick" data-id="${p.id}">${p.isBot ? "移除" : "請離開"}</button>` : ""}</div>
    </div>`;
  }).join("");
  const box = $("lobby-slots");
  if (box.dataset.html !== slots) {
    box.dataset.html = slots;
    box.innerHTML = slots;
  }

  renderMaps(choice, count, isHost);
  const start = $<HTMLButtonElement>("btn-start");
  start.classList.toggle("hidden", !isHost);
  start.disabled = count < MIN_PLAYERS;
  $("lobby-wait").classList.toggle("hidden", isHost);
  const over = count > cap;
  const status = count < MIN_PLAYERS ? "至少要兩方才能開戰" : over ? `${count} 方，這張地圖最多 ${cap} 方` : `${count} / ${cap} 人${isHost ? "・你是房主" : ""}`;
  const hint = $("lobby-hint");
  hint.textContent = status;
  hint.classList.toggle("warn", over || count < MIN_PLAYERS);
}

const previews = new Map<string, string>();

/** 地圖縮圖：地形、道路、據點（大本營是方塊、中立堡壘是灰點） */
function mapPreview(def: MapDef) {
  const cached = previews.get(def.id);
  if (cached) return cached;
  const layout = buildMap(def.id);
  const bg = { grass: "#a9c46c", river: "#a3c26a", desert: "#e2cf97", highland: "#b7c28a" }[def.theme];
  const pts = (p: [number, number][]) => p.map(([x, y]) => `${x},${y}`).join(" ");
  let g = `<rect width="1600" height="1000" fill="${bg}"/>`;
  if (def.river) g += `<polyline points="${pts(def.river)}" fill="none" stroke="#5f9bbd" stroke-width="70" stroke-linejoin="round"/>`;
  for (const [x, y, rx, ry] of def.lakes ?? []) g += `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="#5f9bbd"/>`;
  for (const m of def.mountains ?? []) g += `<polygon points="${pts(m)}" fill="#8d8573" stroke="#5e574a" stroke-width="8"/>`;
  for (const lane of layout.lanes) {
    const line = lane.pts.filter((_, i) => i % 3 === 0 || i === lane.pts.length - 1).map((p) => `${p.x.toFixed(0)},${p.y.toFixed(0)}`).join(" ");
    g += `<polyline points="${line}" fill="none" stroke="#7c6a45" stroke-width="30" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  for (const nd of def.nodes) {
    if (nd.kind === "hq") g += `<rect x="${nd.x - 46}" y="${nd.y - 46}" width="92" height="92" fill="#f2c14e" stroke="#1d1d17" stroke-width="12"/>`;
    else {
      const r = nd.big ? 46 : 30;
      const fill = nd.slot >= 0 ? "#ece4cf" : "#8d887a";
      g += `<circle cx="${nd.x}" cy="${nd.y}" r="${r}" fill="${fill}" stroke="#1d1d17" stroke-width="10"/>`;
    }
  }
  const svg = `<svg viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${g}</svg>`;
  previews.set(def.id, svg);
  return svg;
}

/** 地圖：一次顯示一張大縮圖，左右切換（房主才能換），下面的點也能直接選 */
const MAP_IDS = ["random", ...MAPS.map((m) => m.id)];

function renderMaps(choice: string, count: number, isHost: boolean) {
  const m = MAPS.find((x) => x.id === choice);
  const idx = Math.max(0, MAP_IDS.indexOf(choice));
  const range = m ? (m.minPlayers === m.slots ? `${m.slots} 人` : `${m.minPlayers}–${m.slots} 人`) : "依人數";
  const fits = !m || count <= m.slots;
  const thumb = m ? `<div class="map-thumb">${mapPreview(m)}</div>` : '<div class="map-thumb random"><span>?</span></div>';
  const arrows = isHost
    ? `<button class="map-arrow prev" data-map="${MAP_IDS[(idx - 1 + MAP_IDS.length) % MAP_IDS.length]}" aria-label="上一張地圖"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg></button>
       <button class="map-arrow next" data-map="${MAP_IDS[(idx + 1) % MAP_IDS.length]}" aria-label="下一張地圖"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg></button>`
    : "";
  const dots = MAP_IDS.map((id) => {
    const name = id === "random" ? "隨機" : (MAPS.find((x) => x.id === id)?.name ?? id);
    return `<button class="map-dot${id === choice ? " on" : ""}" data-map="${id}" aria-label="${name}" aria-pressed="${id === choice}"${isHost ? "" : " disabled"}><i></i></button>`;
  }).join("");
  const html = `<div class="map-view">${thumb}${arrows}</div>
    <div class="map-info">
      <div class="map-title"><span class="map-name">${m ? m.name : "隨機地圖"}</span><span class="map-dots">${dots}</span></div>
      <p class="map-desc${fits ? "" : " warn"}">${m ? (fits ? m.desc : `目前 ${count} 方，這張最多 ${m.slots} 方；開戰時會改成隨機`) : "從符合人數的地圖裡抽一張"}</p>
      <p class="map-n">${range}・10 分鐘${isHost ? "" : "・房主選圖"}</p>
    </div>`;
  const box = $("lobby-maps");
  if (box.dataset.html !== html) {
    box.dataset.html = html;
    box.innerHTML = html;
  }
}

export function bindLobbyActions() {
  $("lobby-maps").addEventListener("click", (e) => {
    const el = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-map]");
    if (!el || el.disabled) return;
    play("click");
    session.send("setMap", { map: el.dataset.map });
  });
  $("lobby-slots").addEventListener("click", (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("button[data-act]");
    if (!el) return;
    play("click");
    if (el.dataset.act === "bot") session.send("addBot", { faction: Number(el.dataset.f), level: savedBotLevel() });
    if (el.dataset.act === "lvl" && isBotLevel(el.dataset.level)) {
      saveBotLevel(el.dataset.level);
      session.send("setBotLevel", { id: el.dataset.id, level: el.dataset.level });
    }
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
    const label = $("btn-copy").querySelector("span")!;
    const nav = navigator as Navigator & { share?: (d: { title?: string; text?: string; url?: string }) => Promise<void> };
    if (nav.share && isMobile()) {
      try {
        await nav.share({ title: "前線 Frontline", text: `來《前線》跟我打一場！房間代碼 ${code}`, url: link });
        return;
      } catch {
        // 取消分享就算了，改成複製
      }
    }
    try {
      await navigator.clipboard.writeText(link);
      label.textContent = "已複製連結";
    } catch {
      label.textContent = link;
    }
    setTimeout(() => (label.textContent = "邀請朋友"), 2000);
  });
}
