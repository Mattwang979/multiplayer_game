// 對局中的介面：上方玩家血量與計時、下方出兵／空軍／升級按鈕、提示條、工事選單、結算畫面。
import {
  AIRCRAFT,
  AIR_KINDS,
  BUILD_KINDS,
  FACTIONS,
  MAX_UNITS_PER_PLAYER,
  MAX_UPGRADE_LEVEL,
  STRUCTURES,
  UNITS,
  UNIT_TYPES,
  UPGRADES,
  UPGRADE_KINDS,
  WINNER_DRAW,
  buildMap,
  nodeLanes,
  otherEnd,
  type AirKind,
  type MapLayout,
} from "@frontline/shared";
import { initAudio, isMuted, play, toggleMute } from "../game/sound";
import { bus, session } from "../session";
import type { PlayerState } from "../types";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const LANE_KEYS = ["Q", "W"];
const setText = (el: Element, t: string) => {
  if (el.textContent !== t) el.textContent = t;
};

export class Hud {
  private top = $("hud-top");
  private bottom = $("hud-bottom");
  private banner = $("banner");
  private toast = $("toast");
  private feed = $("feed");
  private buildMenu = $("build-menu");
  private targetHint = $("target-hint");
  private result = $("result");
  private map: MapLayout | null = null;
  private mapN = 0;
  private builtFor = "";
  private toastTimer = 0;
  private lastHq = new Map<string, number>();
  private resultShown = false;
  private offs: (() => void)[] = [];
  onLeave: () => void = () => {};

  constructor() {
    this.offs.push(
      bus.on("toast", (t: string) => this.showToast(t)),
      bus.on("banner", (b: { kind: string; text: string; sub?: string; color?: string }) => this.showBanner(b.kind, b.text, b.sub, b.color)),
      bus.on("laneChanged", () => this.refreshLanes()),
      bus.on("airMode", () => this.refreshAir()),
      bus.on("buildMenu", (m: { lane: number; slot: number; x: number; y: number } | null) => this.openBuildMenu(m)),
      bus.on("notice", (m: { text: string }) => {
        this.showToast(m.text);
        play("error", 0.6);
      }),
      bus.on("airIncoming", (m: { side: number; kind: AirKind; lane: number }) => this.onAirIncoming(m)),
      bus.on("eliminated", (m: { name: string; faction: number; by: string; id: string }) => this.onEliminated(m)),
      bus.on("hqAlert", (m: { side: number; level: number }) => this.onHqAlert(m)),
      bus.on("airDown", (m: { kind: AirKind }) => this.addFeed(`${AIRCRAFT[m.kind].name === "空降" ? "運輸機" : "轟炸機"}被擊落！`, "#ff9a5c")),
      bus.on("newBattle", () => this.resetForBattle()),
    );
    window.addEventListener("keydown", this.onKey);
    this.bottom.addEventListener("click", this.onClick);
    this.buildMenu.addEventListener("click", this.onBuildClick);
    this.result.addEventListener("click", this.onResultClick);
  }

  destroy() {
    this.offs.forEach((f) => f());
    window.removeEventListener("keydown", this.onKey);
  }

  resetForBattle() {
    this.builtFor = "";
    this.resultShown = false;
    this.result.classList.add("hidden");
    this.lastHq.clear();
    this.feed.innerHTML = "";
    session.airMode = null;
    session.selectedLane = -1;
  }

  // ================================================================ 每一格更新

  update() {
    const s = session.state;
    const me = session.me();
    if (!s || !me) return;
    if (s.nodeCount !== this.mapN && s.nodeCount >= 2) {
      this.mapN = s.nodeCount;
      this.map = buildMap(s.nodeCount);
    }
    if (!this.map) return;
    const key = `${me.node}:${this.mapN}`;
    if (this.builtFor !== key) this.buildBottom(me);
    this.renderTop(me);
    this.renderBottom(me);

    if (s.phase === "ended" && !this.resultShown) {
      this.resultShown = true;
      setTimeout(() => this.showResult(), 1200);
    }
  }

  private renderTop(me: PlayerState) {
    const s = session.state!;
    const players: PlayerState[] = [];
    s.players.forEach((p) => players.push(p));
    players.sort((a, b) => a.node - b.node);
    const cards = players
      .map((p) => {
        const f = FACTIONS[p.faction];
        const hq = s.structures.get(`hq${p.node}`);
        const ratio = hq ? hq.hp / hq.maxHp : 0;
        const prev = this.lastHq.get(p.id) ?? ratio;
        this.lastHq.set(p.id, ratio);
        const hit = ratio < prev - 0.002;
        const status = !p.alive ? "已出局" : !p.connected ? "斷線・電腦代管" : p.isBot ? "電腦" : "";
        return `<div class="pcard${p.id === me.id ? " me" : ""}${p.alive ? "" : " out"}">
          <p class="pc-name" style="color:${f.light}">${f.name}・${esc(p.name)}${p.id === me.id ? "（你）" : ""}${status ? ` <span style="color:#a89f84;font-weight:500">${status}</span>` : ""}</p>
          <div class="bar${hit ? " hit" : ""}"><i style="width:${(ratio * 100).toFixed(1)}%;background:${f.bar}"></i></div>
        </div>`;
      })
      .join("");
    if (!this.top.querySelector(".pcards")) {
      this.top.innerHTML = `<div class="pcards"></div>
        <div class="timer"><strong></strong><span>剩餘時間</span></div>
        <div class="funds"><strong></strong><span class="fsub"></span> <button class="btn small" data-act="mute" style="min-height:28px"></button></div>`;
      this.top.querySelector<HTMLButtonElement>('[data-act="mute"]')!.onclick = () => toggleMute();
    }
    const pc = this.top.querySelector<HTMLElement>(".pcards")!;
    if (pc.dataset.html !== cards) {
      pc.dataset.html = cards;
      pc.innerHTML = cards;
    }
    const left = Math.max(0, s.duration - s.time);
    const mm = Math.floor(left / 60);
    const ss = Math.floor(left % 60).toString().padStart(2, "0");
    const timer = this.top.querySelector<HTMLElement>(".timer")!;
    timer.classList.toggle("urgent", left < 60);
    setText(timer.querySelector("strong")!, `${mm}:${ss}`);
    setText(this.top.querySelector(".funds strong")!, `$${me.funds.toLocaleString()}`);
    setText(this.top.querySelector(".fsub")!, `軍費 +${me.income.toFixed(1)}/秒・部隊 ${me.unitCount}/${MAX_UNITS_PER_PLAYER}`);
    setText(this.top.querySelector('[data-act="mute"]')!, isMuted() ? "開聲音" : "靜音");
  }

  private buildBottom(me: PlayerState) {
    this.builtFor = `${me.node}:${this.mapN}`;
    const lanes = me.node >= 0 && this.map ? nodeLanes(this.map, me.node) : [];
    if (session.selectedLane < 0 || !lanes.includes(session.selectedLane)) session.selectedLane = lanes[0] ?? -1;
    const laneBtns = lanes
      .map((li, i) => `<button class="lane-btn" data-lane="${li}" aria-label="選擇路線 ${i + 1}"><b>${LANE_KEYS[i]}</b><span data-lane-name="${li}"></span></button>`)
      .join("");
    const units = UNIT_TYPES.map((t) => {
      const d = UNITS[t];
      return `<button class="card" data-unit="${t}" title="${d.short}"><b>${d.hotkey}</b><span class="cn">${d.name}</span><span class="cc">$${d.cost}</span><i class="cd"></i></button>`;
    }).join("");
    const air = AIR_KINDS.map((k) => {
      const d = AIRCRAFT[k];
      return `<button class="card air" data-air="${k}" title="${d.short}"><b>${d.hotkey}</b><span class="cn">${d.name === "空降" ? "空降部隊" : d.name}</span><span class="cc">$${d.cost}</span><i class="cd"></i></button>`;
    }).join("");
    const ups = UPGRADE_KINDS.map((k) => {
      const d = UPGRADES[k];
      return `<button class="card up" data-up="${k}" title="${d.short}"><b>${d.hotkey}</b><span class="cn" data-up-name="${k}">${d.name}</span><span class="cc" data-up-cost="${k}"></span></button>`;
    }).join("");
    this.bottom.innerHTML = `
      <div class="hud-group"><span class="hud-label">出兵路線</span>${laneBtns}</div>
      <div class="hud-group"><span class="hud-label">地面部隊</span>${units}</div>
      <div class="hud-group"><span class="hud-label">空軍</span>${air}</div>
      <div class="hud-group right"><span class="hud-label">升級</span>${ups}</div>`;
    this.refreshLanes();
  }

  private renderBottom(me: PlayerState) {
    const s = session.state!;
    const dead = !me.alive || s.phase !== "playing";
    this.bottom.style.opacity = dead ? "0.5" : "1";
    // 路線名稱：往哪一家打（對方出局後顯示「穿過廢墟」）
    if (this.map) {
      this.bottom.querySelectorAll<HTMLElement>("[data-lane-name]").forEach((el) => {
        const li = Number(el.dataset.laneName);
        const enemy = session.playerAtNode(otherEnd(this.map!.lanes[li], me.node));
        const text = !enemy ? "" : enemy.alive ? `往 ${FACTIONS[enemy.faction].name}` : "穿過廢墟";
        if (el.textContent !== text) el.textContent = text;
      });
    }
    UNIT_TYPES.forEach((t, i) => {
      const el = this.bottom.querySelector<HTMLElement>(`[data-unit="${t}"]`);
      if (!el) return;
      const d = UNITS[t];
      const ready = me.deployReady[i] ?? 0;
      const left = ready - s.time;
      this.cardState(el, me.funds < d.cost, left, d.deployCooldown);
    });
    AIR_KINDS.forEach((k, i) => {
      const el = this.bottom.querySelector<HTMLElement>(`[data-air="${k}"]`);
      if (!el) return;
      const d = AIRCRAFT[k];
      const left = (me.airReady[i] ?? 0) - s.time;
      this.cardState(el, me.funds < d.cost, left, d.cooldown);
      el.classList.toggle("armed", session.airMode === k);
    });
    UPGRADE_KINDS.forEach((k) => {
      const lvl = me[k];
      const name = this.bottom.querySelector<HTMLElement>(`[data-up-name="${k}"]`);
      const cost = this.bottom.querySelector<HTMLElement>(`[data-up-cost="${k}"]`);
      const el = this.bottom.querySelector<HTMLElement>(`[data-up="${k}"]`);
      const max = lvl >= MAX_UPGRADE_LEVEL;
      const price = max ? 0 : UPGRADES[k].costs[lvl];
      const nameText = `${UPGRADES[k].name} Lv${lvl}`;
      const costText = max ? "已滿級" : `升級 $${price}`;
      if (name && name.textContent !== nameText) name.textContent = nameText;
      if (cost && cost.textContent !== costText) cost.textContent = costText;
      el?.classList.toggle("poor", !max && me.funds < price);
    });
  }

  private cardState(el: HTMLElement, poor: boolean, left: number, total: number) {
    el.classList.toggle("poor", poor);
    const cooling = left > 0.05;
    el.classList.toggle("cooling", cooling);
    if (cooling) el.dataset.cd = left >= 10 ? `${Math.ceil(left)}` : left.toFixed(1);
    const bar = el.querySelector<HTMLElement>(".cd");
    if (bar) bar.style.width = cooling ? `${Math.max(0, Math.min(1, 1 - left / total)) * 100}%` : "0%";
  }

  private refreshLanes() {
    this.bottom.querySelectorAll<HTMLElement>("[data-lane]").forEach((el) => {
      el.classList.toggle("active", Number(el.dataset.lane) === session.selectedLane);
    });
  }

  private refreshAir() {
    const mode = session.airMode;
    this.targetHint.classList.toggle("hidden", !mode);
    if (mode) this.targetHint.textContent = `${mode === "bomber" ? "轟炸機" : "運輸機"}待命：點地圖上任一條道路下令，右鍵或 Esc 取消`;
  }

  // ================================================================ 操作

  private onClick = (e: MouseEvent) => {
    initAudio();
    const el = (e.target as HTMLElement).closest<HTMLElement>("button");
    if (!el) return;
    if (el.dataset.lane) this.selectLane(Number(el.dataset.lane));
    else if (el.dataset.unit) this.deploy(el.dataset.unit, el);
    else if (el.dataset.air) this.armAir(el.dataset.air as AirKind);
    else if (el.dataset.up) {
      session.send("upgrade", { kind: el.dataset.up });
      play("click");
    }
  };

  private onKey = (e: KeyboardEvent) => {
    if (session.state?.phase !== "playing") return;
    if ((e.target as HTMLElement)?.tagName === "INPUT") return;
    initAudio();
    const k = e.key.toUpperCase();
    const me = session.me();
    if (!me || !this.map) return;
    if (k === "ESCAPE") {
      session.airMode = null;
      bus.emit("airMode", null);
      this.openBuildMenu(null);
      return;
    }
    const lanes = nodeLanes(this.map, me.node);
    const li = LANE_KEYS.indexOf(k);
    if (li >= 0 && lanes[li] !== undefined) return this.selectLane(lanes[li]);
    if (e.key === "Tab") {
      e.preventDefault();
      const idx = lanes.indexOf(session.selectedLane);
      return this.selectLane(lanes[(idx + 1) % lanes.length]);
    }
    const unit = UNIT_TYPES.find((t) => UNITS[t].hotkey === k);
    if (unit) return this.deploy(unit, this.bottom.querySelector(`[data-unit="${unit}"]`));
    const air = AIR_KINDS.find((a) => AIRCRAFT[a].hotkey === k);
    if (air) return this.armAir(air);
    const up = UPGRADE_KINDS.find((u) => UPGRADES[u].hotkey === k);
    if (up) {
      session.send("upgrade", { kind: up });
      play("click");
    }
    if (k === "M") toggleMute();
  };

  private selectLane(lane: number) {
    session.selectedLane = lane;
    this.refreshLanes();
    bus.emit("laneChanged", lane);
    play("click", 0.6);
  }

  private deploy(type: string, el: HTMLElement | null) {
    if (session.selectedLane < 0) return;
    session.send("spawn", { type, lane: session.selectedLane });
    el?.classList.remove("flash");
    void el?.offsetWidth;
    el?.classList.add("flash");
    play("deploy", 0.7);
  }

  private armAir(kind: AirKind) {
    session.airMode = session.airMode === kind ? null : kind;
    bus.emit("airMode", session.airMode);
    play("click");
  }

  private openBuildMenu(m: { lane: number; slot: number; x: number; y: number } | null) {
    if (!m) {
      this.buildMenu.classList.add("hidden");
      return;
    }
    const me = session.me();
    this.buildMenu.innerHTML =
      `<p>蓋工事</p>` +
      BUILD_KINDS.map((k) => {
        const d = STRUCTURES[k];
        const poor = (me?.funds ?? 0) < d.cost;
        return `<button data-build="${k}" data-lane="${m.lane}" data-slot="${m.slot}"${poor ? ' style="opacity:.6"' : ""}><span>${d.name}<br><small style="color:#a89f84;font-weight:500">${d.short}</small></span><em>$${d.cost}</em></button>`;
      }).join("");
    const w = 220;
    this.buildMenu.style.left = `${Math.min(window.innerWidth - w - 8, m.x + 12)}px`;
    this.buildMenu.style.top = `${Math.max(8, Math.min(window.innerHeight - 220, m.y - 40))}px`;
    this.buildMenu.classList.remove("hidden");
  }

  private onBuildClick = (e: MouseEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("button[data-build]");
    if (!el) return;
    session.send("build", { kind: el.dataset.build, lane: Number(el.dataset.lane), slot: Number(el.dataset.slot) });
    this.buildMenu.classList.add("hidden");
    play("deploy", 0.7);
  };

  // ================================================================ 提示

  showToast(text: string) {
    this.toast.textContent = text;
    this.toast.classList.add("show");
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toast.classList.remove("show"), 1800);
  }

  showBanner(kind: string, text: string, sub?: string, color?: string) {
    const div = document.createElement("div");
    div.className = `b ${kind}`;
    if (color) div.style.setProperty("--fc", color);
    div.innerHTML = `${text}${sub ? `<small>${sub}</small>` : ""}`;
    this.banner.innerHTML = "";
    this.banner.appendChild(div);
    setTimeout(() => div.remove(), 2800);
  }

  addFeed(text: string, color = "#f2c14e") {
    const p = document.createElement("p");
    p.style.borderLeftColor = color;
    p.textContent = text;
    this.feed.prepend(p);
    while (this.feed.children.length > 5) this.feed.lastElementChild?.remove();
    setTimeout(() => p.remove(), 7000);
  }

  private onAirIncoming(m: { side: number; kind: AirKind; lane: number }) {
    const me = session.me();
    const from = session.playerAtNode(m.side);
    if (!me || !from || !this.map) return;
    const name = m.kind === "bomber" ? "轟炸機" : "運輸機";
    if (m.side === me.node) {
      this.addFeed(`${name}起飛！`, FACTIONS[from.faction].light);
      return;
    }
    const lane = this.map.lanes[m.lane];
    const threatened = lane && (lane.a === me.node || lane.b === me.node);
    if (threatened) {
      this.showBanner("red", m.kind === "bomber" ? "空襲警報！" : "敵軍空降！", `${FACTIONS[from.faction].name}的${name}來了`);
      play("siren", 0.8);
    } else {
      this.addFeed(`${FACTIONS[from.faction].name}出動${name}`, FACTIONS[from.faction].light);
    }
  }

  private onEliminated(m: { name: string; faction: number; by: string; id: string }) {
    const f = FACTIONS[m.faction];
    if (m.id === session.myId) {
      this.showBanner("red", "指揮部淪陷", "你已出局，可以繼續觀戰");
    } else {
      this.showBanner("dark", `<s>${f.name}</s>`, m.by ? `被 ${esc(m.by)} 殲滅` : "已被殲滅", f.light);
    }
    this.addFeed(`${f.name}（${m.name}）出局`, f.light);
  }

  private onHqAlert(m: { side: number; level: number }) {
    const me = session.me();
    const p = session.playerAtNode(m.side);
    if (!p) return;
    if (me && m.side === me.node) {
      this.showBanner("red", m.level >= 2 ? "指揮部岌岌可危！" : "指揮部遭受猛攻！", m.level >= 2 ? "血量剩不到 25%" : "血量剩一半");
      play("siren", 0.6);
    } else {
      this.addFeed(`${FACTIONS[p.faction].name}指揮部血量剩${m.level >= 2 ? "不到 25%" : "一半"}`, FACTIONS[p.faction].light);
    }
  }

  // ================================================================ 結算

  private showResult() {
    const s = session.state;
    const me = session.me();
    if (!s || !me) return;
    const win = s.winnerId === me.id;
    const draw = s.winnerId === WINNER_DRAW;
    const title = draw ? "平手" : win ? "勝利" : "戰敗";
    const players: PlayerState[] = [];
    s.players.forEach((p) => players.push(p));
    players.sort((a, b) => (a.rank || 9) - (b.rank || 9));
    const rows = players
      .map((p) => {
        const f = FACTIONS[p.faction];
        return `<tr><td class="rank">${p.rank || "-"}</td><td style="color:${f.light};font-weight:900">${f.name}</td><td>${esc(p.name)}${p.id === me.id ? "（你）" : ""}</td><td>${p.kills}</td><td>${p.deployed}</td><td>$${p.spent.toLocaleString()}</td></tr>`;
      })
      .join("");
    const isHost = s.hostId === me.id;
    this.result.innerHTML = `<div class="result-box">
      <h2 class="${win ? "" : "lose"}">${title}</h2>
      <p class="reason">${esc(s.endReason)}</p>
      <table><thead><tr><th>名次</th><th>陣營</th><th>指揮官</th><th>擊殺</th><th>出兵</th><th>花費</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="actions">
        ${isHost ? '<button class="btn primary" data-act="again">回到作戰室再戰</button>' : '<p style="margin:0;color:#a89f84">等房主開下一局…</p>'}
        <button class="btn" data-act="leave">離開房間</button>
      </div>
    </div>`;
    this.result.classList.remove("hidden");
    play(win ? "deploy" : "error", 1);
  }

  private onResultClick = (e: MouseEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("button[data-act]");
    if (!el) return;
    if (el.dataset.act === "again") session.send("backToLobby");
    if (el.dataset.act === "leave") this.onLeave();
  };
}
