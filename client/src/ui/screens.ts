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
      p.isBot ? `<span class="tag">電腦${p.botLevel && isBotLevel(p.botLevel) && !isHost ? `・${BOT_LEVEL_DEFS[p.botLevel].name}` : ""}</span>` : "",
      !p.connected ? '<span class="tag">重新連線中</span>' : "",
    ].join("");
    const canKick = isHost && p.id !== session.myId;
    return `<div class="slot" style="--fc:${f.css}">
      ${emblemSvg(f)}
      <p class="fname" style="color:${f.light}">${f.name}</p>
      <p class="pname">${esc(p.name)}</p>
      <div class="tags">${tags}</div>
      ${
        p.isBot && isHost && isBotLevel(p.botLevel)
          ? levelSeg(p.botLevel, ` data-act="lvl" data-id="${p.id}"`, `${esc(p.name)} 的難度`) +
            `<p class="lvl-desc">${BOT_LEVEL_DEFS[p.botLevel].short}</p>`
          : ""
      }
      <div class="slot-actions">${canKick ? `<button class="btn small" data-act="kick" data-id="${p.id}">${p.isBot ? "移除電腦" : "請離開"}</button>` : ""}</div>
    </div>`;
  }).join("");
  const box = $("lobby-slots");
  if (box.dataset.html !== slots) {
    box.dataset.html = slots;
    box.innerHTML = slots;
  }

  const count = s.players.size;
  renderMaps(s.mapChoice || "random", count, isHost);
  const start = $<HTMLButtonElement>("btn-start");
  start.classList.toggle("hidden", !isHost);
  start.disabled = count < MIN_PLAYERS;
  const hint = isHost
    ? count < MIN_PLAYERS
      ? "至少要兩方才能開戰。把代碼傳給朋友，或按「加入電腦」補空位。"
      : `目前 ${count} 方，最多 ${MAX_PLAYERS} 方。3 方以上的混戰最好玩：旁邊兩家打得越凶，你越有機會撿便宜。`
    : "等房主開戰。可以先換一個喜歡的陣營顏色。";
  $("lobby-hint").innerHTML = `${hint}<br><span style="color:#cfc5a8">操作：點自己的據點選它，用數字鍵或面板買兵（兵會駐紮在據點裡回血；每支兵都要養兵費，囤在據點裡越多越貴）；從據點拖到道路或別的據點就派兵，拖曳經過的據點會變成必經點。點自己的部隊可以選整隊，再拖曳或點目的地調度，R 撤退。滾輪或兩指縮放戰場、拖空地移動畫面。B 轟炸、P 空降、Z / X / C 升級、點路邊的 ＋ 蓋工事（要施工，工兵在旁邊會比較快）。佔下的堡壘可以改建成砲台、兵營、補給站、防空要塞或野戰醫院。每隔一陣子會發生隨機事件。攻破堡壘後派兵在旁邊站 3 秒就能佔領；堡壘最多的人會被懸賞。</span>`;
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

function renderMaps(choice: string, count: number, isHost: boolean) {
  const cards = [
    `<button class="map-card${choice === "random" ? " on" : ""}" data-map="random"${isHost ? "" : " disabled"}>
      <div class="map-thumb random"><span>?</span></div>
      <p class="map-name">隨機</p>
      <p class="map-desc">從符合人數的地圖裡抽一張</p>
    </button>`,
    ...MAPS.map((m) => {
      const fits = count <= m.slots;
      const range = m.minPlayers === m.slots ? `${m.slots} 人` : `${m.minPlayers}–${m.slots} 人`;
      return `<button class="map-card${choice === m.id ? " on" : ""}${fits ? "" : " nofit"}" data-map="${m.id}"${isHost ? "" : " disabled"}>
        <div class="map-thumb">${mapPreview(m)}</div>
        <p class="map-name">${m.name} <span class="map-n">${range}</span></p>
        <p class="map-desc">${fits ? m.desc : `目前 ${count} 方，這張最多 ${m.slots} 方；開戰時會改成隨機`}</p>
      </button>`;
    }),
  ].join("");
  const box = $("lobby-maps");
  if (box.dataset.html !== cards) {
    box.dataset.html = cards;
    box.innerHTML = cards;
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
    try {
      await navigator.clipboard.writeText(link);
      $("btn-copy").textContent = "已複製！";
    } catch {
      $("btn-copy").textContent = link;
    }
    setTimeout(() => ($("btn-copy").textContent = "複製邀請連結"), 2000);
  });
}
