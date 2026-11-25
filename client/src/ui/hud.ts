// 對局中的介面：上方玩家血量與計時、下方據點面板（買兵、選派出數量）／空軍／升級、
// 選到部隊時的指令列（撤退、進駐）、提示條、工事選單、結算畫面。
import {
  AIRCRAFT,
  AIR_KINDS,
  BUILD_KINDS,
  FACTIONS,
  GARRISON_CAP,
  MAX_UPGRADE_LEVEL,
  POP_CAP,
  STRUCTURES,
  UNITS,
  UNIT_TYPES,
  UPGRADES,
  UPGRADE_KINDS,
  WINNER_DRAW,
  buildMap,
  type AirKind,
  type MapLayout,
  type UnitType,
} from "@frontline/shared";
import { enterFullscreen, exitFullscreen, isFullscreen, isMobile, isStandalone } from "../device";
import { initAudio, isMusicOn, isMuted, play, setMusicIntensity, stopMusic, toggleMusic, toggleMute } from "../game/sound";
import { bus, session } from "../session";
import type { PlayerState, UnitState } from "../types";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const svg = (d: string) => `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICON_SOUND = svg('<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/><path d="M19 6a8.5 8.5 0 0 1 0 12"/>');
const ICON_MUTED = svg('<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9l5 6M22 9l-5 6"/>');
const ICON_MUSIC = svg('<path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>');
const ICON_MUSIC_OFF = svg('<path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/><path d="M3 3l18 18"/>');
const ICON_FS = svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>');
const ICON_FS_EXIT = svg('<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>');
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
  private groupBar = $("group-bar");
  private targetHint = $("target-hint");
  private result = $("result");
  private map: MapLayout | null = null;
  private mapId = "";
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
      bus.on("nodeSelected", () => play("click", 0.4)),
      bus.on("leader", (m: { id: string; faction: number }) => this.onLeader(m)),
      bus.on("airMode", () => this.refreshAir()),
      bus.on("buildMenu", (m: { lane: number; node: number; slot: number; x: number; y: number } | null) => this.openBuildMenu(m)),
      bus.on("notice", (m: { text: string }) => {
        this.showToast(m.text);
        play("error", 0.6);
      }),
      bus.on("airIncoming", (m: { owner: string; faction: number; kind: AirKind; lane: number }) => this.onAirIncoming(m)),
      bus.on("eliminated", (m: { name: string; faction: number; by: string; id: string }) => this.onEliminated(m)),
      bus.on("hqAlert", (m: { owner: string; level: number }) => this.onHqAlert(m)),
      bus.on("captured", (m: { node: number; by: string; faction: number }) => this.onCaptured(m)),
      bus.on("fortFallen", (m: { node: number; owner: string; faction: number; by: string }) => this.onFortFallen(m)),
      bus.on("airDown", (m: { kind: AirKind }) => this.addFeed(`${AIRCRAFT[m.kind].name === "空降" ? "運輸機" : "轟炸機"}被擊落！`, "#ff9a5c")),
      bus.on("newBattle", () => this.resetForBattle()),
    );
    window.addEventListener("keydown", this.onKey);
    this.bottom.addEventListener("click", this.onClick);
    this.bottom.addEventListener("contextmenu", this.onContext);
    this.buildMenu.addEventListener("click", this.onBuildClick);
    this.groupBar.addEventListener("click", this.onGroupClick);
    this.result.addEventListener("click", this.onResultClick);
    $("target-cancel").addEventListener("click", () => {
      session.airMode = null;
      bus.emit("airMode", null);
    });
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
    this.hpSeen.clear();
    this.hurtUntil = 0;
    this.feed.innerHTML = "";
    session.airMode = null;
    session.selectedNode = -1;
    session.selectedUnits = [];
    session.enter = true;
    session.clearPicks();
    this.groupBar.classList.add("hidden");
  }

  // ================================================================ 每一格更新

  update() {
    const s = session.state;
    const me = session.me();
    if (!s || !me) return;
    if (!s.mapId) return;
    if (s.mapId !== this.mapId) {
      this.mapId = s.mapId;
      this.map = buildMap(s.mapId);
    }
    if (!this.map) return;
    if (this.builtFor !== this.mapId) this.buildBottom();
    this.ensureSelection(me);
    this.renderTop(me);
    this.renderBottom(me);
    this.renderGroupBar();

    this.updateMusic(me);
    if (s.phase === "ended" && !this.resultShown) {
      this.resultShown = true;
      stopMusic(1);
      setTimeout(() => this.showResult(), 1200);
    }
  }

  /** 配樂強度：平時 0；開打一陣子、自己的據點掉血 → 1；大本營危急或最後一分半 → 2 */
  private hpSeen = new Map<number, number>();
  private hurtUntil = 0;
  private updateMusic(me: PlayerState) {
    const s = session.state!;
    if (s.phase !== "playing") return;
    for (let i = 0; i < s.nodes.length; i++) {
      const n = s.nodes[i];
      if (!n || n.owner !== me.id) {
        this.hpSeen.delete(i);
        continue;
      }
      const prev = this.hpSeen.get(i);
      if (prev !== undefined && n.hp < prev - 1) this.hurtUntil = s.time + 8;
      this.hpSeen.set(i, n.hp);
    }
    const hq = me.hq >= 0 ? s.nodes[me.hq] : undefined;
    const hqRatio = hq && hq.owner === me.id ? hq.hp / hq.maxHp : 1;
    let level = s.time > 150 || s.time < this.hurtUntil ? 1 : 0;
    if (hqRatio < 0.5 || s.duration - s.time < 90) level = 2;
    if (!me.alive) level = 0;
    setMusicIntensity(level);
  }

  private renderTop(me: PlayerState) {
    const s = session.state!;
    const players: PlayerState[] = [];
    s.players.forEach((p) => players.push(p));
    players.sort((a, b) => a.faction - b.faction);
    const cards = players
      .map((p) => {
        const f = FACTIONS[p.faction];
        const hq = p.alive && p.hq >= 0 ? s.nodes[p.hq] : undefined;
        const ratio = hq && hq.owner === p.id ? hq.hp / hq.maxHp : 0;
        const prev = this.lastHq.get(p.id) ?? ratio;
        this.lastHq.set(p.id, ratio);
        const hit = ratio < prev - 0.002;
        const status = !p.alive ? "已出局" : !p.connected ? "斷線・電腦代管" : p.isBot ? "電腦" : "";
        return `<div class="pcard${p.id === me.id ? " me" : ""}${p.alive ? "" : " out"}">
          <p class="pc-name" style="color:${f.light}"><span class="pc-f">${f.name}・</span>${esc(p.name)}${p.id === me.id ? "（你）" : ""}${status ? ` <span class="pc-status">${status}</span>` : ""}</p>
          <div class="pc-row"><div class="bar${hit ? " hit" : ""}"><i style="width:${(ratio * 100).toFixed(1)}%;background:${f.bar}"></i></div>${p.alive ? `<span class="pc-forts" title="擁有的堡壘數">${p.id === s.leaderId ? '<em class="pc-bounty" title="堡壘最多：被懸賞中">懸賞</em>' : ""}堡 ${p.forts}</span>` : ""}</div>
        </div>`;
      })
      .join("");
    if (!this.top.querySelector(".pcards")) {
      this.top.innerHTML = `<div class="pcards"></div>
        <div class="timer"><strong></strong><span>剩餘時間</span></div>
        <div class="funds"><strong></strong><span class="fsub"></span>
          <span class="top-btns"><button class="btn small icon" data-act="music" aria-label="關配樂"></button><button class="btn small icon" data-act="mute" aria-label="靜音"></button><button class="btn small icon" data-act="fs" aria-label="全螢幕"></button></span></div>`;
      this.top.querySelector<HTMLButtonElement>('[data-act="mute"]')!.onclick = () => toggleMute();
      this.top.querySelector<HTMLButtonElement>('[data-act="music"]')!.onclick = () => toggleMusic();
      this.top.querySelector<HTMLButtonElement>('[data-act="fs"]')!.onclick = async () => {
        if (isFullscreen()) {
          await exitFullscreen();
          return;
        }
        const tip = await enterFullscreen();
        if (tip) this.showToast(tip, 5000);
      };
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
    const net = me.income - me.upkeep;
    setText(
      this.top.querySelector(".fsub")!,
      isMobile()
        ? `${net >= 0 ? "+" : ""}${net.toFixed(1)}/秒`
        : `收入 +${me.income.toFixed(1)}・養兵 -${me.upkeep.toFixed(1)}/秒・兵力 ${me.pop}/${POP_CAP}`,
    );
    this.top.querySelector(".fsub")!.classList.toggle("warn", me.upkeep >= me.income * 0.5 && me.upkeep > 0);
    const mute = this.top.querySelector<HTMLElement>('[data-act="mute"]')!;
    const muteKey = isMuted() ? "off" : "on";
    if (mute.dataset.state !== muteKey) {
      mute.dataset.state = muteKey;
      mute.innerHTML = muteKey === "on" ? ICON_SOUND : ICON_MUTED;
      mute.setAttribute("aria-label", muteKey === "on" ? "靜音" : "開聲音");
    }
    const music = this.top.querySelector<HTMLElement>('[data-act="music"]')!;
    const musicKey = isMusicOn() ? "on" : "off";
    if (music.dataset.state !== musicKey) {
      music.dataset.state = musicKey;
      music.innerHTML = musicKey === "on" ? ICON_MUSIC : ICON_MUSIC_OFF;
      music.setAttribute("aria-label", musicKey === "on" ? "關配樂" : "開配樂");
    }
    const fs = this.top.querySelector<HTMLElement>('[data-act="fs"]')!;
    fs.classList.toggle("hidden", isStandalone());
    const fsKey = document.fullscreenElement ? "exit" : "enter";
    if (fs.dataset.state !== fsKey) {
      fs.dataset.state = fsKey;
      fs.innerHTML = fsKey === "enter" ? ICON_FS : ICON_FS_EXIT;
      fs.setAttribute("aria-label", fsKey === "enter" ? "全螢幕" : "離開全螢幕");
    }
  }

  private buildBottom() {
    this.builtFor = this.mapId;
    const units = UNIT_TYPES.map((t) => {
      const d = UNITS[t];
      return `<div class="ucard" data-type="${t}" title="${d.name}：${d.short}（人口 ${d.pop}）">
        <button class="ubuy" data-buy="${t}"><b>${d.hotkey}</b><span class="cn">${d.name}</span><span class="cc">$${d.cost}</span></button>
        <button class="upick" data-pick="${t}" aria-label="選要派出幾支${d.name}"><span class="pk-n">0</span><span class="pk-of">/0</span></button>
      </div>`;
    }).join("");
    const air = AIR_KINDS.map((k) => {
      const d = AIRCRAFT[k];
      return `<button class="card air" data-air="${k}" title="${d.short}"><b>${d.hotkey}</b><span class="cn">${d.name === "空降" ? "空降部隊" : d.name}</span><span class="cc">$${d.cost}</span><i class="cd"></i></button>`;
    }).join("");
    const ups = UPGRADE_KINDS.map((k) => {
      const d = UPGRADES[k];
      return `<button class="card up" data-up="${k}" title="${d.short}"><b>${d.hotkey}</b><span class="cn" data-up-name="${k}">${d.name}</span><span class="cc" data-up-cost="${k}"></span></button>`;
    }).join("");
    // 桌機：一整排在下方；手機橫向：左欄（據點、空軍、升級）+ 右欄（買兵、選數量），由 CSS 切換
    this.bottom.innerHTML = `
      <div class="hud-col left">
        <div class="hud-group g-fort"><span class="hud-label">據點</span>
          <div class="fort-box">
            <div class="fort-head"><p class="fort-name" data-fort-name></p><p class="fort-sub" data-fort-sub></p></div>
            <div class="fort-ctl">
              <button class="fort-toggle" data-act="enter" aria-pressed="true"></button>
              <button data-act="pick-all">全選</button>
              <button data-act="pick-none">清除</button>
            </div>
            <p class="fort-tip">${isMobile() ? "從據點拖到目的地派兵" : "從據點拖到目的地派兵・沒選數量＝全部派出"}</p>
          </div>
        </div>
        <div class="hud-group g-air"><span class="hud-label">空軍</span>${air}</div>
        <div class="hud-group g-ups"><span class="hud-label">升級</span>
          <button class="card ups-toggle" data-act="ups"><span class="cn">升級</span><span class="cc" data-ups-lv></span></button>
          <div class="ups-pop">${ups}</div>
        </div>
      </div>
      <div class="hud-col right">
        <div class="hud-group g-units"><span class="hud-label">買兵<br>派出數量</span>${units}</div>
      </div>`;
  }

  /** 選到的據點丟了就換回大本營；選到的部隊死了或進駐了就移出選取 */
  private ensureSelection(me: PlayerState) {
    const s = session.state!;
    if (!session.ownsNode(session.selectedNode)) {
      let next = session.ownsNode(me.hq) ? me.hq : -1;
      if (next < 0) for (let i = 0; i < s.nodes.length; i++) if (session.ownsNode(i)) { next = i; break; }
      session.selectedNode = next;
      session.clearPicks();
    }
    if (session.selectedUnits.length) {
      const alive = session.selectedUnits.filter((id) => {
        const u = s.units.get(id);
        return !!u && u.inNode < 0 && u.owner === me.id;
      });
      if (alive.length !== session.selectedUnits.length) {
        session.selectedUnits = alive;
        bus.emit("unitsSelected", alive);
      }
    }
  }

  private renderBottom(me: PlayerState) {
    const s = session.state!;
    const dead = !me.alive || s.phase !== "playing";
    this.bottom.style.opacity = dead ? "0.5" : "1";
    const node = session.selectedNode;
    const n = node >= 0 ? s.nodes[node] : undefined;
    const inside = node >= 0 ? session.garrison(node) : [];
    const have = UNIT_TYPES.map((t) => inside.filter((u) => u.type === t).length);
    // 選的數量不能超過駐軍
    UNIT_TYPES.forEach((_, i) => {
      if (session.picks[i] > have[i]) session.picks[i] = have[i];
    });
    let used = 0;
    s.units.forEach((u) => {
      if (u.owner === me.id && u.inNode === node) used += UNITS[u.type as UnitType]?.pop ?? 1;
    });
    const cap = n ? GARRISON_CAP[n.kind] ?? GARRISON_CAP.fort : 0;
    setText(this.bottom.querySelector("[data-fort-name]")!, node >= 0 ? this.nodeName(node) : "沒有據點");
    const grace = n ? Math.ceil(n.incomeAt - s.time) : 0;
    setText(this.bottom.querySelector("[data-fort-sub]")!, n ? `駐軍 ${used}/${cap}${grace > 0 ? `・整頓 ${grace}s` : ""}` : "");
    const tog = this.bottom.querySelector<HTMLElement>('[data-act="enter"]')!;
    setText(tog, session.enter ? "佔領後進駐 ✓" : "佔領後進駐 ✗");
    tog.classList.toggle("on", session.enter);
    tog.setAttribute("aria-pressed", String(session.enter));

    UNIT_TYPES.forEach((t, i) => {
      const card = this.bottom.querySelector<HTMLElement>(`.ucard[data-type="${t}"]`);
      if (!card) return;
      const d = UNITS[t];
      const full = used + d.pop > cap || me.pop + d.pop > POP_CAP;
      card.classList.toggle("poor", me.funds < d.cost);
      card.classList.toggle("full", full);
      card.classList.toggle("has", have[i] > 0);
      card.classList.toggle("picked", session.picks[i] > 0);
      setText(card.querySelector(".pk-n")!, `${session.picks[i]}`);
      setText(card.querySelector(".pk-of")!, `/${have[i]}`);
    });
    AIR_KINDS.forEach((k, i) => {
      const el = this.bottom.querySelector<HTMLElement>(`[data-air="${k}"]`);
      if (!el) return;
      const d = AIRCRAFT[k];
      const left = (me.airReady[i] ?? 0) - s.time;
      this.cardState(el, me.funds < d.cost, left, d.cooldown);
      el.classList.toggle("armed", session.airMode === k);
    });
    const lv = this.bottom.querySelector<HTMLElement>("[data-ups-lv]");
    if (lv) setText(lv, `Lv ${me.firepower}/${me.armor}/${me.logistics}`);
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

  /** 選到部隊時的指令列 */
  private renderGroupBar() {
    const s = session.state!;
    const ids = session.selectedUnits;
    const bar = this.groupBar;
    if (!ids.length || s.phase !== "playing") {
      bar.classList.add("hidden");
      return;
    }
    const units = ids.map((id) => s.units.get(id)).filter((u): u is UnitState => !!u);
    const byType = new Map<string, number>();
    units.forEach((u) => byType.set(u.type, (byType.get(u.type) ?? 0) + 1));
    const desc = [...byType.entries()].map(([t, c]) => `${UNITS[t as UnitType]?.name ?? t}×${c}`).join("、");
    const first = units[0];
    let where = "";
    if (first) {
      if (first.mode === "retreat") where = "撤退中";
      else if (first.destNode >= 0) where = `${first.mode === "hold" ? "守在" : "前往"} ${this.nodeName(first.destNode)}`;
      else where = first.mode === "hold" ? "在路上駐守" : "前往路上";
    }
    const html = `<span class="gb-desc"><b>${units.length} 支</b>${isMobile() ? "" : `（${desc}）`}・${where}</span>
      <button data-g="retreat">撤退</button>
      <button data-g="enter" class="${session.enter ? "on" : ""}">${session.enter ? "到了進駐 ✓" : "到了進駐 ✗"}</button>
      <button data-g="close" aria-label="取消選取">✕</button>
      ${isMobile() ? "" : '<span class="gb-tip">拖曳部隊或點地圖上的目的地來調度・R 撤退</span>'}`;
    if (bar.dataset.html !== html) {
      bar.dataset.html = html;
      bar.innerHTML = html;
    }
    bar.classList.remove("hidden");
  }

  private nodeName(node: number) {
    const me = session.me();
    if (me && node === me.hq) return "大本營";
    const owner = session.ownerOf(node);
    const nd = this.map?.nodes[node];
    if (owner && nd?.kind === "hq") return `${FACTIONS[owner.faction].name}大本營`;
    return nd?.name ?? "";
  }

  private refreshAir() {
    const mode = session.airMode;
    this.targetHint.classList.toggle("hidden", !mode);
    if (mode)
      $("target-text").textContent = isMobile()
        ? `${mode === "bomber" ? "轟炸機" : "運輸機"}待命：點任一條道路下令`
        : `${mode === "bomber" ? "轟炸機" : "運輸機"}待命：點地圖上任一條道路下令（右鍵或 Esc 取消）`;
  }

  // ================================================================ 操作

  private onClick = (e: MouseEvent) => {
    initAudio();
    const el = (e.target as HTMLElement).closest<HTMLElement>("button");
    if (!el) return;
    if (el.dataset.act === "ups") {
      this.bottom.querySelector(".g-ups")?.classList.toggle("open");
      play("click");
      return;
    }
    if (el.dataset.buy) this.buy(el.dataset.buy as UnitType, e.shiftKey ? 5 : 1, el);
    else if (el.dataset.pick) this.pick(el.dataset.pick as UnitType, 1, true);
    else if (el.dataset.act === "pick-all") this.pickAll();
    else if (el.dataset.act === "pick-none") {
      session.clearPicks();
      play("click", 0.5);
    } else if (el.dataset.act === "enter") {
      session.enter = !session.enter;
      play("click", 0.5);
    } else if (el.dataset.air) this.armAir(el.dataset.air as AirKind);
    else if (el.dataset.up) {
      session.send("upgrade", { kind: el.dataset.up });
      play("click");
    }
    if (!el.dataset.up) this.bottom.querySelector(".g-ups")?.classList.remove("open");
  };

  /** 右鍵點數量 = 減一 */
  private onContext = (e: MouseEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("button[data-pick]");
    if (!el) return;
    e.preventDefault();
    this.pick(el.dataset.pick as UnitType, -1, false);
  };

  private onGroupClick = (e: MouseEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("button[data-g]");
    if (!el) return;
    const ids = session.selectedUnits;
    if (el.dataset.g === "retreat") this.retreat();
    else if (el.dataset.g === "enter") {
      session.enter = !session.enter;
      // 已經在往某個據點走的部隊：用新的設定再下一次同樣的指令
      const s = session.state!;
      const first = s.units.get(ids[0]);
      if (first && first.destNode >= 0 && first.mode !== "retreat") {
        session.send("order", { units: ids, via: [], dest: { node: first.destNode }, enter: session.enter });
      }
      play("click", 0.5);
    } else if (el.dataset.g === "close") {
      session.selectedUnits = [];
      bus.emit("unitsSelected", []);
    }
  };

  private retreat() {
    if (!session.selectedUnits.length) return;
    session.send("retreat", { units: session.selectedUnits });
    play("click", 0.7);
    this.addFeed("部隊撤退中，回到最近的據點會自動進駐回血", "#f4f1e6");
  }

  private buy(type: UnitType, count: number, el: HTMLElement | null) {
    const node = session.selectedNode;
    if (node < 0) return;
    session.send("buy", { node, type, count });
    el?.classList.remove("flash");
    void el?.offsetWidth;
    el?.classList.add("flash");
    play("deploy", 0.6);
  }

  /** 調整要派出的數量；wrap = 加到超過駐軍數就回到 0（手機點一下循環） */
  private pick(type: UnitType, step: number, wrap: boolean) {
    const i = UNIT_TYPES.indexOf(type);
    const have = session.garrison(session.selectedNode).filter((u) => u.type === type).length;
    if (have === 0) {
      this.showToast("這座據點裡沒有這種兵，先點左邊買");
      return;
    }
    let v = session.picks[i] + step;
    if (v > have) v = wrap ? 0 : have;
    if (v < 0) v = 0;
    session.picks[i] = v;
    play("click", 0.4);
  }

  private pickAll() {
    const inside = session.garrison(session.selectedNode);
    session.picks = UNIT_TYPES.map((t) => inside.filter((u) => u.type === t).length);
    play("click", 0.5);
  }

  private cycleNode(step: number) {
    const s = session.state!;
    const list: number[] = [];
    for (let i = 0; i < s.nodes.length; i++) if (session.ownsNode(i)) list.push(i);
    if (!list.length) return;
    const idx = list.indexOf(session.selectedNode);
    session.selectedNode = list[(idx + step + list.length) % list.length];
    session.clearPicks();
    bus.emit("nodeSelected", session.selectedNode);
  }

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
      bus.emit("cancelDrag");
      this.openBuildMenu(null);
      if (session.selectedUnits.length) {
        session.selectedUnits = [];
        bus.emit("unitsSelected", []);
      }
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      return this.cycleNode(e.shiftKey ? -1 : 1);
    }
    if (k === "R") return this.retreat();
    if (k === "E") {
      session.enter = !session.enter;
      return;
    }
    if (k === "A") return this.pickAll();
    // 數字鍵：買兵（Shift + 數字 = 多選一支要派出的）
    const code = /^Digit(\d)$/.exec(e.code)?.[1];
    const unit = UNIT_TYPES.find((t) => UNITS[t].hotkey === (code ?? k));
    if (unit) {
      if (e.shiftKey) return this.pick(unit, 1, false);
      return this.buy(unit, 1, this.bottom.querySelector(`[data-buy="${unit}"]`));
    }
    const air = AIR_KINDS.find((a) => AIRCRAFT[a].hotkey === k);
    if (air) return this.armAir(air);
    const up = UPGRADE_KINDS.find((u) => UPGRADES[u].hotkey === k);
    if (up) {
      session.send("upgrade", { kind: up });
      play("click");
    }
    if (k === "M") toggleMute();
    if (k === "N") toggleMusic();
  };

  private armAir(kind: AirKind) {
    session.airMode = session.airMode === kind ? null : kind;
    bus.emit("airMode", session.airMode);
    play("click");
  }

  private openBuildMenu(m: { lane: number; node: number; slot: number; x: number; y: number } | null) {
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
        return `<button data-build="${k}" data-lane="${m.lane}" data-node="${m.node}" data-slot="${m.slot}"${poor ? ' style="opacity:.6"' : ""}><span>${d.name}<br><small style="color:#a89f84;font-weight:500">${d.short}</small></span><em>$${d.cost}</em></button>`;
      }).join("");
    const w = 220;
    this.buildMenu.style.left = `${Math.min(window.innerWidth - w - 8, m.x + 12)}px`;
    this.buildMenu.style.top = `${Math.max(8, Math.min(window.innerHeight - 220, m.y - 40))}px`;
    this.buildMenu.classList.remove("hidden");
  }

  private onBuildClick = (e: MouseEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("button[data-build]");
    if (!el) return;
    session.send("build", { kind: el.dataset.build, lane: Number(el.dataset.lane), node: Number(el.dataset.node), slot: Number(el.dataset.slot) });
    this.buildMenu.classList.add("hidden");
    play("deploy", 0.7);
  };

  // ================================================================ 提示

  showToast(text: string, ms = 1800) {
    this.toast.textContent = text;
    this.toast.classList.add("show");
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toast.classList.remove("show"), ms);
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

  private onAirIncoming(m: { owner: string; faction: number; kind: AirKind; lane: number }) {
    const me = session.me();
    if (!me || !this.map) return;
    const f = FACTIONS[m.faction];
    const name = m.kind === "bomber" ? "轟炸機" : "運輸機";
    if (m.owner === me.id) {
      this.addFeed(`${name}起飛！`, f.light);
      return;
    }
    const lane = this.map.lanes[m.lane];
    const threatened = !!lane && (session.ownsNode(lane.a) || session.ownsNode(lane.b));
    if (threatened) {
      this.showBanner("red", m.kind === "bomber" ? "空襲警報！" : "敵軍空降！", `${f.name}的${name}來了`);
      play("siren", 0.8);
    } else {
      this.addFeed(`${f.name}出動${name}`, f.light);
    }
  }

  private onEliminated(m: { name: string; faction: number; by: string; id: string }) {
    const f = FACTIONS[m.faction];
    if (m.id === session.myId) {
      this.showBanner("red", "大本營淪陷", "你已出局，可以繼續觀戰");
      play("defeat", 0.8);
    } else {
      this.showBanner("dark", `<s>${f.name}</s>`, m.by ? `被 ${esc(m.by)} 殲滅` : "已被殲滅", f.light);
    }
    this.addFeed(`${f.name}（${m.name}）出局`, f.light);
  }

  private onHqAlert(m: { owner: string; level: number }) {
    const me = session.me();
    const p = session.state?.players.get(m.owner);
    if (!p) return;
    if (me && m.owner === me.id) {
      this.showBanner("red", m.level >= 2 ? "大本營岌岌可危！" : "大本營遭受猛攻！", m.level >= 2 ? "血量剩不到 25%" : "血量剩一半");
      play("siren", 0.6);
    } else {
      this.addFeed(`${FACTIONS[p.faction].name}大本營血量剩${m.level >= 2 ? "不到 25%" : "一半"}`, FACTIONS[p.faction].light);
    }
  }

  private onCaptured(m: { node: number; by: string; faction: number }) {
    const f = FACTIONS[m.faction];
    const name = this.map?.nodes[m.node]?.name ?? "堡壘";
    if (m.by === session.myId) {
      this.showBanner("gold", `佔領 ${name}！`, "多一個出兵點，15 秒後開始產錢");
      play("capture", 1);
    } else {
      this.addFeed(`${f?.name ?? ""}佔領了${name}`, f?.light);
      play("capture", 0.35);
    }
  }

  private onFortFallen(m: { node: number; owner: string; faction: number; by: string }) {
    const name = this.map?.nodes[m.node]?.name ?? "堡壘";
    const f = FACTIONS[m.faction];
    if (m.owner === session.myId) {
      this.showBanner("red", `${name}失守！`, "派兵奪回來");
      play("fortLost", 1);
    } else if (m.by === session.myId) {
      this.showBanner("gold", `攻破 ${name}！`, "部隊在旁邊站 3 秒就能佔領");
      play("capture", 0.6);
    } else {
      this.addFeed(`${f?.name ?? ""}的${name}被攻破`, f?.light);
    }
  }

  private onLeader(m: { id: string; faction: number }) {
    const s = session.state;
    if (!s || s.phase !== "playing" || s.time < 5) return;
    if (!m.id) {
      this.addFeed("懸賞解除：沒有人的堡壘比別人多", "#f2c14e");
      return;
    }
    const p = s.players.get(m.id);
    if (m.id === session.myId) {
      this.showBanner("gold", "你被懸賞了！", "堡壘最多：攻破你的堡壘賞金加倍");
      play("siren", 0.5);
    } else if (p) {
      this.addFeed(`懸賞 ${FACTIONS[p.faction].name}：攻破他的堡壘賞金加倍`, FACTIONS[p.faction].light);
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
        return `<tr><td class="rank">${p.rank || "-"}</td><td style="color:${f.light};font-weight:900">${f.name}</td><td>${esc(p.name)}${p.id === me.id ? "（你）" : ""}</td><td>${p.kills}</td><td>${p.captures}</td><td>${p.deployed}</td><td>$${p.spent.toLocaleString()}</td></tr>`;
      })
      .join("");
    const isHost = s.hostId === me.id;
    this.result.innerHTML = `<div class="result-box">
      <h2 class="${win ? "" : "lose"}">${title}</h2>
      <p class="reason">${esc(s.endReason)}</p>
      <table><thead><tr><th>名次</th><th>陣營</th><th>指揮官</th><th>擊殺</th><th>佔領</th><th>買兵</th><th>花費</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="actions">
        ${isHost ? '<button class="btn primary" data-act="again">回到作戰室再戰</button>' : '<p style="margin:0;color:#a89f84">等房主開下一局…</p>'}
        <button class="btn" data-act="leave">離開房間</button>
      </div>
    </div>`;
    this.result.classList.remove("hidden");
    play(win ? "victory" : "defeat", 1);
  }

  private onResultClick = (e: MouseEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("button[data-act]");
    if (!el) return;
    if (el.dataset.act === "again") session.send("backToLobby");
    if (el.dataset.act === "leave") this.onLeave();
  };
}
